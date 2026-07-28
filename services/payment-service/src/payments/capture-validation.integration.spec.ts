/**
 * F5 — canonical capture validation, against real PostgreSQL.
 *
 * Offer trips settle via capture rather than chargeTrip, so none of chargeTrip's
 * fare-integrity guards applied here: any amount up to the authorized standard
 * fare could be captured. The canonical trip is REAL in every test below — the
 * point is that validation reads persisted state, so faking the trip would
 * prove nothing.
 *
 * Stripe is the only stubbed boundary; payment-service's own path runs for real.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaClient, BidStatus, TripStatus } from '@bidride/database';
import { PaymentService } from './payment.service';
import { LedgerService } from '../ledger/ledger.service';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

// payment-service fixture blocks 7/8/9 are taken by the payout and wallet
// suites; this one owns 9002.
const RIDER_PHONE = '+19995559002';
const DRIVER_PHONE = '+19995559003';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];

describe('capture canonical validation (integration)', () => {
  let service: PaymentService;
  let ledger: LedgerService;
  let captureSpy: jest.Mock;

  let riderId: string;
  let driverId: string;
  const tripIds: string[] = [];

  async function cleanupDb() {
    const users = await prisma.user.findMany({
      where: { phone: { in: PHONES } },
      include: { rider: true, driver: true },
    });
    const riderIds = users.map((u) => u.rider?.id).filter((x): x is string => !!x);
    const driverIds = users.map((u) => u.driver?.id).filter((x): x is string => !!x);
    const trips = await prisma.trip.findMany({
      where: { riderId: { in: riderIds } }, select: { id: true },
    });
    const ids = trips.map((t) => t.id);
    if (ids.length) {
      await prisma.financialLedger.deleteMany({ where: { tripId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { tripId: { in: ids } } });
      await prisma.tripEvent.deleteMany({ where: { tripId: { in: ids } } });
      await prisma.trip.updateMany({ where: { id: { in: ids } }, data: { bidId: null } });
      await prisma.bid.deleteMany({ where: { tripId: { in: ids } } });
      await prisma.trip.deleteMany({ where: { id: { in: ids } } });
    }
    if (driverIds.length) await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
    if (riderIds.length) await prisma.rider.deleteMany({ where: { id: { in: riderIds } } });
    await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await prisma.financialLedger.deleteMany({ where: { correlationId: { startsWith: 'capture:' }, accountId: { in: riderIds } } });
  }

  /** A REAL trip + bid in the given bid state, with finalFare persisted. */
  async function seedTrip(opts: {
    bidStatus?: BidStatus | null; finalFare?: number | null; attachBid?: boolean;
  } = {}) {
    const { bidStatus = BidStatus.accepted, finalFare = 23.64, attachBid = true } = opts;
    const trip = await prisma.trip.create({
      data: {
        riderId, status: TripStatus.accepted,
        pickupAddress: 'A', dropoffAddress: 'B',
        pickupLat: 40.7357, pickupLng: -74.1724,
        dropoffLat: 40.6895, dropoffLng: -74.1745,
        aiFare: 30,
        ...(finalFare != null ? { finalFare } : {}),
      },
    });
    tripIds.push(trip.id);

    if (attachBid && bidStatus) {
      const bid = await prisma.bid.create({
        data: {
          tripId: trip.id, riderId, driverId, aiFare: 30, riderOffer: 23.64,
          status: bidStatus, expiresAt: new Date(Date.now() + 120_000),
          ...(bidStatus === BidStatus.accepted ? { finalFare: finalFare ?? undefined } : {}),
        },
      });
      await prisma.trip.update({ where: { id: trip.id }, data: { bidId: bid.id } });
    }
    return trip;
  }

  const expectRejected = async (p: Promise<unknown>) => {
    let caught: unknown;
    try { await p; } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'FARE_INTEGRITY_ERROR' });
  };

  beforeAll(async () => {
    await cleanupDb();
    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: { stripeCustomerId: 'cus_f5_itest' } } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;
    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: { create: { status: 'approved', legalFirstName: 'F5', legalLastName: 'Driver', dateOfBirth: new Date('1990-01-01') } },
      },
      include: { driver: true },
    });
    driverId = driverUser.driver!.id;

    ledger = new LedgerService(prisma as never);
    const config = { getOrThrow: () => 'sk_test_f5_never_real', get: () => undefined } as never;
    const redis = { set: jest.fn().mockResolvedValue('OK'), get: jest.fn(), del: jest.fn() } as never;
    // wallet and reconciliation are unused by the capture path under test.
    service = new PaymentService(
      prisma as never, config, redis, ledger, undefined as never, undefined as never,
    );

    // Stripe is the ONLY stub. Everything else is the real service path.
    captureSpy = jest.fn().mockResolvedValue({ id: 'pi_f5_itest', status: 'succeeded' });
    (service as unknown as { stripe: { paymentIntents: { capture: jest.Mock } } }).stripe = {
      paymentIntents: { capture: captureSpy },
    } as never;
  });

  afterAll(async () => {
    const settle = (w: Promise<unknown> | undefined) => Promise.resolve(w).catch(() => undefined);
    await settle(cleanupDb());
    await settle(prisma.$disconnect());
  });

  beforeEach(() => captureSpy.mockClear());

  const ledgerRows = (tripId: string) =>
    prisma.financialLedger.findMany({ where: { tripId, entryType: 'rider_payment' } });

  it('captures a valid accepted bid at the canonical amount', async () => {
    const trip = await seedTrip();

    await expect(service.captureAuthorizationHold('pi_f5_ok', 2364, trip.id, riderId))
      .resolves.toEqual({ status: 'succeeded' });

    expect(captureSpy).toHaveBeenCalledWith(
      'pi_f5_ok', { amount_to_capture: 2364 }, { idempotencyKey: 'capture_pi_f5_ok' },
    );
  });

  it('books exactly one Payment and one balanced ledger pair', async () => {
    const trip = await seedTrip();

    await service.captureAuthorizationHold('pi_f5_book', 2364, trip.id, riderId);
    await new Promise((r) => setTimeout(r, 300)); // ledger write is fire-and-forget

    const payments = await prisma.payment.findMany({ where: { tripId: trip.id } });
    expect(payments).toHaveLength(1);
    expect(Math.round(Number(payments[0].amount) * 100)).toBe(2364);

    const rows = await ledgerRows(trip.id);
    expect(rows).toHaveLength(2);
    const debit = rows.find((r) => r.direction === 'debit');
    const credit = rows.find((r) => r.direction === 'credit');
    expect(Math.round(Number(debit!.amount) * 100)).toBe(2364);
    expect(Math.round(Number(credit!.amount) * 100)).toBe(2364);
  });

  it.each([
    ['above canonical', 2365],
    ['below canonical', 2363],
  ])('rejects an amount %s and moves no money', async (_label, amountCents) => {
    const trip = await seedTrip();

    await expectRejected(service.captureAuthorizationHold('pi_f5_bad', amountCents, trip.id, riderId));

    expect(captureSpy).not.toHaveBeenCalled();
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await ledgerRows(trip.id)).toHaveLength(0);
    // Durable evidence against the real trip row.
    const events = await prisma.tripEvent.findMany({
      where: { tripId: trip.id, eventType: 'fare_integrity_error' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      expectedAmountCents: 2364, requestedAmountCents: amountCents,
    });
  });

  it('rejects a non-bid trip', async () => {
    const trip = await seedTrip({ attachBid: false });

    await expectRejected(service.captureAuthorizationHold('pi_f5_nonbid', 2364, trip.id, riderId));

    expect(captureSpy).not.toHaveBeenCalled();
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it.each([[BidStatus.pending], [BidStatus.countered], [BidStatus.declined]])(
    'rejects capture while the bid is %s', async (bidStatus) => {
      const trip = await seedTrip({ bidStatus });

      await expectRejected(service.captureAuthorizationHold('pi_f5_unaccepted', 2364, trip.id, riderId));

      expect(captureSpy).not.toHaveBeenCalled();
      expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
      expect(await ledgerRows(trip.id)).toHaveLength(0);
    },
  );

  it('rejects a trip with no canonical finalFare', async () => {
    const trip = await seedTrip({ finalFare: null });

    await expectRejected(service.captureAuthorizationHold('pi_f5_nofare', 2364, trip.id, riderId));

    expect(captureSpy).not.toHaveBeenCalled();
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it('rejects a capture for a trip id that does not exist', async () => {
    await expectRejected(service.captureAuthorizationHold(
      'pi_f5_missing', 2364, '00000000-0000-0000-0000-0000000000f5', riderId,
    ));
    expect(captureSpy).not.toHaveBeenCalled();
  });
});

// ─── F4: authorization idempotency, real service path ────────────────────────
//
// The Stripe boundary is stubbed but the idempotency contract is exercised for
// real: the stub keys its responses on the idempotencyKey the service supplies,
// so a replayed attempt id genuinely returns the original PaymentIntent instead
// of minting a second one — the behaviour Stripe itself provides.

describe('bid authorization idempotency (integration)', () => {
  let authService: PaymentService;
  let createSpy: jest.Mock;
  let issued: Map<string, string>;

  beforeAll(() => {
    const config = { getOrThrow: () => 'sk_test_f4_never_real', get: () => undefined } as never;
    const redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() } as never;
    authService = new PaymentService(
      prisma as never, config, redis, new LedgerService(prisma as never), undefined as never, undefined as never,
    );

    issued = new Map();
    createSpy = jest.fn().mockImplementation((_params: unknown, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey ?? '';
      // Stripe semantics: same key ⇒ same PaymentIntent, no new hold.
      if (!issued.has(key)) issued.set(key, `pi_${issued.size + 1}`);
      return Promise.resolve({ id: issued.get(key), status: 'requires_capture' });
    });
    (authService as unknown as { stripe: { paymentIntents: { create: jest.Mock } } }).stripe = {
      paymentIntents: { create: createSpy },
    } as never;
  });

  beforeEach(() => { createSpy.mockClear(); issued.clear(); });

  it('a retry with the same attempt id yields ONE PaymentIntent', async () => {
    const attempt = 'f4-attempt-retry';

    const first = await authService.createAuthorizationHold('cus_a', 'pm_a', 3000, attempt);
    const retry = await authService.createAuthorizationHold('cus_a', 'pm_a', 3000, attempt);

    expect(retry.paymentIntentId).toBe(first.paymentIntentId);
    expect(issued.size).toBe(1); // exactly one live hold
    const keys = createSpy.mock.calls.map((c) => c[1]?.idempotencyKey);
    expect(keys).toEqual([`bid_hold_${attempt}`, `bid_hold_${attempt}`]);
  });

  it('different attempt ids create different PaymentIntents', async () => {
    const a = await authService.createAuthorizationHold('cus_a', 'pm_a', 3000, 'f4-attempt-1');
    const b = await authService.createAuthorizationHold('cus_a', 'pm_a', 3000, 'f4-attempt-2');

    expect(a.paymentIntentId).not.toBe(b.paymentIntentId);
    expect(issued.size).toBe(2); // a genuine second attempt still authorizes
  });

  it('a malformed attempt id is rejected before Stripe', async () => {
    await expect(
      authService.createAuthorizationHold('cus_a', 'pm_a', 3000, '   '),
    ).rejects.toThrow();

    expect(createSpy).not.toHaveBeenCalled();
    expect(issued.size).toBe(0);
  });
});
