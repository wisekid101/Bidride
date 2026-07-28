/**
 * F3a — capture failure detection, against real PostgreSQL.
 *
 * F5 proved that an invalid capture is refused BEFORE Stripe. This suite covers
 * what happens after Stripe has been called and the call did not succeed: the
 * failure must become a durable, queryable record rather than a log line that
 * scrolls away.
 *
 * The distinction under test is the one that matters operationally:
 *
 *   payment_capture_failed          Stripe refused. Money did NOT move.
 *   payment_capture_outcome_unknown We cannot tell. Money MAY have moved.
 *
 * They are separate event TYPES, not a flag inside metadata, so operations can
 * triage by type alone. Nothing here retries, repairs or reconciles — that is
 * F3b. Stripe is the only stubbed boundary; the service path is real.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { HttpException, HttpStatus, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClient, BidStatus, TripStatus } from '@bidride/database';
import { PaymentService } from './payment.service';
import { LedgerService } from '../ledger/ledger.service';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

// payment-service blocks 9002/9003 belong to the F5 capture-validation suite.
const RIDER_PHONE = '+19995559004';
const DRIVER_PHONE = '+19995559005';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];

const FAILED = 'payment_capture_failed';
const UNKNOWN = 'payment_capture_outcome_unknown';

describe('capture failure detection (integration)', () => {
  let service: PaymentService;
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
  }

  /** A REAL accepted-bid trip with a persisted canonical fare of $23.64. */
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
    tripIds.push(trip.id);
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

  const stripeError = (type: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`simulated ${type}`), { type, ...extra });

  /** Capture and swallow — every test here expects a rejection. */
  const attempt = async (tripId: string, pi: string) => {
    try {
      await service.captureAuthorizationHold(pi, 2364, tripId, riderId);
    } catch (e) {
      return e;
    }
    throw new Error('expected the capture to reject, but it resolved');
  };

  const eventsFor = (tripId: string, eventType?: string) =>
    prisma.tripEvent.findMany({
      where: { tripId, ...(eventType ? { eventType } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    await cleanupDb();
    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: { stripeCustomerId: 'cus_f3a_itest' } } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;
    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: { create: { status: 'approved', legalFirstName: 'F3a', legalLastName: 'Driver', dateOfBirth: new Date('1990-01-01') } },
      },
      include: { driver: true },
    });
    driverId = driverUser.driver!.id;

    const config = { getOrThrow: () => 'sk_test_f3a_never_real', get: () => undefined } as never;
    const redis = { set: jest.fn().mockResolvedValue('OK'), get: jest.fn(), del: jest.fn() } as never;
    service = new PaymentService(
      prisma as never, config, redis,
      new LedgerService(prisma as never), undefined as never, undefined as never,
    );

    captureSpy = jest.fn();
    (service as unknown as { stripe: { paymentIntents: { capture: jest.Mock } } }).stripe = {
      paymentIntents: { capture: captureSpy },
    } as never;
  });

  afterAll(async () => {
    const settle = (w: Promise<unknown> | undefined) => Promise.resolve(w).catch(() => undefined);
    await settle(cleanupDb());
    await settle(prisma.$disconnect());
  });

  beforeEach(() => captureSpy.mockReset());

  // ── Definitive failure ────────────────────────────────────────────────────

  it('a declined card is recorded as payment_capture_failed', async () => {
    const trip = await seedTrip();
    captureSpy.mockRejectedValue(
      stripeError('StripeCardError', { code: 'card_declined', decline_code: 'insufficient_funds' }),
    );

    const err = await attempt(trip.id, 'pi_f3a_declined');

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'CAPTURE_FAILED' });

    const [event] = await eventsFor(trip.id, FAILED);
    expect(event).toBeDefined();
    expect(event.metadata).toMatchObject({
      outcome: 'failed',
      code: 'CAPTURE_FAILED',
      stripeErrorType: 'StripeCardError',
      stripeCode: 'card_declined',
      declineCode: 'insufficient_funds',
      paymentIntentId: 'pi_f3a_declined',
      requestedAmountCents: 2364,
      source: 'payment-service',
    });
  });

  it('a definitive failure books no payment row and no ledger entries', async () => {
    const trip = await seedTrip();
    captureSpy.mockRejectedValue(stripeError('StripeCardError'));

    await attempt(trip.id, 'pi_f3a_nobooking');

    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await prisma.financialLedger.count({ where: { tripId: trip.id } })).toBe(0);
  });

  // ── Unknown outcome ───────────────────────────────────────────────────────

  it('a dropped connection is recorded as payment_capture_outcome_unknown', async () => {
    const trip = await seedTrip();
    captureSpy.mockRejectedValue(stripeError('StripeConnectionError'));

    const err = await attempt(trip.id, 'pi_f3a_conn');

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);

    const [event] = await eventsFor(trip.id, UNKNOWN);
    expect(event).toBeDefined();
    expect(event.metadata).toMatchObject({
      outcome: 'unknown',
      code: 'CAPTURE_OUTCOME_UNKNOWN',
      stripeErrorType: 'StripeConnectionError',
    });
    // Critically: NOT recorded as a failure.
    expect(await eventsFor(trip.id, FAILED)).toHaveLength(0);
  });

  it('an unexpected PaymentIntent status is unknown and is never booked', async () => {
    const trip = await seedTrip();
    captureSpy.mockResolvedValue({ id: 'pi_f3a_status', status: 'requires_action' });

    await attempt(trip.id, 'pi_f3a_status');

    const [event] = await eventsFor(trip.id, UNKNOWN);
    expect(event.metadata).toMatchObject({ outcome: 'unknown' });
    expect((event.metadata as { detail: string }).detail).toContain('requires_action');
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it('an unmodelled error defaults to unknown rather than failed', async () => {
    const trip = await seedTrip();
    captureSpy.mockRejectedValue(new Error('nobody modelled this'));

    await attempt(trip.id, 'pi_f3a_weird');

    expect(await eventsFor(trip.id, UNKNOWN)).toHaveLength(1);
    expect(await eventsFor(trip.id, FAILED)).toHaveLength(0);
  });

  // ── Privacy ───────────────────────────────────────────────────────────────

  it('never persists raw Stripe payloads, card details or customer ids', async () => {
    const trip = await seedTrip();
    captureSpy.mockRejectedValue(
      stripeError('StripeCardError', {
        code: 'card_declined',
        payment_method: { id: 'pm_leak', card: { last4: '4242', fingerprint: 'fp_leak' } },
        customer: 'cus_leak',
        raw: { message: 'contains pm_leak too' },
      }),
    );

    await attempt(trip.id, 'pi_f3a_privacy');

    const [event] = await eventsFor(trip.id, FAILED);
    const serialized = JSON.stringify(event.metadata);
    for (const secret of ['pm_leak', 'fp_leak', 'cus_leak', '4242']) {
      expect(serialized).not.toContain(secret);
    }
  });

  // ── Boundaries with F5 and with success ───────────────────────────────────

  it('an F5 rejection still records fare_integrity_error and never reaches Stripe', async () => {
    const trip = await seedTrip();

    // 2365 ≠ the canonical 2364: F5's gate rejects before Stripe is reached.
    try {
      await service.captureAuthorizationHold('pi_f3a_wrongamount', 2365, trip.id, riderId);
    } catch { /* expected */ }

    expect(captureSpy).not.toHaveBeenCalled();

    expect(await eventsFor(trip.id, 'fare_integrity_error')).not.toHaveLength(0);
    expect(await eventsFor(trip.id, FAILED)).toHaveLength(0);
    expect(await eventsFor(trip.id, UNKNOWN)).toHaveLength(0);
  });

  it('a successful capture records no failure event and books the payment once', async () => {
    const trip = await seedTrip();
    captureSpy.mockResolvedValue({ id: 'pi_f3a_ok', status: 'succeeded' });

    await expect(service.captureAuthorizationHold('pi_f3a_ok', 2364, trip.id, riderId))
      .resolves.toEqual({ status: 'succeeded' });

    const types = (await eventsFor(trip.id)).map((e) => e.eventType);
    expect(types).not.toContain(FAILED);
    expect(types).not.toContain(UNKNOWN);
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it('does not retry — one Stripe call per capture attempt', async () => {
    const trip = await seedTrip();
    captureSpy.mockRejectedValue(stripeError('StripeConnectionError'));

    await attempt(trip.id, 'pi_f3a_noretry');

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  // ── The admin query operations will actually run ──────────────────────────

  it('both event types are retrievable together, newest first', async () => {
    const failedTrip = await seedTrip();
    captureSpy.mockRejectedValue(stripeError('StripeCardError'));
    await attempt(failedTrip.id, 'pi_f3a_q1');

    const unknownTrip = await seedTrip();
    captureSpy.mockRejectedValue(stripeError('StripeAPIError'));
    await attempt(unknownTrip.id, 'pi_f3a_q2');

    const rows = await prisma.tripEvent.findMany({
      where: { eventType: { in: [FAILED, UNKNOWN] }, tripId: { in: [failedTrip.id, unknownTrip.id] } },
      orderBy: { createdAt: 'desc' },
    });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.eventType))).toEqual(new Set([FAILED, UNKNOWN]));
  });
});
