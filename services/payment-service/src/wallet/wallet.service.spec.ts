import { WalletService } from './wallet.service';
import { BadRequestException } from '@nestjs/common';

const WALLET_STUB = {
  id: 'wallet-1',
  driverId: 'driver-1',
  pendingBalance: 0,
  availableBalance: 0,
  lifetimeEarnings: 0,
  lifetimePaid: 0,
  lastPayoutAt: null,
};

// Handles both callback form and array form of $transaction
const mockTxFn = jest.fn().mockImplementation((arg: unknown) => {
  if (typeof arg === 'function') return (arg as (tx: any) => Promise<unknown>)(mockPrisma);
  return Promise.all(arg as Promise<unknown>[]);
});

const mockPrisma = {
  driverWallet: {
    upsert: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    aggregate: jest.fn(),
  },
  walletTransaction: {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
  },
  $transaction: mockTxFn,
} as any;

const makeService = () => new WalletService(mockPrisma);

describe('WalletService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB });
    mockPrisma.driverWallet.update.mockResolvedValue({ ...WALLET_STUB });
  });

  describe('creditEarning', () => {
    it('skips when amount is 0', async () => {
      const svc = makeService();
      await svc.creditEarning('driver-1', 'trip-1', 0);
      expect(mockTxFn).not.toHaveBeenCalled();
    });

    it('increments pendingBalance and lifetimeEarnings', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB, pendingBalance: 16 });
      await svc.creditEarning('driver-1', 'trip-1', 16);
      expect(mockPrisma.driverWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            pendingBalance: { increment: 16 },
            lifetimeEarnings: { increment: 16 },
          }),
        }),
      );
    });

    it('creates a wallet transaction record', async () => {
      const svc = makeService();
      await svc.creditEarning('driver-1', 'trip-1', 20);
      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'earning', direction: 'credit', amount: 20, tripId: 'trip-1' }),
        }),
      );
    });
  });

  describe('releaseHold', () => {
    it('moves amount from pending to available', async () => {
      const svc = makeService();
      await svc.releaseHold('driver-1', 'trip-1', 16);
      expect(mockPrisma.driverWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pendingBalance: { decrement: 16 },
            availableBalance: { increment: 16 },
          }),
        }),
      );
    });

    it('creates a hold_release transaction', async () => {
      const svc = makeService();
      await svc.releaseHold('driver-1', 'trip-1', 16);
      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'hold_release', direction: 'credit' }),
        }),
      );
    });
  });

  describe('debitPayout', () => {
    it('throws when available balance is insufficient', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB, availableBalance: 5 });
      await expect(svc.debitPayout('driver-1', 'payout-1', 10)).rejects.toThrow(BadRequestException);
    });

    it('decrements availableBalance and increments lifetimePaid', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB, availableBalance: 49.01 });
      mockPrisma.driverWallet.update.mockResolvedValue({ ...WALLET_STUB, availableBalance: 0, lifetimePaid: 49.01 });
      await svc.debitPayout('driver-1', 'payout-1', 49.01);
      expect(mockPrisma.driverWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            availableBalance: { decrement: 49.01 },
            lifetimePaid: { increment: 49.01 },
          }),
        }),
      );
    });
  });

  describe('getWallet', () => {
    it('returns wallet info with instantPayoutEligible flag', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB, availableBalance: 50 });
      const result = await svc.getWallet('driver-1');
      expect(result.availableBalance).toBe(50);
      expect(result.instantPayoutEligible).toBe(true);
    });

    it('sets instantPayoutEligible false when below minimum', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB, availableBalance: 5 });
      const result = await svc.getWallet('driver-1');
      expect(result.instantPayoutEligible).toBe(false);
    });
  });

  describe('getTransactionHistory', () => {
    it('returns empty result when wallet does not exist', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.findUnique.mockResolvedValue(null);
      const result = await svc.getTransactionHistory('driver-999');
      expect(result.transactions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns transactions for existing wallet', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.findUnique.mockResolvedValue(WALLET_STUB);
      mockPrisma.walletTransaction.findMany.mockResolvedValue([{ id: 'txn-1', amount: 20 }]);
      mockPrisma.walletTransaction.count.mockResolvedValue(1);
      const result = await svc.getTransactionHistory('driver-1');
      expect(result.total).toBe(1);
      expect(result.transactions).toHaveLength(1);
    });
  });

  describe('applyAdjustment', () => {
    it('credits driver available balance', async () => {
      const svc = makeService();
      mockPrisma.driverWallet.upsert.mockResolvedValue({ ...WALLET_STUB, availableBalance: 10 });
      await svc.applyAdjustment({
        driverId: 'driver-1', amount: 10, direction: 'credit',
        adminId: 'admin-1', description: 'Correction',
      });
      expect(mockPrisma.driverWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { availableBalance: { increment: 10 } },
        }),
      );
    });

    it('creates adjustment transaction record', async () => {
      const svc = makeService();
      await svc.applyAdjustment({
        driverId: 'driver-1', amount: 5, direction: 'debit',
        adminId: 'admin-1', description: 'Fee',
      });
      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'adjustment', direction: 'debit', amount: 5 }),
        }),
      );
    });
  });
});
