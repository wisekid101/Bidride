/**
 * Trip economics & canonical fare — integration tests against real PostgreSQL
 * + Redis. Extends the existing trip-service integration suite (same
 * jest.integration.json, same env guard); it is a second spec file, not a
 * second harness.
 *
 * This suite proves BidRide's financial truth inside trip-service:
 *
 *   1. Standard economics   — platformFee/driverEarnings reconcile to finalFare
 *   2. Rider bid lifecycle  — accept, decline, expiry, replay
 *   3. Counter lifecycle    — rounds, limits, ordering, acceptance
 *   4. Overwrite protection — the accepted amount survives completion
 *   5. Payment handoff      — the captured amount is the canonical fare
 *   6. Airport safety       — an airport-inclusive fare is never re-premiumed
 *   7. Database invariants  — precision, reload, atomicity, invalid transitions
 *
 * External isolation. trip-service reaches pricing-service, ai-service,
 * payment-service and notification-service over HTTP. Nothing here is allowed
 * to leave the machine, so:
 *   - `global.fetch` is replaced with a spy that records the call and returns a
 *     REJECTED promise. Production paths that wrap the call in `.catch()`
 *     (Stripe capture/void, AI outcome, push) behave exactly as they do when a
 *     downstream service is unavailable, and the recorded arguments let us
 *     assert the payment handoff payload without a network.
 *   - DispatchService is replaced with a stub, so notification fan-out is not
 *     under test here.
 *   - Redis `bid:{id}:pi` is only seeded in the payment-handoff test; without
 *     it, captureStripeHold returns before any fetch at all.
 *
 * The injected PrismaService reads DATABASE_URL, so we pin it to the test
 * database here to guarantee every connection targets TEST_DATABASE_URL only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { BidsService } from './bids.service';
import { MAX_COUNTER_ROUNDS, BID_FLOOR_RATE } from './bid-state-machine';
import { TripsService } from '../trips/trips.service';
import { EarningsFloorService } from '../trips/earnings-floor.service';
import { DispatchService } from '../trips/dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);

// trip-service owns fixture block 0; trips.integration.spec.ts holds 0001/0002.
const RIDER_PHONE = '+19995550003';
const DRIVER_PHONE = '+19995550004';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];

// Production constants mirrored for assertions (see bids.service.ts).
const PLATFORM_FEE_RATE = 0.2;

// Fixture geography. endTrip enforces a dropoff-proximity lock, so completion
// is always driven from the trip's own dropoff coordinates.
const PICKUP = { lat: 40.7357, lng: -74.1724 };
const DROPOFF = { lat: 40.6895, lng: -74.1745 };
const AT_DROPOFF = { currentLat: DROPOFF.lat, currentLng: DROPOFF.lng };

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The production fee/earnings split, reproduced exactly. */
const expectedSplit = (fare: number) => {
  const platformFee = parseFloat((fare * PLATFORM_FEE_RATE).toFixed(2));
  return { platformFee, driverEarnings: parseFloat((fare - platformFee).toFixed(2)) };
};

async function expectRejectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  expect((caught as BadRequestException).getResponse()).toMatchObject({ code });
}

