import { ReconciliationService } from './reconciliation.service';

const mockPrisma = {
  paymentReconciliation: {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
  payment: {
    findUnique: jest.fn(),
  },
} as any;

const makeService = () => new ReconciliationService(mockPrisma);

describe('ReconciliationService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('reconcilePaymentIntent', () => {
    it('skips if already reconciled', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue({ id: 'existing' });
      await svc.reconcilePaymentIntent({ stripeId: 'pi_1', stripeAmountCents: 2000, stripeStatus: 'succeeded' });
      expect(mockPrisma.paymentReconciliation.create).not.toHaveBeenCalled();
    });

    it('creates orphan record when no local payment', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      await svc.reconcilePaymentIntent({ stripeId: 'pi_orphan', stripeAmountCents: 2000, stripeStatus: 'succeeded' });
      expect(mockPrisma.paymentReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'orphan' }) }),
      );
    });

    it('creates matched record when amounts agree', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue({ amount: 20.00 });
      await svc.reconcilePaymentIntent({ stripeId: 'pi_ok', stripeAmountCents: 2000, stripeStatus: 'succeeded' });
      expect(mockPrisma.paymentReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'matched' }) }),
      );
    });

    it('creates mismatch record when amounts differ', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue({ amount: 15.00 });
      await svc.reconcilePaymentIntent({ stripeId: 'pi_bad', stripeAmountCents: 2000, stripeStatus: 'succeeded' });
      expect(mockPrisma.paymentReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'mismatch' }) }),
      );
    });
  });

  describe('reconcileRefund', () => {
    it('creates orphan when no local payment found', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      await svc.reconcileRefund({ stripeRefundId: 're_1', stripeAmountCents: 1000, paymentIntentId: 'pi_1' });
      const call = mockPrisma.paymentReconciliation.create.mock.calls[0][0].data;
      expect(call.status).toBe('orphan');
      expect(call.stripeObjectType).toBe('refund');
    });
  });

  describe('recordDispute', () => {
    it('creates a mismatch dispute record', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue(null);
      await svc.recordDispute({ stripeDisputeId: 'dp_1', stripeAmountCents: 3000, paymentIntentId: 'pi_1' });
      const call = mockPrisma.paymentReconciliation.create.mock.calls[0][0].data;
      expect(call.stripeObjectType).toBe('dispute');
      expect(call.status).toBe('mismatch');
    });

    it('skips if dispute already recorded', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findUnique.mockResolvedValue({ id: 'dp-existing' });
      await svc.recordDispute({ stripeDisputeId: 'dp_dup', stripeAmountCents: 1000, paymentIntentId: 'pi_1' });
      expect(mockPrisma.paymentReconciliation.create).not.toHaveBeenCalled();
    });
  });

  describe('listMismatches', () => {
    it('queries for mismatch and orphan statuses', async () => {
      const svc = makeService();
      mockPrisma.paymentReconciliation.findMany.mockResolvedValue([{ id: 'm1' }]);
      const result = await svc.listMismatches();
      expect(mockPrisma.paymentReconciliation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: { in: ['mismatch', 'orphan'] } } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('resolveEntry', () => {
    it('marks entry as resolved with admin and timestamp', async () => {
      const svc = makeService();
      await svc.resolveEntry('rec-1', 'admin-1');
      expect(mockPrisma.paymentReconciliation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({ status: 'resolved', resolvedByAdminId: 'admin-1' }),
        }),
      );
    });
  });
});
