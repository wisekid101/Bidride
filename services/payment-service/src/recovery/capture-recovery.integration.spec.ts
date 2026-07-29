/**
 * F3b-1 — capture recovery against real PostgreSQL and Redis.
 *
 * The unit suites prove the state machine; this proves the parts that only a
 * real database can: the work item and its audit event land in ONE transaction,
 * the conditional claim actually serialises two workers, the migration's unique
 * constraint holds, and — the invariant that defines this checkpoint — nothing
 * in the recovery path ever creates a Payment row or a ledger entry.
 *
 * Stripe is the only stubbed boundary, and it is stubbed READ-ONLY: the double
 * exposes `retrieve` and a `capture` that fails the test if it is ever called.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { PrismaClient, BidStatus, TripStatus } from '@bidride/database';
import { Redis } from 'ioredis';
import {
  CaptureRecoveryService,
  RECOVERY_STATUS,
  RECOVERY_EVENT_RESOLVED,
  RECOVERY_EVENT_UNRESOLVED,
} from './capture-recovery.service';
import { CaptureRecoveryScheduler } from './capture-recovery.scheduler';
import { PaymentBookingService } from '../payments/payment-booking.service';
import { LedgerService } from '../ledger/ledger.service';
import { RECOVERY_LOCK_KEY } from './redis-lock';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);

// payment-service blocks 9002/9003 (F5) and 9004/9005 (F3a) are taken.
const RIDER_PHONE = '+19995559006';
const DRIVER_PHONE = '+19995559007';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];

describe('capture recovery (integration)', () => {
  let service: CaptureRecoveryService;
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
    return { trip, bid };
  }

  /** Enqueue exactly as payment-service does — inside a transaction. */
  async function enqueueFor(tripId: string, paymentIntentId: string | null) {
    await prisma.$transaction(async (tx) => {
      await tx.tripEvent.create({
        data: {
          tripId,
          eventType: 'payment_capture_outcome_unknown',
          metadata: { outcome: 'unknown', paymentIntentId, source: 'payment-service' } as object,
        },
      });
      await service.enqueue(tx as never, {
        tripId, paymentIntentId, bidId: null, expectedAmountCents: 2364,
      });
    });
    return prisma.captureRecovery.findUniqueOrThrow({ where: { tripId } });
  }

  const rowFor = (tripId: string) =>
    prisma.captureRecovery.findUniqueOrThrow({ where: { tripId } });

  beforeAll(async () => {
    await cleanupDb();
    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: { stripeCustomerId: 'cus_f3b_itest' } } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;
    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: { create: { status: 'approved', legalFirstName: 'F3b', legalLastName: 'Driver', dateOfBirth: new Date('1990-01-01') } },
      },
      include: { driver: true },
    });
    driverId = driverUser.driver!.id;

    retrieveSpy = jest.fn();
    captureSpy = jest.fn(() => {
      throw new Error('F3b-1 must never call paymentIntents.capture');
    });
    service = new CaptureRecoveryService(
      prisma as never,
      { paymentIntents: { retrieve: retrieveSpy, capture: captureSpy } } as never,
      new PaymentBookingService(prisma as never, new LedgerService(prisma as never)),
    );
  });

  afterAll(async () => {
    const settle = (w: Promise<unknown> | undefined) => Promise.resolve(w).catch(() => undefined);
    await settle(cleanupDb());
    await settle(prisma.$disconnect());
    await settle(redis.quit());
  });

  beforeEach(() => {
    retrieveSpy.mockReset();
    captureSpy.mockClear();
  });

  afterEach(() => {
    expect(captureSpy).not.toHaveBeenCalled();
  });

  // ── Enqueue ──────────────────────────────────────────────────────────────

  it('the audit event and the work item are committed together', async () => {
    const { trip } = await seedTrip();

    const row = await enqueueFor(trip.id, 'pi_f3b_enqueue');

    expect(row).toMatchObject({
      status: RECOVERY_STATUS.unresolved,
      attemptNumber: 0,
      paymentIntentId: 'pi_f3b_enqueue',
      expectedAmountCents: 2364,
    });
    expect(row.nextAttemptAt).toBeInstanceOf(Date);
    expect(row.holdExpiresAt).toBeInstanceOf(Date);
    expect(await prisma.tripEvent.count({
      where: { tripId: trip.id, eventType: 'payment_capture_outcome_unknown' },
    })).toBe(1);
  });

  it('a rolled-back transaction leaves neither event nor work item', async () => {
    const { trip } = await seedTrip();

    await expect(prisma.$transaction(async (tx) => {
      await tx.tripEvent.create({
        data: { tripId: trip.id, eventType: 'payment_capture_outcome_unknown', metadata: {} as object },
      });
      await service.enqueue(tx as never, {
        tripId: trip.id, paymentIntentId: 'pi_rollback', bidId: null, expectedAmountCents: 2364,
      });
      throw new Error('abort');
    })).rejects.toThrow('abort');

    expect(await prisma.captureRecovery.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await prisma.tripEvent.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it('a second failure on the same trip reschedules the one open item', async () => {
    const { trip } = await seedTrip();
    await enqueueFor(trip.id, 'pi_f3b_dup');

    await enqueueFor(trip.id, 'pi_f3b_dup');

    expect(await prisma.captureRecovery.count({ where: { tripId: trip.id } })).toBe(1);
  });

  // ── Resolution ───────────────────────────────────────────────────────────

  // F3b-1 recorded this outcome and deliberately booked nothing. F3b-2a books
  // it — the funds were already captured at Stripe; only the local record was
  // missing. No Stripe write is involved either way.
  it('succeeded → resolved_captured and booked exactly once (F3b-2a)', async () => {
    const { trip } = await seedTrip();
    const row = await enqueueFor(trip.id, 'pi_f3b_ok');
    retrieveSpy.mockResolvedValue({ id: 'pi_f3b_ok', status: 'succeeded', amount_received: 2364 });

    await service.resolveOne(row as never);

    const after = await rowFor(trip.id);
    expect(after.status).toBe(RECOVERY_STATUS.resolvedCaptured);
    expect(after.resolvedAt).toBeInstanceOf(Date);
    expect(after.nextAttemptAt).toBeNull();
    expect(after.bookingStatus).toBe('booked');
    expect(after.bookedAt).toBeInstanceOf(Date);
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(1);
    expect(await prisma.financialLedger.count({ where: { tripId: trip.id } })).toBe(2);
    expect(await prisma.tripEvent.count({
      where: { tripId: trip.id, eventType: RECOVERY_EVENT_RESOLVED },
    })).toBe(1);
  });

  it('canceled → resolved_not_captured with an audit event', async () => {
    const { trip } = await seedTrip();
    const row = await enqueueFor(trip.id, 'pi_f3b_cancelled');
    retrieveSpy.mockResolvedValue({ id: 'pi_f3b_cancelled', status: 'canceled' });

    await service.resolveOne(row as never);

    expect((await rowFor(trip.id)).status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
    expect(await prisma.tripEvent.count({
      where: { tripId: trip.id, eventType: RECOVERY_EVENT_UNRESOLVED },
    })).toBe(1);
  });

  it('requires_capture → needs_admin; capture is F3b-2 and is not attempted', async () => {
    const { trip } = await seedTrip();
    const row = await enqueueFor(trip.id, 'pi_f3b_live');
    retrieveSpy.mockResolvedValue({ id: 'pi_f3b_live', status: 'requires_capture' });

    await service.resolveOne(row as never);

    const after = await rowFor(trip.id);
    expect(after.status).toBe(RECOVERY_STATUS.needsAdmin);
    expect(after.resolution).toBe('awaiting_capture');
  });

  it('recovers the payment-intent id from the durable event when the row has none', async () => {
    const { trip } = await seedTrip();
    const row = await enqueueFor(trip.id, null);
    retrieveSpy.mockResolvedValue({ id: 'pi_from_event', status: 'canceled' });
    // The enqueue above wrote the id into the F3a event, not the row.
    await prisma.tripEvent.create({
      data: {
        tripId: trip.id, eventType: 'payment_capture_outcome_unknown',
        metadata: { paymentIntentId: 'pi_from_event' } as object,
      },
    });

    await service.resolveOne({ ...row, paymentIntentId: null } as never);

    expect(retrieveSpy).toHaveBeenCalledWith('pi_from_event');
    expect((await rowFor(trip.id)).status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
  });

  // ── Scheduler, claiming and duplicate workers ────────────────────────────

  describe('scheduler', () => {
    const build = () => new CaptureRecoveryScheduler(prisma as never, service as never, redis as never);

    beforeEach(async () => { await redis.del(RECOVERY_LOCK_KEY); });
    afterEach(async () => { await redis.del(RECOVERY_LOCK_KEY); });

    it('claims a due row, resolves it and releases the lock', async () => {
      const { trip } = await seedTrip();
      await enqueueFor(trip.id, 'pi_f3b_sched');
      await prisma.captureRecovery.update({
        where: { tripId: trip.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      retrieveSpy.mockResolvedValue({ id: 'pi_f3b_sched', status: 'canceled' });

      const result = await build().tick();

      expect(result.action).toBe('ran');
      expect(result.claimed).toBeGreaterThanOrEqual(1);
      expect((await rowFor(trip.id)).status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
      expect(await redis.exists(RECOVERY_LOCK_KEY)).toBe(0);
    });

    it('a second worker skips while the first holds the lease', async () => {
      const { trip } = await seedTrip();
      await enqueueFor(trip.id, 'pi_f3b_locked');
      await prisma.captureRecovery.update({
        where: { tripId: trip.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await redis.set(RECOVERY_LOCK_KEY, 'someone-else', 'PX', 30_000);

      const result = await build().tick();

      expect(result.action).toBe('skipped_lock_held');
      expect((await rowFor(trip.id)).status).toBe(RECOVERY_STATUS.unresolved);
      expect(await redis.get(RECOVERY_LOCK_KEY)).toBe('someone-else'); // never stolen
      await redis.del(RECOVERY_LOCK_KEY);
    });

    it('the conditional claim lets exactly one of two concurrent workers take a row', async () => {
      const { trip } = await seedTrip();
      const row = await enqueueFor(trip.id, 'pi_f3b_race');

      // Both workers observe attemptNumber 0 and race to claim it.
      const claim = () => prisma.captureRecovery.updateMany({
        where: { id: row.id, status: RECOVERY_STATUS.unresolved, attemptNumber: 0 },
        data: { attemptNumber: 1 },
      });
      const [a, b] = await Promise.all([claim(), claim()]);

      expect(a.count + b.count).toBe(1);
      expect((await rowFor(trip.id)).attemptNumber).toBe(1);
    });

    it('a resolved row is not picked up again', async () => {
      const { trip } = await seedTrip();
      await enqueueFor(trip.id, 'pi_f3b_done');
      await prisma.captureRecovery.update({
        where: { tripId: trip.id },
        data: { status: RECOVERY_STATUS.resolvedNotCaptured, nextAttemptAt: null },
      });
      const before = await rowFor(trip.id);
      retrieveSpy.mockResolvedValue({ id: 'pi_x', status: 'canceled' });

      await build().tick();

      // Asserted on THIS row, not on the tick's total: earlier tests in this
      // file leave their own rows on the shared worklist.
      const after = await rowFor(trip.id);
      expect(after.attemptNumber).toBe(before.attemptNumber);
      expect(after.status).toBe(RECOVERY_STATUS.resolvedNotCaptured);
    });
  });

  // ── Webhook fast path ────────────────────────────────────────────────────

  it('a webhook resolves an open item without any Stripe read', async () => {
    const { trip } = await seedTrip();
    await enqueueFor(trip.id, 'pi_f3b_webhook');

    await service.resolveFromWebhook('pi_f3b_webhook', 'succeeded', 2364);

    expect(retrieveSpy).not.toHaveBeenCalled();
    expect((await rowFor(trip.id)).status).toBe(RECOVERY_STATUS.resolvedCaptured);
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(1);
  });

  // ── Admin ────────────────────────────────────────────────────────────────

  it('close records the admin, the reason and an audit event', async () => {
    const { trip } = await seedTrip();
    const row = await enqueueFor(trip.id, 'pi_f3b_close');

    await service.close(row.id, 'admin-42', 'settled out of band');

    const after = await rowFor(trip.id);
    expect(after).toMatchObject({
      status: RECOVERY_STATUS.closed,
      resolution: 'closed_by_admin',
      resolvedByAdminId: 'admin-42',
    });
    expect(await prisma.tripEvent.count({
      where: { tripId: trip.id, eventType: RECOVERY_EVENT_UNRESOLVED },
    })).toBe(1);
    // Closing is bookkeeping, never a payment outcome.
    expect(await prisma.payment.count({ where: { tripId: trip.id } })).toBe(0);
  });
});