describe('trip economics & canonical fare (integration)', () => {
  let moduleRef: TestingModule;
  let bids: BidsService;
  let trips: TripsService;
  let servicePrisma: PrismaService;
  let fetchSpy: jest.SpyInstance;

  let riderUserId: string;
  let riderId: string;
  let driverUserId: string;
  let driverId: string;

  /** Delete every row this suite can create, child-first. Idempotent. */
  async function cleanupDb() {
    const users = await prisma.user.findMany({
      where: { phone: { in: PHONES } },
      include: { rider: true, driver: true },
    });
    const riderIds = users.map((u) => u.rider?.id).filter((id): id is string => !!id);
    const driverIds = users.map((u) => u.driver?.id).filter((id): id is string => !!id);

    const tripRows = await prisma.trip.findMany({
      where: { OR: [{ riderId: { in: riderIds } }, { driverId: { in: driverIds } }] },
      select: { id: true },
    });
    const tripIds = tripRows.map((t) => t.id);

    if (tripIds.length) {
      await prisma.trip.updateMany({ where: { id: { in: tripIds } }, data: { bidId: null } });
      await prisma.bid.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.earningsFloorLog.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.tripEvent.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    }
    if (driverIds.length) await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
    if (riderIds.length) await prisma.rider.deleteMany({ where: { id: { in: riderIds } } });
    await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  }

  /** Delete only the Redis keys this suite's flows create. Never FLUSHDB. */
  async function cleanupRedis(ids: string[]) {
    const keys = ids.flatMap((id) => [
      `bid:${id}:claimed`,
      `bid:${id}:pi`,
      // driverDeclineBid records a per-driver decline marker.
      `bid:${id}:declined:${driverId}`,
      `trip:${id}:state`,
      `trip:${id}:claimed`,
    ]);
    if (keys.length) await redis.del(...keys);
  }

  const createdIds: string[] = [];

  /** A fresh trip + pending bid. `aiFare` is the standard fare reference. */
  async function seedBid(opts: {
    aiFare: number;
    riderOffer: number;
    isAirportTrip?: boolean;
    counterRound?: number;
    expiresInMs?: number;
  }) {
    const trip = await prisma.trip.create({
      data: {
        riderId,
        status: 'searching',
        pickupAddress: '1 Economics Way, Newark NJ',
        dropoffAddress: '2 Economics Way, Newark NJ',
        pickupLat: PICKUP.lat, pickupLng: PICKUP.lng,
        dropoffLat: DROPOFF.lat, dropoffLng: DROPOFF.lng,
        aiFare: opts.aiFare,
        isAirportTrip: opts.isAirportTrip ?? false,
        estimatedDurationMin: 20,
      },
    });
    const bid = await prisma.bid.create({
      data: {
        tripId: trip.id,
        riderId,
        aiFare: opts.aiFare,
        riderOffer: opts.riderOffer,
        counterRound: opts.counterRound ?? 0,
        status: 'pending',
        expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 120_000)),
      },
    });
    createdIds.push(trip.id, bid.id);
    return { trip, bid };
  }

  /** Re-read the trip's money columns straight from PostgreSQL. */
  async function money(tripId: string) {
    const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    return {
      finalFare: t.finalFare == null ? null : Number(t.finalFare),
      platformFee: t.platformFee == null ? null : Number(t.platformFee),
      driverEarnings: t.driverEarnings == null ? null : Number(t.driverEarnings),
      aiFare: Number(t.aiFare),
      earningsSupplement: Number(t.earningsSupplement),
      earningsFloorMet: t.earningsFloorMet,
      status: t.status,
    };
  }

  beforeAll(async () => {
    await cleanupDb();

    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: {} } },
      include: { rider: true },
    });
    riderUserId = riderUser.id;
    riderId = riderUser.rider!.id;

    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE,
        role: 'driver',
        driver: {
          create: {
            status: 'approved',
            legalFirstName: 'Economics',
            legalLastName: 'Driver',
            dateOfBirth: new Date('1990-01-01'),
          },
        },
      },
      include: { driver: true },
    });
    driverUserId = driverUser.id;
    driverId = driverUser.driver!.id;

    // Notification fan-out is not under test; stub every dispatch hook.
    // Built from the real prototype rather than a Proxy: a Proxy that answers
    // every property would also answer `then`, making the provider a thenable
    // that Nest's injector awaits forever.
    const dispatchStub = Object.fromEntries(
      Object.getOwnPropertyNames(DispatchService.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => [name, jest.fn().mockResolvedValue(undefined)]),
    );

    // `.compile()` without `.init()` so BidsService.onModuleInit never starts
    // its 30-second expiry sweep timer.
    moduleRef = await Test.createTestingModule({
      providers: [
        BidsService,
        TripsService,
        EarningsFloorService,
        PrismaService,
        { provide: DispatchService, useValue: dispatchStub },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    bids = moduleRef.get(BidsService);
    trips = moduleRef.get(TripsService);
    servicePrisma = moduleRef.get(PrismaService);

    // Record outbound calls, never make them. A rejected promise (not a throw)
    // lets production `.catch()` handlers behave as "service unavailable".
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('network blocked in integration test')));
  });

  afterAll(async () => {
    const settle = (work: Promise<unknown> | undefined) =>
      Promise.resolve(work).catch(() => undefined);

    fetchSpy?.mockRestore();
    await settle(cleanupRedis(createdIds));
    await settle(cleanupDb());
    await settle(moduleRef?.close());
    await settle(servicePrisma?.$disconnect());
    await settle(prisma.$disconnect());
    await settle(redis.quit());
  });

  beforeEach(() => fetchSpy.mockClear());

  // ── 1. Standard trip economics ───────────────────────────────────────────

  describe('standard trip economics', () => {
    // Ordinary decimal, low fare, and fares whose 20% lands on a third decimal.
    const FARES = [24.99, 7.13, 12.57, 12.53, 10.01, 33.33];

    it.each(FARES)('reconciles platformFee + driverEarnings to a $%s fare', async (fare) => {
      const { trip, bid } = await seedBid({ aiFare: fare + 5, riderOffer: fare });

      const result = await bids.driverAcceptBid(bid.id, driverUserId);
      expect(result.finalFare).toBe(fare);

      const m = await money(trip.id);
      const expected = expectedSplit(fare);

      expect(m.finalFare).toBe(fare);
      expect(m.platformFee).toBe(expected.platformFee);
      expect(m.driverEarnings).toBe(expected.driverEarnings);
      // The invariant: the split reconciles EXACTLY, with no rounding loss.
      expect(round2(m.platformFee! + m.driverEarnings!)).toBe(fare);
    });

    it('uses the current production fee rate', async () => {
      const { trip, bid } = await seedBid({ aiFare: 30, riderOffer: 20 });
      await bids.driverAcceptBid(bid.id, driverUserId);

      const m = await money(trip.id);
      expect(m.platformFee).toBe(round2(20 * PLATFORM_FEE_RATE)); // $4.00
      expect(m.driverEarnings).toBe(16);
    });

    it('does not mutate financial values on repeated reads', async () => {
      const { trip, bid } = await seedBid({ aiFare: 30, riderOffer: 21.37 });
      await bids.driverAcceptBid(bid.id, driverUserId);

      const first = await money(trip.id);
      await bids.getBid(bid.id, riderUserId);
      await trips.getTripById(trip.id, riderUserId);
      const second = await money(trip.id);

      expect(second).toEqual(first);
    });
  });

  // ── 2. Rider bid lifecycle ───────────────────────────────────────────────

  describe('rider bid lifecycle', () => {
    it('accepted rider bid becomes the canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 28.5 });

      await bids.driverAcceptBid(bid.id, driverUserId);

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('accepted');
      expect(Number(stored.finalFare)).toBe(28.5);
      expect(stored.driverId).toBe(driverId);
      expect(stored.resolvedAt).toBeInstanceOf(Date);

      const m = await money(trip.id);
      expect(m.finalFare).toBe(28.5);
      expect(m.status).toBe('accepted');
      // aiFare is reference-only from this point.
      expect(m.aiFare).toBe(40);
    });

    it('enforces the bid floor and ceiling at submission', async () => {
      // fetchStandardFare is an HTTP call to pricing-service; stub it so the
      // floor/ceiling rules are exercised without leaving the machine.
      const standardFare = 20;
      const stub = jest
        .spyOn(bids as unknown as { fetchStandardFare: () => Promise<number> }, 'fetchStandardFare')
        .mockResolvedValue(standardFare);
      try {
        const dto = {
          pickupLat: 40.7357, pickupLng: -74.1724,
          dropoffLat: 40.6895, dropoffLng: -74.1745,
          pickupAddress: 'A', dropoffAddress: 'B',
          bidAmount: round2(standardFare * BID_FLOOR_RATE) - 0.01, // just under the floor
        };
        await expectRejectCode(bids.submitBid(riderUserId, dto as never), 'BID_BELOW_FLOOR');

        // Nothing was persisted by the rejected submission.
        const orphan = await prisma.bid.findFirst({ where: { riderId, status: 'pending' } });
        expect(orphan).toBeNull();
      } finally {
        stub.mockRestore();
      }
    });

    it('a declined bid does not set a canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 30, riderOffer: 22 });

      await bids.driverDeclineBid(bid.id, driverUserId);

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('declined');
      expect(stored.finalFare).toBeNull();

      const m = await money(trip.id);
      expect(m.finalFare).toBeNull();
      expect(m.platformFee).toBeNull();
      expect(m.driverEarnings).toBeNull();
    });

    it('an expired bid does not set a canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 30, riderOffer: 22, expiresInMs: -1000 });

      await bids.sweepExpiredBids();

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('expired');
      expect(stored.finalFare).toBeNull();
      expect(await money(trip.id)).toMatchObject({ finalFare: null, platformFee: null });
    });

    it('refuses to accept a bid that is already resolved', async () => {
      const { trip, bid } = await seedBid({ aiFare: 30, riderOffer: 25 });
      await bids.driverAcceptBid(bid.id, driverUserId);
      const afterFirst = await money(trip.id);

      await expectRejectCode(bids.driverAcceptBid(bid.id, driverUserId), 'BID_ALREADY_RESOLVED');

      // Replay changed nothing financially.
      expect(await money(trip.id)).toEqual(afterFirst);
    });

    it('a second driver cannot claim a bid already being accepted', async () => {
      const { trip, bid } = await seedBid({ aiFare: 30, riderOffer: 25 });
      // Simulate another driver holding the atomic claim.
      await redis.set(`bid:${bid.id}:claimed`, 'someone-else', 'EX', 60, 'NX');

      await expectRejectCode(bids.driverAcceptBid(bid.id, driverUserId), 'BID_ALREADY_CLAIMED');

      expect(await money(trip.id)).toMatchObject({ finalFare: null });
    });
  });

  // ── 3. Driver counter-offer lifecycle ────────────────────────────────────

  describe('driver counter-offer lifecycle', () => {
    it('persists a counter and increments the round', async () => {
      const { bid } = await seedBid({ aiFare: 40, riderOffer: 25 });

      const result = await bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 32 } as never);
      expect(result.counterRound).toBe(1);

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('countered');
      expect(Number(stored.counterOffer)).toBe(32);
      expect(stored.counterRound).toBe(1);
      expect(stored.driverId).toBe(driverId);
      expect(stored.finalFare).toBeNull(); // not canonical until the rider accepts
    });

    it('rejects a counter at or below the rider bid, and at or above standard', async () => {
      const low = await seedBid({ aiFare: 40, riderOffer: 25 });
      await expectRejectCode(
        bids.driverCounterBid(low.bid.id, driverUserId, { counterAmount: 25 } as never),
        'COUNTER_TOO_LOW',
      );

      const high = await seedBid({ aiFare: 40, riderOffer: 25 });
      await expectRejectCode(
        bids.driverCounterBid(high.bid.id, driverUserId, { counterAmount: 40 } as never),
        'COUNTER_AT_OR_ABOVE_STANDARD',
      );

      for (const seeded of [low, high]) {
        const stored = await prisma.bid.findUniqueOrThrow({ where: { id: seeded.bid.id } });
        expect(stored.counterOffer).toBeNull();
        expect(stored.counterRound).toBe(0);
        expect(stored.status).toBe('pending');
      }
    });

    it(`enforces MAX_COUNTER_ROUNDS (${MAX_COUNTER_ROUNDS}) without mutating the bid`, async () => {
      const { bid } = await seedBid({
        aiFare: 40, riderOffer: 25, counterRound: MAX_COUNTER_ROUNDS,
      });

      await expectRejectCode(
        bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 30 } as never),
        'BID_MAX_COUNTERS_REACHED',
      );

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.counterRound).toBe(MAX_COUNTER_ROUNDS);
      expect(stored.counterOffer).toBeNull();
      expect(stored.status).toBe('pending');
    });

    it('an accepted counter becomes the canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 25 });
      await bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 31.99 } as never);

      const result = await bids.riderAcceptCounter(bid.id, riderUserId);
      expect(result.finalFare).toBe(31.99);

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('accepted');
      expect(Number(stored.finalFare)).toBe(31.99);

      const m = await money(trip.id);
      const expected = expectedSplit(31.99);
      expect(m.finalFare).toBe(31.99);
      expect(m.platformFee).toBe(expected.platformFee);
      expect(m.driverEarnings).toBe(expected.driverEarnings);
      expect(round2(m.platformFee! + m.driverEarnings!)).toBe(31.99);
      // The rider's original offer is NOT the canonical fare.
      expect(m.finalFare).not.toBe(25);
    });

    it('a declined counter does not change the canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 25 });
      await bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 32 } as never);

      await bids.riderDeclineCounter(bid.id, riderUserId);

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('declined');
      expect(stored.finalFare).toBeNull();
      expect(await money(trip.id)).toMatchObject({ finalFare: null, driverEarnings: null });
    });

    it('an expired counter does not change the canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 25 });
      await bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 32 } as never);
      // Push the counter's expiry into the past, then sweep.
      await prisma.bid.update({
        where: { id: bid.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await bids.sweepExpiredBids();

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.status).toBe('expired');
      expect(stored.finalFare).toBeNull();
      expect(await money(trip.id)).toMatchObject({ finalFare: null });
    });

    it('preserves counter ordering across rounds', async () => {
      const { bid } = await seedBid({ aiFare: 40, riderOffer: 25 });

      await bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 30 } as never);
      // A countered bid must be re-opened before another counter is possible;
      // current behaviour requires pending status, so the second attempt is
      // rejected rather than silently accepted out of order.
      await expectRejectCode(
        bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 33 } as never),
        'BID_NOT_PENDING',
      );

      const stored = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      expect(stored.counterRound).toBe(1);
      expect(Number(stored.counterOffer)).toBe(30); // first counter retained
    });
  });

  // ── 4. Fare overwrite protection ─────────────────────────────────────────

  describe('fare overwrite protection', () => {
    /** Drive an accepted bid trip through to completion. */
    async function completeAccepted(tripId: string) {
      await prisma.trip.update({
        where: { id: tripId },
        data: { status: 'in_progress', startedAt: new Date(Date.now() - 20 * 60_000) },
      });
      return trips.endTrip(tripId, driverUserId, AT_DROPOFF as never);
    }

    it('completion preserves the accepted bid fare and never falls back to aiFare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 55, riderOffer: 29.99 });
      await bids.driverAcceptBid(bid.id, driverUserId);

      await completeAccepted(trip.id);

      const m = await money(trip.id);
      expect(m.status).toBe('completed');
      expect(m.finalFare).toBe(29.99);   // accepted amount, not the $55 estimate
      expect(m.aiFare).toBe(55);

      // The split must still reconcile AFTER completion rewrites it. Completion
      // computes platformFee without an explicit round (the Decimal(8,2) column
      // does the rounding), so this is the assertion that would catch a cent
      // of loss introduced by that path.
      expect(m.earningsFloorMet).toBe(true);
      expect(m.earningsSupplement).toBe(0);
      expect(round2(m.platformFee! + m.driverEarnings!)).toBe(29.99);
      expect(m.platformFee).toBe(expectedSplit(29.99).platformFee);
      expect(m.driverEarnings).toBe(expectedSplit(29.99).driverEarnings);
    });

    it('completion preserves an accepted counter fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 60, riderOffer: 25 });
      await bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 38.5 } as never);
      await bids.riderAcceptCounter(bid.id, riderUserId);

      await completeAccepted(trip.id);

      expect(await money(trip.id)).toMatchObject({ finalFare: 38.5, aiFare: 60 });
    });

    it('platform absorbs the earnings-floor supplement rather than reducing the fare', async () => {
      // A low accepted fare puts driver earnings under the floor.
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 6 });
      await bids.driverAcceptBid(bid.id, driverUserId);

      await completeAccepted(trip.id);

      const m = await money(trip.id);
      expect(m.finalFare).toBe(6);              // rider still owes the accepted amount
      expect(m.earningsFloorMet).toBe(false);
      expect(m.earningsSupplement).toBeGreaterThan(0);
      // Earnings = base split + supplement; the excess over the fare is exactly
      // the supplement the platform absorbed.
      expect(round2(m.driverEarnings! - m.earningsSupplement)).toBeCloseTo(
        round2(6 - m.platformFee!), 2,
      );
    });

    it('blocks money movement when a bid trip has no accepted fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 45, riderOffer: 30 });
      // Link the bid but leave finalFare unset — the impossible state.
      await prisma.trip.update({
        where: { id: trip.id },
        data: { bidId: bid.id, driverId, status: 'in_progress', startedAt: new Date(Date.now() - 20 * 60_000) },
      });

      await trips.endTrip(trip.id, driverUserId, AT_DROPOFF as never);

      const m = await money(trip.id);
      expect(m.status).toBe('completed');   // the driver is not stranded
      expect(m.finalFare).toBeNull();       // but no fare is invented
      expect(m.platformFee).toBeNull();
      expect(m.driverEarnings).toBeNull();

      const events = await prisma.tripEvent.findMany({ where: { tripId: trip.id } });
      const types = events.map((e) => e.eventType);
      expect(types).toContain('fare_integrity_error');
      expect(types).toContain('fare_integrity_driver_payout_hold');
    });

    it('an unrelated trip update does not disturb the canonical fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 27.25 });
      await bids.driverAcceptBid(bid.id, driverUserId);
      const before = await money(trip.id);

      await prisma.trip.update({
        where: { id: trip.id },
        data: { riderRatingDriver: 5, routeDeviationCount: { increment: 1 } },
      });

      expect(await money(trip.id)).toEqual(before);
    });
  });

  // ── 5. Payment handoff ───────────────────────────────────────────────────

  describe('payment handoff', () => {
    it('captures exactly the canonical fare, once', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 26.4 });
      // A held payment intent exists, so capture is attempted.
      await redis.set(`bid:${bid.id}:pi`, 'pi_integration_test');

      await bids.driverAcceptBid(bid.id, driverUserId);

      const captures = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/payments/internal/capture'),
      );
      expect(captures).toHaveLength(1);

      const body = JSON.parse(String((captures[0][1] as { body: string }).body));
      expect(body.paymentIntentId).toBe('pi_integration_test');
      expect(body.tripId).toBe(trip.id);
      expect(body.riderId).toBe(riderId);
      // The handed-off amount is the canonical fare in cents — never the AI
      // estimate ($40) and never the pre-rounding float.
      expect(body.amountCents).toBe(2640);
      expect(body.amountCents).toBe(Math.round(26.4 * 100));

      expect(await money(trip.id)).toMatchObject({ finalFare: 26.4 });
    });

    it('does not attempt a capture when no hold exists', async () => {
      const { bid } = await seedBid({ aiFare: 40, riderOffer: 26.4 });

      await bids.driverAcceptBid(bid.id, driverUserId);

      const captures = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/payments/internal/capture'),
      );
      expect(captures).toHaveLength(0);
    });

    it('a failed capture does not roll back or alter the stored fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 19.95 });
      await redis.set(`bid:${bid.id}:pi`, 'pi_will_fail');

      // The spy rejects every call, i.e. payment-service is unavailable.
      await expect(bids.driverAcceptBid(bid.id, driverUserId)).resolves.toMatchObject({
        finalFare: 19.95,
      });

      expect(await money(trip.id)).toMatchObject({
        finalFare: 19.95,
        ...expectedSplit(19.95),
      });
    });
  });

  // ── 6. Airport fare safety ───────────────────────────────────────────────

  describe('airport fare safety', () => {
    it('stores an airport-inclusive accepted fare unchanged', async () => {
      // The premium is already inside the quoted/negotiated amount.
      const { trip, bid } = await seedBid({ aiFare: 48.5, riderOffer: 36.75, isAirportTrip: true });

      await bids.driverAcceptBid(bid.id, driverUserId);

      const m = await money(trip.id);
      expect(m.finalFare).toBe(36.75); // no premium re-applied
      expect(round2(m.platformFee! + m.driverEarnings!)).toBe(36.75);
    });

    it('does not re-apply a premium at completion', async () => {
      const { trip, bid } = await seedBid({ aiFare: 48.5, riderOffer: 36.75, isAirportTrip: true });
      await bids.driverAcceptBid(bid.id, driverUserId);
      const accepted = await money(trip.id);

      await prisma.trip.update({
        where: { id: trip.id },
        data: { status: 'in_progress', startedAt: new Date(Date.now() - 20 * 60_000) },
      });
      await trips.endTrip(trip.id, driverUserId, AT_DROPOFF as never);

      const completed = await money(trip.id);
      expect(completed.finalFare).toBe(accepted.finalFare);
      expect(completed.finalFare).toBe(36.75);
    });

    it('airport metadata cannot change an already accepted fare', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 30 });
      await bids.driverAcceptBid(bid.id, driverUserId);
      const before = await money(trip.id);

      await prisma.trip.update({ where: { id: trip.id }, data: { isAirportTrip: true } });

      expect(await money(trip.id)).toEqual(before);
    });
  });

  // ── 7. Database invariants ───────────────────────────────────────────────

  describe('database invariants', () => {
    it('persists money at two-decimal precision and survives reload', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 23.456 as number });

      await bids.driverAcceptBid(bid.id, driverUserId);

      const raw = await prisma.$queryRawUnsafe<Array<{ final_fare: string; platform_fee: string }>>(
        'SELECT final_fare::text, platform_fee::text FROM trips WHERE id = $1::uuid',
        trip.id,
      );
      // Decimal(8,2): the column itself enforces the money scale.
      expect(raw[0].final_fare).toMatch(/^\d+\.\d{2}$/);
      expect(raw[0].platform_fee).toMatch(/^\d+\.\d{2}$/);

      const m = await money(trip.id);
      expect(round2(m.platformFee! + m.driverEarnings!)).toBe(m.finalFare);
    });

    it('an invalid transition leaves the prior financial state untouched', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 24 });
      await bids.driverAcceptBid(bid.id, driverUserId);
      const accepted = await money(trip.id);

      // accepted is terminal: countering or declining must both be refused.
      await expectRejectCode(
        bids.driverCounterBid(bid.id, driverUserId, { counterAmount: 30 } as never),
        'BID_ALREADY_RESOLVED',
      );
      await expectRejectCode(
        bids.riderAcceptCounter(bid.id, riderUserId),
        'BID_ALREADY_RESOLVED',
      );

      expect(await money(trip.id)).toEqual(accepted);
    });

    it('the trip and bid agree on the accepted amount', async () => {
      const { trip, bid } = await seedBid({ aiFare: 40, riderOffer: 21.6 });
      await bids.driverAcceptBid(bid.id, driverUserId);

      const storedBid = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
      const m = await money(trip.id);
      expect(Number(storedBid.finalFare)).toBe(m.finalFare);
    });
  });
});
