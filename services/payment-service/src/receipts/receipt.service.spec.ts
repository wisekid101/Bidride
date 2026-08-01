import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReceiptService } from './receipt.service';

/**
 * Unit coverage for rider receipt aggregation.
 *
 * The receipt is derived from immutable financial evidence — Payment and Refund
 * — never from Trip.aiFare, current pricing rules, or any recalculation. These
 * tests pin that contract. Ownership, refund aggregation against real rows and
 * determinism are additionally proven against Postgres in
 * receipt.integration.spec.ts.
 */

const RIDER = { id: 'rider-1', userId: 'user-1' };
const TRIP = {
  id: 'trip-1',
  riderId: 'rider-1',
  status: 'completed',
  completedAt: new Date('2026-07-30T18:00:00Z'),
  pickupAddress: '744 Broad St, Newark NJ',
  dropoffAddress: 'EWR Terminal B',
  finalFare: 24.5,
  platformFee: 4.9,
  waitFeeCharged: 1.5,
  aiFare: 99.99, // must never appear
};
const PAYMENT = {
  id: 'pay-1',
  tripId: 'trip-1',
  riderId: 'rider-1',
  amount: 24.5,
  currency: 'usd',
  status: 'succeeded',
  refundAmount: 0,
  stripePaymentIntentId: 'pi_secret_do_not_expose',
};

function build(over: {
  rider?: unknown; trip?: unknown; payment?: unknown; refunds?: unknown[];
} = {}) {
  const prisma = {
    rider: { findUnique: jest.fn().mockResolvedValue('rider' in over ? over.rider : RIDER) },
    trip: { findUnique: jest.fn().mockResolvedValue('trip' in over ? over.trip : TRIP) },
    payment: { findUnique: jest.fn().mockResolvedValue('payment' in over ? over.payment : PAYMENT) },
    refund: { findMany: jest.fn().mockResolvedValue(over.refunds ?? []) },
  };
  return { svc: new ReceiptService(prisma as never), prisma };
}

describe('ReceiptService — authorization', () => {
  it('returns a receipt to the owning rider', async () => {
    const { svc } = build();
    const r = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(r.tripId).toBe('trip-1');
  });

  it('rejects when the user has no rider profile', async () => {
    const { svc } = build({ rider: null });
    await expect(svc.getRiderReceipt('user-x', 'trip-1')).rejects.toThrow(NotFoundException);
  });

  it("rejects another rider's trip with the same error as a missing trip (no existence leak)", async () => {
    const foreign = build({ trip: { ...TRIP, riderId: 'rider-2' } });
    const missing = build({ trip: null });
    const e1 = await foreign.svc.getRiderReceipt('user-1', 'trip-1').catch((e) => e);
    const e2 = await missing.svc.getRiderReceipt('user-1', 'trip-1').catch((e) => e);
    expect(e1).toBeInstanceOf(NotFoundException);
    expect(e2).toBeInstanceOf(NotFoundException);
    expect((e1.getResponse() as any).code).toBe((e2.getResponse() as any).code);
  });
});

describe('ReceiptService — trip and payment preconditions', () => {
  it.each(['searching', 'accepted', 'in_progress', 'cancelled', 'no_show'])(
    'refuses a %s trip', async (status) => {
      const { svc } = build({ trip: { ...TRIP, status } });
      await expect(svc.getRiderReceipt('user-1', 'trip-1')).rejects.toThrow(BadRequestException);
    });

  it('fails explicitly when a completed trip has no Payment (never invents values)', async () => {
    const { svc } = build({ payment: null });
    const err = await svc.getRiderReceipt('user-1', 'trip-1').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err.getResponse() as any).code).toBe('RECEIPT_PAYMENT_NOT_FOUND');
  });
});

