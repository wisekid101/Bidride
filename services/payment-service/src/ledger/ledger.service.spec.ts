import { LedgerService } from './ledger.service';

const mockCreate = jest.fn().mockResolvedValue({});
const mockTransaction = jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));

const mockPrisma = {
  financialLedger: { create: mockCreate },
  $transaction: mockTransaction,
} as any;

const makeService = () => new LedgerService(mockPrisma);

describe('LedgerService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createEntries — balance enforcement', () => {
    it('writes entries when debits equal credits', async () => {
      const svc = makeService();
      await svc.createEntries([
        { correlationId: 'c1', entryType: 'test', accountType: 'rider', accountId: 'r1', direction: 'debit', amount: 20, sourceEvent: 'test' },
        { correlationId: 'c1', entryType: 'test', accountType: 'platform', accountId: 'platform', direction: 'credit', amount: 20, sourceEvent: 'test' },
      ]);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('throws when debits do not equal credits', async () => {
      const svc = makeService();
      await expect(
        svc.createEntries([
          { correlationId: 'c1', entryType: 'test', accountType: 'rider', accountId: 'r1', direction: 'debit', amount: 20, sourceEvent: 'test' },
          { correlationId: 'c1', entryType: 'test', accountType: 'platform', accountId: 'platform', direction: 'credit', amount: 15, sourceEvent: 'test' },
        ]),
      ).rejects.toThrow('Ledger imbalance');
    });

    it('records actorType correctly when provided', async () => {
      const svc = makeService();
      await svc.createEntries([
        { correlationId: 'c1', entryType: 'adjustment', accountType: 'driver', accountId: 'd1', direction: 'credit', amount: 10, actorType: 'admin', actorId: 'admin-1', sourceEvent: 'admin:adjustment' },
        { correlationId: 'c1', entryType: 'adjustment', accountType: 'platform', accountId: 'platform', direction: 'debit', amount: 10, actorType: 'admin', actorId: 'admin-1', sourceEvent: 'admin:adjustment' },
      ]);
      const firstCall = mockCreate.mock.calls[0][0].data;
      expect(firstCall.actorType).toBe('admin');
      expect(firstCall.actorId).toBe('admin-1');
    });
  });

  describe('recordRiderPayment', () => {
    it('creates debit on rider + credit on platform', async () => {
      const svc = makeService();
      await svc.recordRiderPayment({ tripId: 't1', riderId: 'r1', amount: 20, commission: 4, correlationId: 'c1' });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const debit = calls.find((c: any) => c.direction === 'debit');
      const credit = calls.find((c: any) => c.direction === 'credit');

      expect(debit?.accountType).toBe('rider');
      expect(debit?.amount).toEqual(20);
      expect(credit?.accountType).toBe('platform');
      expect(credit?.amount).toEqual(20);
    });

    it('links tripId on both entries', async () => {
      const svc = makeService();
      await svc.recordRiderPayment({ tripId: 'trip-xyz', riderId: 'r1', amount: 18, commission: 3.60, correlationId: 'c2' });
      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      expect(calls.every((c: any) => c.tripId === 'trip-xyz')).toBe(true);
    });
  });

  describe('recordDriverEarning', () => {
    it('creates debit on platform + credit on driver', async () => {
      const svc = makeService();
      await svc.recordDriverEarning({ tripId: 't1', driverId: 'd1', amount: 16, correlationId: 'c1' });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const debit = calls.find((c: any) => c.direction === 'debit');
      const credit = calls.find((c: any) => c.direction === 'credit');

      expect(debit?.accountType).toBe('platform');
      expect(credit?.accountType).toBe('driver');
      expect(credit?.accountId).toBe('d1');
      expect(credit?.amount).toEqual(16);
    });
  });

  describe('recordTip', () => {
    it('routes tip from rider to driver', async () => {
      const svc = makeService();
      await svc.recordTip({ tripId: 't1', riderId: 'r1', driverId: 'd1', amount: 5, correlationId: 'c1' });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const debit = calls.find((c: any) => c.direction === 'debit');
      const credit = calls.find((c: any) => c.direction === 'credit');

      expect(debit?.accountType).toBe('rider');
      expect(credit?.accountType).toBe('driver');
      expect(debit?.entryType).toBe('tip');
    });
  });

  describe('recordRefund', () => {
    it('creates debit on platform + credit on rider with refundId', async () => {
      const svc = makeService();
      await svc.recordRefund({
        tripId: 't1', riderId: 'r1', amount: 10, refundId: 'ref-1',
        correlationId: 'c1', adminId: 'admin-1', reason: 'overcharge',
      });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const debit = calls.find((c: any) => c.direction === 'debit');
      const credit = calls.find((c: any) => c.direction === 'credit');

      expect(debit?.accountType).toBe('platform');
      expect(credit?.accountType).toBe('rider');
      expect(credit?.refundId).toBe('ref-1');
      expect(credit?.actorType).toBe('admin');
    });
  });

  describe('recordBonus', () => {
    it('credits driver from platform with incentive type', async () => {
      const svc = makeService();
      await svc.recordBonus({ driverId: 'd1', amount: 25, correlationId: 'c1', description: 'Welcome bonus', adminId: 'admin-1' });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const credit = calls.find((c: any) => c.direction === 'credit');
      expect(credit?.entryType).toBe('incentive');
      expect(credit?.accountType).toBe('driver');
      expect(credit?.amount).toEqual(25);
    });
  });

  describe('recordAdjustment', () => {
    it('creates balanced debit+credit for admin adjustment', async () => {
      const svc = makeService();
      await svc.recordAdjustment({
        accountId: 'd1', accountType: 'driver', amount: 5,
        direction: 'credit', correlationId: 'c1', adminId: 'admin-1', description: 'Manual correction',
      });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const debits = calls.filter((c: any) => c.direction === 'debit');
      const credits = calls.filter((c: any) => c.direction === 'credit');
      expect(debits.length).toBe(1);
      expect(credits.length).toBe(1);
      expect(credits[0].accountId).toBe('d1');
      expect(debits[0].accountType).toBe('platform');
    });
  });

  describe('recordPayout', () => {
    it('debits driver + credits platform', async () => {
      const svc = makeService();
      await svc.recordPayout({ driverId: 'd1', amount: 49.01, payoutId: 'p1', correlationId: 'c1' });

      const calls = mockCreate.mock.calls.map((c: any) => c[0].data);
      const debit = calls.find((c: any) => c.direction === 'debit');
      const credit = calls.find((c: any) => c.direction === 'credit');

      expect(debit?.accountType).toBe('driver');
      expect(credit?.accountType).toBe('platform');
      expect(debit?.payoutId).toBe('p1');
    });
  });
});
