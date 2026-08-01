/**
 * Real-PostgreSQL integration tests for rider receipts. REQUIRES TEST_DATABASE_URL.
 *
 * Ownership, Payment lookup, Refund aggregation, determinism and mismatch
 * handling are all properties of real rows and real relations — mocks cannot
 * prove them. No external provider is called: receipts are read-only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptService } from './receipt.service';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const RIDER_PHONE = '+19995556001';
const OTHER_PHONE = '+19995556002';
const ADMIN_UUID = '00000000-0000-4000-8000-000000000001';

describe('ReceiptService — real Postgres: ownership, refunds, determinism', () => {
  let svc: ReceiptService;
  let riderId: string;
  let riderUserId: string;
  let otherUserId: string;
  let n = 0;

  const seedTrip = async (over: Record<string, unknown> = {}) =>
    prisma.trip.create({
      data: {
        riderId,
        status: 'completed',
        completedAt: new Date(),
        pickupAddress: '744 Broad St, Newark NJ',
        pickupLat: 40.7357, pickupLng: -74.1724,
        dropoffAddress: 'EWR Terminal B',
        dropoffLat: 40.6895, dropoffLng: -74.1745,
        aiFare: 99.99, // must never surface
        finalFare: 24.5, platformFee: 4.9, waitFeeCharged: 1.5,
        ...over,
      },
    });

  const seedPayment = async (tripId: string, over: Record<string, unknown> = {}) =>
    prisma.payment.create({
      data: {
        tripId, riderId,
        stripePaymentIntentId: `pi_itest_${Date.now()}_${n++}`,
        amount: 24.5, currency: 'usd', status: 'succeeded', refundAmount: 0,
        ...over,
      },
    });

  const seedRefund = async (tripId: string, amount: number, reason = 'service_issue') =>
    prisma.refund.create({
      data: { tripId, amount, reason, notes: 'internal admin note', issuedByAdminId: ADMIN_UUID },
    });

  const cleanup = async () => {
    for (const phone of [RIDER_PHONE, OTHER_PHONE]) {
      const u = await prisma.user.findUnique({ where: { phone }, include: { rider: true } });
      if (!u) continue;
      if (u.rider) {
        const trips = await prisma.trip.findMany({ where: { riderId: u.rider.id }, select: { id: true } });
        const ids = trips.map((t) => t.id);
        if (ids.length) {
          await prisma.refund.deleteMany({ where: { tripId: { in: ids } } });
          await prisma.payment.deleteMany({ where: { tripId: { in: ids } } });
          await prisma.trip.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.rider.delete({ where: { id: u.rider.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    }
  };

  beforeAll(async () => {
    svc = new ReceiptService(prisma as unknown as PrismaService);
    await cleanup();
    const u = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: {} } },
      include: { rider: true },
    });
    riderId = u.rider!.id; riderUserId = u.id;
    const o = await prisma.user.create({
      data: { phone: OTHER_PHONE, role: 'rider', rider: { create: {} } },
    });
    otherUserId = o.id;
  });

  afterEach(async () => {
    const trips = await prisma.trip.findMany({ where: { riderId }, select: { id: true } });
    const ids = trips.map((t) => t.id);
    if (ids.length) {
      await prisma.refund.deleteMany({ where: { tripId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { tripId: { in: ids } } });
      await prisma.trip.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it('returns a receipt to the owning rider with the charged amount', async () => {
    const trip = await seedTrip();
    await seedPayment(trip.id, { amount: 30 }); // charged differs from finalFare on purpose
    const r = await svc.getRiderReceipt(riderUserId, trip.id);
    expect(r.grossCharged).toBe(30);
    expect(r.fare.finalFare).toBe(24.5);
    expect(r.netPaid).toBe(30);
    expect(r.pickupAddress).toContain('Broad St');
    expect(r.dropoffAddress).toContain('EWR');
  });

  it("refuses another rider's trip identically to a missing trip", async () => {
    const trip = await seedTrip();
    await seedPayment(trip.id);
    const foreign = await svc.getRiderReceipt(otherUserId, trip.id).catch((e) => e);
    const missing = await svc.getRiderReceipt(riderUserId, '00000000-0000-4000-8000-0000000000ff').catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect((foreign.getResponse() as any).code).toBe((missing.getResponse() as any).code);
  });

  it('refuses an incomplete trip and a cancelled trip', async () => {
    const inProgress = await seedTrip({ status: 'in_progress', completedAt: null });
    await seedPayment(inProgress.id);
    await expect(svc.getRiderReceipt(riderUserId, inProgress.id)).rejects.toThrow(BadRequestException);

    const cancelled = await seedTrip({ status: 'cancelled', completedAt: null });
    await expect(svc.getRiderReceipt(riderUserId, cancelled.id)).rejects.toThrow(BadRequestException);
  });

  it('fails explicitly when a completed trip has no Payment row', async () => {
    const trip = await seedTrip();
    const err = await svc.getRiderReceipt(riderUserId, trip.id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err.getResponse() as any).code).toBe('RECEIPT_PAYMENT_NOT_FOUND');
  });

  it('aggregates multiple refund rows and reduces netPaid', async () => {
    const trip = await seedTrip();
    await seedPayment(trip.id, { amount: 24.5, refundAmount: 15, status: 'partially_refunded' });
    await seedRefund(trip.id, 10);
    await seedRefund(trip.id, 5, 'goodwill');
    const r = await svc.getRiderReceipt(riderUserId, trip.id);
    expect(r.refundedTotal).toBe(15);       // not 30 — no double counting
    expect(r.netPaid).toBe(9.5);
    expect(r.refunds).toHaveLength(2);
    expect(r.paymentStatus).toBe('partially_refunded');
  });

  it('represents a full refund as zero net paid', async () => {
    const trip = await seedTrip();
    await seedPayment(trip.id, { amount: 24.5, refundAmount: 24.5, status: 'refunded' });
    await seedRefund(trip.id, 24.5, 'cancelled');
    const r = await svc.getRiderReceipt(riderUserId, trip.id);
    expect(r.netPaid).toBe(0);
    expect(r.paymentStatus).toBe('refunded');
  });

  it('fails closed when Payment.refundAmount disagrees with Refund rows', async () => {
    const trip = await seedTrip();
    await seedPayment(trip.id, { amount: 24.5, refundAmount: 10, status: 'partially_refunded' });
    await seedRefund(trip.id, 7); // itemised total disagrees with the aggregate
    const err = await svc.getRiderReceipt(riderUserId, trip.id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err.getResponse() as any).code).toBe('RECEIPT_RECONCILIATION_REQUIRED');
  });

  it('is deterministic and writes nothing', async () => {
    const trip = await seedTrip();
    await seedPayment(trip.id);
    await seedRefund(trip.id, 4.5);
    await prisma.payment.update({ where: { tripId: trip.id }, data: { refundAmount: 4.5, status: 'partially_refunded' } });

    const before = {
      payments: await prisma.payment.count(),
      refunds: await prisma.refund.count(),
      trips: await prisma.trip.count(),
      ledger: await prisma.financialLedger.count(),
    };
    const a = await svc.getRiderReceipt(riderUserId, trip.id);
    const b = await svc.getRiderReceipt(riderUserId, trip.id);
    const after = {
      payments: await prisma.payment.count(),
      refunds: await prisma.refund.count(),
      trips: await prisma.trip.count(),
      ledger: await prisma.financialLedger.count(),
    };

    expect(a).toEqual(b);
    expect(a.receiptId).toBe(b.receiptId);
    expect(after).toEqual(before); // no rows created or mutated
  });

  it('never leaks aiFare, provider ids, admin notes or internal refund ids', async () => {
    const trip = await seedTrip();
    const payment = await seedPayment(trip.id, { amount: 24.5, refundAmount: 10, status: 'partially_refunded' });
    const refund = await seedRefund(trip.id, 10);
    const json = JSON.stringify(await svc.getRiderReceipt(riderUserId, trip.id));
    for (const forbidden of [payment.stripePaymentIntentId, refund.id, ADMIN_UUID, 'internal admin note', '99.99']) {
      expect(json).not.toContain(String(forbidden));
    }
  });
});
