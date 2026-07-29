/**
 * F3b-2a — atomic booking and ledger healing, against real PostgreSQL.
 *
 * Mocks cannot prove what this checkpoint is actually about. The guarantees are
 * enforced by database constraints — `Payment.tripId` unique and
 * FinancialLedger unique on (correlationId, accountId, direction) — so the only
 * way to know they hold is to run real concurrent writers against a real
 * database and count the rows afterwards.
 *
 * Every scenario ends with the same two assertions: exactly one Payment row and
 * exactly two ledger entries.
 *
 * No Stripe client is involved. Nothing here can call capture, because nothing
 * here can reach Stripe at all.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { PrismaClient, BidStatus, TripStatus } from '@bidride/database';
import { LedgerService } from '../ledger/ledger.service';
import {
  PaymentBookingService,
  PaymentIntentMismatchError,
  captureCorrelationId,
} from './payment-booking.service';
import { CaptureRecoveryService, RECOVERY_STATUS } from '../recovery/capture-recovery.service';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

// payment-service blocks 9002-9007 are taken by the F5, F3a and F3b-1 suites.
const RIDER_PHONE = '+19995559008';
const DRIVER_PHONE = '+19995559009';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];

const CANONICAL_FARE = 23.64;
const CANONICAL_CENTS = 2364;

describe('capture booking and ledger healing (integration)', () => {
  let booking: PaymentBookingService;
  let recovery: CaptureRecoveryService;
  let retrieveSpy: jest.Mock;
  let captureSpy: jest.Mock;

  let riderId: string;
  let driverId: string;

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
        aiFare: 30, finalFare: CANONICAL_FARE,
      },
    });
    const bid = await prisma.bid.create({
      data: {
        tripId: trip.id, riderId, driverId, aiFare: 30, riderOffer: CANONICAL_FARE,
        status: BidStatus.accepted, finalFare: CANONICAL_FARE,
        expiresAt: new Date(Date.now() + 120_000),
      },
    });
    await prisma.trip.update({ where: { id: trip.id }, data: { bidId: bid.id } });
    return trip;
  }

  const book = (tripId: string, over: Record<string, unknown> = {}) =>
    booking.bookCapturedPayment(null, {
      tripId, riderId, paymentIntentId: `pi_${tripId.slice(0, 8)}`,
      amountCents: CANONICAL_CENTS, source: 'capture', ...over,
    } as never);

  const counts = async (tripId: string) => ({
    payments: await prisma.payment.count({ where: { tripId } }),
    entries: await prisma.financialLedger.count({
      where: { correlationId: captureCorrelationId(tripId), entryType: 'rider_payment' },
    }),
  });

  /** The assertion every scenario ends with. */
  const expectExactlyOneBooking = async (tripId: string) => {
    expect(await counts(tripId)).toEqual({ payments: 1, entries: 2 });
  };

  beforeAll(async () => {
    await cleanupDb();
    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: { stripeCustomerId: 'cus_f3b2a' } } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;
    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: { create: { status: 'approved', legalFirstName: 'F3b2a', legalLastName: 'Driver', dateOfBirth: new Date('1990-01-01') } },
      },
      include: { driver: true },
    });
    driverId = driverUser.driver!.id;

    booking = new PaymentBookingService(prisma as never, new LedgerService(prisma as never));

    retrieveSpy = jest.fn();
    captureSpy = jest.fn(() => {
      throw new Error('F3b-2a must never call paymentIntents.capture');
    });
    recovery = new CaptureRecoveryService(
      prisma as never,
      { paymentIntents: { retrieve: retrieveSpy, capture: captureSpy } } as never,
      booking,
    );
  });

  afterAll(async () => {
    const settle = (w: Promise<unknown> | undefined) => Promise.resolve(w).catch(() => undefined);
    await settle(cleanupDb());
    await settle(prisma.$disconnect());
  });

  beforeEach(() => retrieveSpy.mockReset());
  afterEach(() => expect(captureSpy).not.toHaveBeenCalled());

  // ── Outcomes ──────────────────────────────────────────────────────────────

  it('Payment absent and ledger absent → created', async () => {
    const trip = await seedTrip();

    const { outcome } = await book(trip.id);

    expect(outcome).toBe('created');
    await expectExactlyOneBooking(trip.id);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { tripId: trip.id } });
    expect(Number(payment.amount)).toBe(CANONICAL_FARE);
    expect(payment.status).toBe('succeeded');
  });

  it('a replay of the same booking → already_booked, still one of each', async () => {
    const trip = await seedTrip();
    await book(trip.id);

    const { outcome } = await book(trip.id);

    expect(outcome).toBe('already_booked');
    await expectExactlyOneBooking(trip.id);
  });

  it('Payment exists with no ledger (the pre-F3b-2a state) → healed_ledger', async () => {
    const trip = await seedTrip();
    // Exactly what the old fire-and-forget ledger write could leave behind.
    await prisma.payment.create({
      data: {
        tripId: trip.id, riderId, stripePaymentIntentId: `pi_${trip.id.slice(0, 8)}`,
        amount: CANONICAL_FARE, status: 'succeeded',
      },
    });

    const { outcome } = await book(trip.id);

    expect(outcome).toBe('healed_ledger');
    await expectExactlyOneBooking(trip.id);
  });

  it('a half-written pair is completed, never duplicated', async () => {
    const trip = await seedTrip();
    await prisma.payment.create({
      data: {
        tripId: trip.id, riderId, stripePaymentIntentId: `pi_${trip.id.slice(0, 8)}`,
        amount: CANONICAL_FARE, status: 'succeeded',
      },
    });
    await prisma.financialLedger.create({
      data: {
        correlationId: captureCorrelationId(trip.id), entryType: 'rider_payment',
        accountType: 'rider', accountId: riderId, direction: 'debit',
        amount: CANONICAL_FARE, tripId: trip.id, sourceEvent: 'payment:capture',
      },
    });

    const { outcome } = await book(trip.id);

    expect(outcome).toBe('healed_ledger');
    await expectExactlyOneBooking(trip.id);
  });

  it('a different PaymentIntent for the same trip fails closed', async () => {
    const trip = await seedTrip();
    await book(trip.id);

    await expect(book(trip.id, { paymentIntentId: 'pi_someone_else' }))
      .rejects.toBeInstanceOf(PaymentIntentMismatchError);

    await expectExactlyOneBooking(trip.id);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { tripId: trip.id } });
    expect(payment.stripePaymentIntentId).not.toBe('pi_someone_else');
  });

  // ── Concurrency, against the real constraints ────────────────────────────

  it('two concurrent bookings of the same trip produce one payment and one pair', async () => {
    const trip = await seedTrip();

    const results = await Promise.allSettled([book(trip.id), book(trip.id)]);

    expect(results.filter((r) => r.status === 'fulfilled')).not.toHaveLength(0);
    await expectExactlyOneBooking(trip.id);
  });

  it('capture racing recovery produces one payment and one pair', async () => {
    const trip = await seedTrip();

    await Promise.allSettled([
      book(trip.id, { source: 'capture' }),
      book(trip.id, { source: 'recovery', recoveryId: 'rec-x' }),
    ]);

    await expectExactlyOneBooking(trip.id);
  });

  it('a duplicate webhook replay produces one payment and one pair', async () => {
    const trip = await seedTrip();

    await Promise.allSettled([
      book(trip.id, { source: 'webhook' }),
      book(trip.id, { source: 'webhook' }),
      book(trip.id, { source: 'webhook' }),
    ]);

    await expectExactlyOneBooking(trip.id);
  });

  it('the correlation is capture:${tripId} regardless of source', async () => {
    const trip = await seedTrip();

    await book(trip.id, { source: 'recovery', recoveryId: 'rec-y' });

    const rows = await prisma.financialLedger.findMany({ where: { tripId: trip.id } });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.correlationId).toBe(`capture:${trip.id}`);
  });

  it('a rollback leaves neither Payment nor ledger', async () => {
    const trip = await seedTrip();

    await expect(prisma.$transaction(async (tx) => {
      await booking.bookCapturedPayment(tx, {
        tripId: trip.id, riderId, paymentIntentId: 'pi_rollback',
        amountCents: CANONICAL_CENTS, source: 'capture',
      });
      throw new Error('abort');
    })).rejects.toThrow('abort');

    expect(await counts(trip.id)).toEqual({ payments: 0, entries: 0 });
  });

  // ── Path A: recovery books what Stripe already captured ──────────────────

  describe('recovery Path A', () => {
    async function enqueue(tripId: string, paymentIntentId: string) {
      await prisma.$transaction(async (tx) => {
        await tx.tripEvent.create({
          data: {
            tripId, eventType: 'payment_capture_outcome_unknown',
            metadata: { outcome: 'unknown', paymentIntentId } as object,
          },
        });
        await recovery.enqueue(tx as never, {
          tripId, paymentIntentId, bidId: null, expectedAmountCents: CANONICAL_CENTS,
        });
      });
      return prisma.captureRecovery.findUniqueOrThrow({ where: { tripId } });
    }

    it('Stripe already succeeded → books and resolves captured_and_booked', async () => {
      const trip = await seedTrip();
      const row = await enqueue(trip.id, 'pi_pathA_1');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_1', status: 'succeeded', amount_received: CANONICAL_CENTS });

      const out = await recovery.resolveOne(row as never);

      expect(out.status).toBe(RECOVERY_STATUS.resolvedCaptured);
      expect(out.resolution).toBe('captured_and_booked');
      await expectExactlyOneBooking(trip.id);

      const after = await prisma.captureRecovery.findUniqueOrThrow({ where: { tripId: trip.id } });
      expect(after.bookingStatus).toBe('booked');
      expect(after.bookedAt).toBeInstanceOf(Date);
      expect(after.lastStripeStatus).toBe('succeeded');
    });

    it('already booked by the normal path → captured_already_booked, nothing duplicated', async () => {
      const trip = await seedTrip();
      await book(trip.id, { paymentIntentId: 'pi_pathA_2' });
      const row = await enqueue(trip.id, 'pi_pathA_2');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_2', status: 'succeeded', amount_received: CANONICAL_CENTS });

      const out = await recovery.resolveOne(row as never);

      expect(out.resolution).toBe('captured_already_booked');
      await expectExactlyOneBooking(trip.id);
    });

    it('Payment without ledger → captured_ledger_healed', async () => {
      const trip = await seedTrip();
      await prisma.payment.create({
        data: {
          tripId: trip.id, riderId, stripePaymentIntentId: 'pi_pathA_3',
          amount: CANONICAL_FARE, status: 'succeeded',
        },
      });
      const row = await enqueue(trip.id, 'pi_pathA_3');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_3', status: 'succeeded', amount_received: CANONICAL_CENTS });

      const out = await recovery.resolveOne(row as never);

      expect(out.resolution).toBe('captured_ledger_healed');
      const after = await prisma.captureRecovery.findUniqueOrThrow({ where: { tripId: trip.id } });
      expect(after.bookingStatus).toBe('healed');
      await expectExactlyOneBooking(trip.id);
    });

    it('an amount F5 rejects is never booked', async () => {
      const trip = await seedTrip();
      const row = await enqueue(trip.id, 'pi_pathA_4');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_4', status: 'succeeded', amount_received: 1900 });

      const out = await recovery.resolveOne(row as never);

      expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
      expect(out.resolution).toBe('amount_mismatch');
      expect(await counts(trip.id)).toEqual({ payments: 0, entries: 0 });
    });

    it('a PaymentIntent mismatch fails closed and books nothing new', async () => {
      const trip = await seedTrip();
      await book(trip.id, { paymentIntentId: 'pi_original' });
      const row = await enqueue(trip.id, 'pi_different');
      retrieveSpy.mockResolvedValue({ id: 'pi_different', status: 'succeeded', amount_received: CANONICAL_CENTS });

      const out = await recovery.resolveOne(row as never);

      expect(out.status).toBe(RECOVERY_STATUS.needsAdmin);
      expect(out.resolution).toBe('payment_intent_mismatch');
      await expectExactlyOneBooking(trip.id);
    });

    it('requires_capture is still handed to a human — F3b-2a never captures', async () => {
      const trip = await seedTrip();
      const row = await enqueue(trip.id, 'pi_pathA_5');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_5', status: 'requires_capture' });

      const out = await recovery.resolveOne(row as never);

      expect(out.resolution).toBe('awaiting_capture');
      expect(await counts(trip.id)).toEqual({ payments: 0, entries: 0 });
    });

    it('a crash after booking heals on the next pass: already_booked, nothing duplicated', async () => {
      const trip = await seedTrip();
      const row = await enqueue(trip.id, 'pi_pathA_6');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_6', status: 'succeeded', amount_received: CANONICAL_CENTS });

      await recovery.resolveOne(row as never);
      // Simulate the crash: the row never got its terminal update.
      await prisma.captureRecovery.update({
        where: { tripId: trip.id },
        data: {
          status: RECOVERY_STATUS.unresolved, resolution: null,
          bookingStatus: null, bookedAt: null, resolvedAt: null,
        },
      });
      const resumed = await prisma.captureRecovery.findUniqueOrThrow({ where: { tripId: trip.id } });

      const out = await recovery.resolveOne(resumed as never);

      expect(out.resolution).toBe('captured_already_booked');
      await expectExactlyOneBooking(trip.id);
    });

    it('two recovery workers on one row produce one payment and one pair', async () => {
      const trip = await seedTrip();
      const row = await enqueue(trip.id, 'pi_pathA_7');
      retrieveSpy.mockResolvedValue({ id: 'pi_pathA_7', status: 'succeeded', amount_received: CANONICAL_CENTS });

      await Promise.allSettled([
        recovery.resolveOne(row as never),
        recovery.resolveOne(row as never),
      ]);

      await expectExactlyOneBooking(trip.id);
    });
  });
});
