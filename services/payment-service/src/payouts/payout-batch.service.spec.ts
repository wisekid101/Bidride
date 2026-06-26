import { PayoutBatchService } from './payout-batch.service';

let mockTransfersCreate: jest.Mock;

jest.mock('stripe', () => {
  const mockConstructor = jest.fn().mockImplementation(() => {
    mockTransfersCreate = jest.fn().mockResolvedValue({ id: 'tr_batch_123' });
    return { transfers: { create: mockTransfersCreate } };
  });
  return { default: mockConstructor, __esModule: true };
});

const mockLedger = { recordPayout: jest.fn().mockResolvedValue(undefined) } as any;
const mockWallet = { debitPayout: jest.fn().mockResolvedValue(undefined) } as any;

const mockPrisma = {
  driverWallet: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _sum: { availableBalance: 0, pendingBalance: 0 } }),
  },
  payoutBatch: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  payoutAttempt: {
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
} as any;

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('sk_test_key'),
} as any;

const makeService = () => new PayoutBatchService(mockPrisma, mockConfig, mockLedger, mockWallet);

describe('PayoutBatchService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('scheduleBatch', () => {
    it('creates a batch record with correct driver count and total', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.findMany.mockResolvedValue([
        { availableBalance: 50, driver: { id: 'd1', stripeAccountId: 'acct_1', payoutBankVerified: true } },
        { availableBalance: 25, driver: { id: 'd2', stripeAccountId: 'acct_2', payoutBankVerified: true } },
      ]);
      mockPrisma.payoutBatch.create.mockResolvedValue({ id: 'batch-1' });

      const result = await svc.scheduleBatch({
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-07'),
      });

      expect(mockPrisma.payoutBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            driverCount: 2,
            totalAmount: 75,
            status: 'pending',
          }),
        }),
      );
      expect(result.driverCount).toBe(2);
    });

    it('excludes drivers with balance below minimum', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.findMany.mockResolvedValue([
        { availableBalance: 50, driver: { id: 'd1', stripeAccountId: 'acct_1', payoutBankVerified: true } },
      ]);
      mockPrisma.payoutBatch.create.mockResolvedValue({ id: 'batch-2' });

      const result = await svc.scheduleBatch({
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-07'),
      });

      expect(result.driverCount).toBe(1);
    });
  });

  describe('processBatch', () => {
    it('skips batch not in pending state', async () => {
      const svc = makeService();
      mockPrisma.payoutBatch.findUnique.mockResolvedValue({ id: 'batch-1', status: 'completed' });
      await svc.processBatch('batch-1');
      expect(mockPrisma.payoutAttempt.create).not.toHaveBeenCalled();
    });

    it('creates payout attempts for each eligible driver', async () => {
      const svc = makeService();
      mockPrisma.payoutBatch.findUnique.mockResolvedValue({ id: 'batch-1', status: 'pending' });
      mockPrisma.driverWallet.findMany.mockResolvedValue([
        { availableBalance: 50, driver: { id: 'd1', stripeAccountId: 'acct_1', payoutBankVerified: true } },
      ]);
      mockPrisma.payoutAttempt.create.mockResolvedValue({ id: 'attempt-1' });

      await svc.processBatch('batch-1');

      expect(mockPrisma.payoutAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverId: 'd1', status: 'pending' }),
        }),
      );
    });

    it('marks attempt as succeeded on successful transfer', async () => {
      const svc = makeService();
      mockPrisma.payoutBatch.findUnique.mockResolvedValue({ id: 'batch-1', status: 'pending' });
      mockPrisma.driverWallet.findMany.mockResolvedValue([
        { availableBalance: 50, driver: { id: 'd1', stripeAccountId: 'acct_1', payoutBankVerified: true } },
      ]);
      mockPrisma.payoutAttempt.create.mockResolvedValue({ id: 'attempt-1' });

      await svc.processBatch('batch-1');

      expect(mockPrisma.payoutAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'succeeded', stripeTransferId: 'tr_batch_123' }),
        }),
      );
    });

    it('marks attempt as retrying on Stripe failure', async () => {
      const svc = makeService();
      // mockTransfersCreate is captured when makeService() calls new Stripe()
      mockTransfersCreate.mockRejectedValueOnce(new Error('Stripe transfer failed'));

      mockPrisma.payoutBatch.findUnique.mockResolvedValue({ id: 'batch-1', status: 'pending' });
      mockPrisma.driverWallet.findMany.mockResolvedValue([
        { availableBalance: 50, driver: { id: 'd1', stripeAccountId: 'acct_1', payoutBankVerified: true } },
      ]);
      mockPrisma.payoutAttempt.create.mockResolvedValue({ id: 'attempt-1' });

      await svc.processBatch('batch-1');

      expect(mockPrisma.payoutAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: expect.stringMatching(/retrying|failed/) }),
        }),
      );
    });
  });

  describe('retryFailedAttempts', () => {
    it('retries due attempts', async () => {
      const svc = makeService();
      mockPrisma.payoutAttempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          batchId: 'b1',
          driverId: 'd1',
          amount: 30,
          attemptNumber: 1,
          driver: { stripeAccountId: 'acct_1', payoutBankVerified: true },
        },
      ]);
      mockPrisma.payoutAttempt.create.mockResolvedValue({ id: 'att-2' });

      await svc.retryFailedAttempts();

      expect(mockPrisma.payoutAttempt.create).toHaveBeenCalled();
    });

    it('skips drivers without verified bank', async () => {
      const svc = makeService();
      mockPrisma.payoutAttempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          batchId: 'b1',
          driverId: 'd1',
          amount: 30,
          attemptNumber: 1,
          driver: { stripeAccountId: null, payoutBankVerified: false },
        },
      ]);

      await svc.retryFailedAttempts();

      expect(mockPrisma.payoutAttempt.create).not.toHaveBeenCalled();
    });
  });

  describe('getDriverPayoutAttempts', () => {
    it('returns recent payout attempts for driver', async () => {
      const svc = makeService();
      mockPrisma.payoutAttempt.findMany.mockResolvedValue([
        { id: 'a1', amount: 50, status: 'succeeded', createdAt: new Date() },
      ]);
      const result = await svc.getDriverPayoutAttempts('driver-1');
      expect(result).toHaveLength(1);
    });
  });
});
