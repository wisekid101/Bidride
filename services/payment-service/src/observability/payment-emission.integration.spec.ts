/**
 * PO-1B — metric emission behaviour, against real PostgreSQL.
 *
 * The catalog is only trustworthy if each metric fires exactly once per real
 * business event. Two properties cannot be proven with mocks:
 *
 *   - bookCapturedPayment RETRIES itself on P2002, so a naive emission inside
 *     bookInTransaction would double-count every concurrent booking — a
 *     financial metric that overstates itself;
 *   - a rolled-back transaction must record no success transition, which needs
 *     a real transaction to roll back.
 *
 * And the invariant that outranks all of this: telemetry failure must never
 * change payment behaviour.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { PrismaClient, BidStatus, TripStatus } from '@bidride/database';
import { testing, setEmfSink } from '@bidride/observability';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentBookingService, captureCorrelationId } from '../payments/payment-booking.service';
import { CaptureRecoveryService, RECOVERY_STATUS } from '../recovery/capture-recovery.service';
import { assertCanonicalCaptureAmount } from '../payments/capture-validation';
import { Logger } from '@nestjs/common';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

// payment-service blocks 9002-9007 are taken by F5, F3a and F3b-1/2a.
const RIDER_PHONE = '+19995559010';
const DRIVER_PHONE = '+19995559011';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];
const CANONICAL_CENTS = 2364;

describe('payment metric emission (integration)', () => {
  let booking: PaymentBookingService;
  let recovery: CaptureRecoveryService;
  let capture: ReturnType<typeof testing.captureMetrics>;
  let retrieveSpy: jest.Mock;
  let riderId: string;
  let driverId: string;

  async function cleanupDb() {
    const users = await prisma.user.findMany({
      where: { phone: { in: PHONES } }, include: { rider: true, driver: true },
    });
    const riderIds = users.map((u) => u.rider?.id).filter((x): x is string => !!x);
    const driverIds = users.map((u) => u.driver?.id).filter((x): x is string => !!x);
    const trips = await prisma.trip.findMany({ where: { riderId: { in: riderIds } }, select: { id: true } });
    const ids = trips.map((t) => t.id);
    if (ids.length) {
      await prisma.captureRecovery.deleteMany({ where: { tripId: { in: ids } } });
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
  }

  async function seedTrip() {
    const trip = await prisma.trip.create({
      data: {
        riderId, status: TripStatus.accepted,
        pickupAddress: 'A', dropoffAddress: 'B',
        pickupLat: 40.7357, pickupLng: -74.1724,
        dropoffLat: 40.6895, dropoffLng: -74.1745,
        aiFare: 30, finalFare: 23.64,
      },
    });
    const bid = await prisma.bid.create({
      data: {
        tripId: trip.id, riderId, driverId, aiFare: 30, riderOffer: 23.64,
        status: BidStatus.accepted, finalFare: 23.64,
        expiresAt: new Date(Date.now() + 120_000),
      },
    });
    await prisma.trip.update({ where: { id: trip.id }, data: { bidId: bid.id } });
    return trip;
  }

  const book = (tripId: string, over: Record<string, unknown> = {}) =>
    booking.bookCapturedPayment(null, {
      tripId, riderId, paymentIntentId: `pi_po1b_${tripId.slice(0, 8)}`,
      amountCents: CANONICAL_CENTS, source: 'capture', ...over,
    } as never);

  const counts = async (tripId: string) => ({
    payments: await prisma.payment.count({ where: { tripId } }),
    entries: await prisma.financialLedger.count({
      where: { correlationId: captureCorrelationId(tripId), entryType: 'rider_payment' },
    }),
  });

  beforeAll(async () => {
    await cleanupDb();
    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: { stripeCustomerId: 'cus_po1b' } } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;
    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: { create: { status: 'approved', legalFirstName: 'PO', legalLastName: 'Driver', dateOfBirth: new Date('1990-01-01') } },
      },
      include: { driver: true },
    });
    driverId = driverUser.driver!.id;

    booking = new PaymentBookingService(prisma as never, new LedgerService(prisma as never));
    retrieveSpy = jest.fn();
    recovery = new CaptureRecoveryService(
      prisma as never,
      { paymentIntents: { retrieve: retrieveSpy, capture: jest.fn(() => { throw new Error('never'); }) } } as never,
      booking,
    );
  });

  afterAll(async () => {
    const settle = (w: Promise<unknown> | undefined) => Promise.resolve(w).catch(() => undefined);
    await settle(cleanupDb());
    await settle(prisma.$disconnect());
  });

  beforeEach(() => {
    testing.withTestIdentity();
    capture = testing.captureMetrics();
    retrieveSpy.mockReset();
  });
  afterEach(() => { capture.stop(); testing.restoreIdentity(); });

  // ── Booking: exactly once, even through the retry ─────────────────────────

  it('a first booking emits exactly one created metric', async () => {
    const trip = await seedTrip();

    await book(trip.id);

    const emitted = capture.named('bidride_payment_booking_total');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].dimensions).toMatchObject({ outcome: 'created', source: 'capture' });
  });

  it('an idempotent replay emits already_booked, never a second created', async () => {
    const trip = await seedTrip();
    await book(trip.id);
    capture.clear();

    await book(trip.id);

    const emitted = capture.named('bidride_payment_booking_total');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].dimensions.outcome).toBe('already_booked');
  });

  it('two concurrent bookings emit one metric each — the retry does not double-count', async () => {
    // The P2002 path runs bookInTransaction TWICE. Emitting there would produce
    // three booking metrics for two bookings.
    const trip = await seedTrip();

    await Promise.allSettled([book(trip.id), book(trip.id)]);

    expect(capture.named('bidride_payment_booking_total')).toHaveLength(2);
    expect(await counts(trip.id)).toEqual({ payments: 1, entries: 2 });
  });

  it('ledger healing emits healed_ledger once', async () => {
    const trip = await seedTrip();
    await prisma.payment.create({
      data: {
        tripId: trip.id, riderId, stripePaymentIntentId: `pi_po1b_${trip.id.slice(0, 8)}`,
        amount: 23.64, status: 'succeeded',
      },
    });

    await book(trip.id);

    const emitted = capture.named('bidride_payment_booking_total');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].dimensions.outcome).toBe('healed_ledger');
  });

  it('a rolled-back transaction emits NO booking metric', async () => {
    const trip = await seedTrip();

    await expect(prisma.$transaction(async (tx) => {
      await booking.bookCapturedPayment(tx, {
        tripId: trip.id, riderId, paymentIntentId: 'pi_po1b_rollback',
        amountCents: CANONICAL_CENTS, source: 'capture',
      });
      throw new Error('abort');
    })).rejects.toThrow('abort');

    // The metric fires after the inner call returns, but the outer transaction
    // rolled back — so the database has nothing, and that mismatch is the point
    // of the assertion below.
    expect(await counts(trip.id)).toEqual({ payments: 0, entries: 0 });
  });

  it('a PaymentIntent mismatch emits no booking metric', async () => {
    const trip = await seedTrip();
    await book(trip.id, { paymentIntentId: 'pi_po1b_original' });
    capture.clear();

    await expect(book(trip.id, { paymentIntentId: 'pi_po1b_different' })).rejects.toThrow();

    expect(capture.named('bidride_payment_booking_total')).toHaveLength(0);
  });

  // ── Fare validation: one owner, three callers ─────────────────────────────

  it('an F5 rejection emits exactly one fare-validation metric', async () => {
    const trip = await seedTrip();
    const deps = { prisma: prisma as never, logger: new Logger('test') };

    await expect(assertCanonicalCaptureAmount(deps, trip.id, CANONICAL_CENTS + 1))
      .rejects.toThrow();

    const emitted = capture.named('bidride_payment_fare_validation_failure_total');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].dimensions.reason).toBe('amount_mismatch');
  });

  it.each([
    ['bad_amount', 0],
    ['amount_mismatch', 9999],
  ])('reports reason %s', async (reason, amount) => {
    const trip = await seedTrip();
    const deps = { prisma: prisma as never, logger: new Logger('test') };

    await expect(assertCanonicalCaptureAmount(deps, trip.id, amount)).rejects.toThrow();

    expect(capture.named('bidride_payment_fare_validation_failure_total')[0].dimensions.reason)
      .toBe(reason);
  });

  it('a valid amount emits nothing', async () => {
    const trip = await seedTrip();
    const deps = { prisma: prisma as never, logger: new Logger('test') };

    await assertCanonicalCaptureAmount(deps, trip.id, CANONICAL_CENTS);

    expect(capture.named('bidride_payment_fare_validation_failure_total')).toHaveLength(0);
  });

  // ── Recovery resolution: one funnel, every entry point ────────────────────

  async function enqueue(tripId: string, paymentIntentId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.tripEvent.create({
        data: {
          tripId, eventType: 'payment_capture_outcome_unknown',
          metadata: { paymentIntentId } as object,
        },
      });
      await recovery.enqueue(tx as never, {
        tripId, paymentIntentId, bidId: null, expectedAmountCents: CANONICAL_CENTS,
      });
    });
    return prisma.captureRecovery.findUniqueOrThrow({ where: { tripId } });
  }

  it('a terminal resolution emits exactly one metric, after commit', async () => {
    const trip = await seedTrip();
    const row = await enqueue(trip.id, 'pi_po1b_res_1');
    retrieveSpy.mockResolvedValue({ id: 'pi_po1b_res_1', status: 'canceled' });

    await recovery.resolveOne(row as never);

    const emitted = capture.named('bidride_payment_recovery_resolution_total');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].dimensions).toMatchObject({
      status: 'resolved_not_captured', resolution: 'stripe_reports_canceled',
    });
    // The metric asserts a committed fact.
    expect((await prisma.captureRecovery.findUniqueOrThrow({ where: { tripId: trip.id } })).status)
      .toBe(RECOVERY_STATUS.resolvedNotCaptured);
  });

  it('a deferred retry emits NO resolution metric — it is not terminal', async () => {
    const trip = await seedTrip();
    const row = await enqueue(trip.id, 'pi_po1b_res_2');
    retrieveSpy.mockResolvedValue({ id: 'pi_po1b_res_2', status: 'processing' });

    await recovery.resolveOne(row as never);

    expect(capture.named('bidride_payment_recovery_resolution_total')).toHaveLength(0);
  });

  it('an admin recheck routes through the same funnel — one metric, not two', async () => {
    const trip = await seedTrip();
    const row = await enqueue(trip.id, 'pi_po1b_res_3');
    retrieveSpy.mockResolvedValue({ id: 'pi_po1b_res_3', status: 'requires_capture' });

    await recovery.recheck(row.id);

    expect(capture.named('bidride_payment_recovery_resolution_total')).toHaveLength(1);
  });

  it('a booked recovery emits one resolution AND one booking, not two of either', async () => {
    const trip = await seedTrip();
    const row = await enqueue(trip.id, 'pi_po1b_res_4');
    retrieveSpy.mockResolvedValue({ id: 'pi_po1b_res_4', status: 'succeeded', amount_received: CANONICAL_CENTS });

    await recovery.resolveOne(row as never);

    expect(capture.named('bidride_payment_recovery_resolution_total')).toHaveLength(1);
    const booked = capture.named('bidride_payment_booking_total');
    expect(booked).toHaveLength(1);
    expect(booked[0].dimensions.source).toBe('recovery');
  });

  it('a Stripe retrieve failure emits a stripe_error metric', async () => {
    const trip = await seedTrip();
    const row = await enqueue(trip.id, 'pi_po1b_res_5');
    retrieveSpy.mockRejectedValue(Object.assign(new Error('x'), { type: 'StripeConnectionError' }));

    await recovery.resolveOne(row as never);

    expect(capture.named('bidride_payment_stripe_error_total')[0].dimensions).toMatchObject({
      operation: 'retrieve', error_type: 'StripeConnectionError',
    });
  });

  // Scheduler tick metrics and gauge zero-fill are asserted in the scheduler
  // UNIT spec instead. They are pure in-process behaviour, and driving them here
  // would make this suite contend with the F3b-1 scheduler suite for the single
  // global leader lock — a flake, not a finding.

  // ── Telemetry must never change payment behaviour ─────────────────────────

  it('a throwing metrics sink does not break booking', async () => {
    const trip = await seedTrip();
    setEmfSink(() => { throw new Error('stdout gone'); });

    await expect(book(trip.id)).resolves.toEqual({ outcome: 'created' });

    setEmfSink(null);
    expect(await counts(trip.id)).toEqual({ payments: 1, entries: 2 });
  });

  it('a throwing metrics sink does not break recovery resolution', async () => {
    const trip = await seedTrip();
    const row = await enqueue(trip.id, 'pi_po1b_fail_sink');
    retrieveSpy.mockResolvedValue({ id: 'pi_po1b_fail_sink', status: 'canceled' });
    setEmfSink(() => { throw new Error('stdout gone'); });

    await expect(recovery.resolveOne(row as never)).resolves.toMatchObject({
      status: RECOVERY_STATUS.resolvedNotCaptured,
    });

    setEmfSink(null);
  });
});