describe('ReceiptService — financial integrity', () => {
  it('takes the gross total from Payment.amount, not Trip.finalFare', async () => {
    // Divergent on purpose: the rider was charged 30.00 though the fare says 24.50.
    const { svc } = build({ payment: { ...PAYMENT, amount: 30 } });
    const r = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(r.grossCharged).toBe(30);
    expect(r.fare.finalFare).toBe(24.5); // reported as a fare component, not the total
    expect(r.netPaid).toBe(30);
  });

  it('never exposes Trip.aiFare or any estimate', async () => {
    const { svc } = build();
    const json = JSON.stringify(await svc.getRiderReceipt('user-1', 'trip-1'));
    expect(json).not.toContain('99.99');
    expect(json).not.toMatch(/aiFare/i);
  });

  it('applies a partial refund to netPaid', async () => {
    const { svc } = build({
      payment: { ...PAYMENT, refundAmount: 10, status: 'partially_refunded' },
      refunds: [{ id: 'rf1', amount: 10, reason: 'service_issue', notes: 'internal', issuedByAdminId: 'admin-9', stripeRefundId: 're_x', createdAt: new Date() }],
    });
    const r = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(r.grossCharged).toBe(24.5);
    expect(r.refundedTotal).toBe(10);
    expect(r.netPaid).toBe(14.5);
    expect(r.paymentStatus).toBe('partially_refunded');
  });

  it('represents a full refund as zero net paid', async () => {
    const { svc } = build({
      payment: { ...PAYMENT, refundAmount: 24.5, status: 'refunded' },
      refunds: [{ id: 'rf1', amount: 24.5, reason: 'cancelled', notes: '', issuedByAdminId: 'a', createdAt: new Date() }],
    });
    const r = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(r.netPaid).toBe(0);
    expect(r.paymentStatus).toBe('refunded');
  });

  it('aggregates multiple refund rows without double-counting the Payment aggregate', async () => {
    const { svc } = build({
      payment: { ...PAYMENT, refundAmount: 15, status: 'partially_refunded' },
      refunds: [
        { id: 'rf1', amount: 10, reason: 'service_issue', notes: '', issuedByAdminId: 'a', createdAt: new Date() },
        { id: 'rf2', amount: 5, reason: 'goodwill', notes: '', issuedByAdminId: 'a', createdAt: new Date() },
      ],
    });
    const r = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(r.refundedTotal).toBe(15); // not 30
    expect(r.netPaid).toBe(9.5);
    expect(r.refunds).toHaveLength(2);
  });

  it('fails closed when the Payment aggregate and Refund rows disagree', async () => {
    const { svc } = build({
      payment: { ...PAYMENT, refundAmount: 10, status: 'partially_refunded' },
      refunds: [{ id: 'rf1', amount: 7, reason: 'x', notes: '', issuedByAdminId: 'a', createdAt: new Date() }],
    });
    const err = await svc.getRiderReceipt('user-1', 'trip-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err.getResponse() as any).code).toBe('RECEIPT_RECONCILIATION_REQUIRED');
  });
});

describe('ReceiptService — determinism, purity and privacy', () => {
  it('is deterministic and performs no writes', async () => {
    const { svc, prisma } = build();
    const a = await svc.getRiderReceipt('user-1', 'trip-1');
    const b = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(a).toEqual(b);
    expect(a.receiptId).toBe(b.receiptId);
    // no write-capable delegate was even provided to the service
    expect((prisma as any).payment.update).toBeUndefined();
    expect((prisma as any).refund.create).toBeUndefined();
  });

  it('produces a stable, non-sensitive receipt id', async () => {
    const { svc } = build();
    const r = await svc.getRiderReceipt('user-1', 'trip-1');
    expect(r.receiptId).toMatch(/^RCPT-/);
    expect(r.receiptId).not.toContain('pi_');
  });

  it('omits sensitive payment, driver, ledger and admin data', async () => {
    const { svc } = build({
      payment: { ...PAYMENT, refundAmount: 10, status: 'partially_refunded' },
      refunds: [{ id: 'rf-internal', amount: 10, reason: 'service_issue', notes: 'internal admin note', issuedByAdminId: 'admin-9', stripeRefundId: 're_secret', createdAt: new Date() }],
    });
    const json = JSON.stringify(await svc.getRiderReceipt('user-1', 'trip-1'));
    for (const forbidden of ['pi_secret_do_not_expose', 're_secret', 'admin-9', 'internal admin note', 'rf-internal', 'stripePaymentIntentId', 'driverEarnings', 'issuedByAdminId']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('omits unsupported line items rather than reporting them as zero', async () => {
    const { svc } = build();
    const r = await svc.getRiderReceipt('user-1', 'trip-1') as unknown as Record<string, unknown>;
    for (const absent of ['tip', 'tipAmount', 'discount', 'credit', 'tax', 'tolls', 'airportFee', 'paymentMethod']) {
      expect(r[absent]).toBeUndefined();
    }
  });
});
