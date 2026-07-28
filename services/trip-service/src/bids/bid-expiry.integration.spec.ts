/**
 * F2 — bid expiry race protection, against real PostgreSQL + Redis.
 *
 * The sweep previously updated each selected bid unconditionally, so a bid that
 * transitioned between selection and write was silently flipped to expired and
 * its payment hold voided — possibly after capture. It also ran on every replica
 * with no coordination.
 *
 * These tests drive real interleavings rather than seeding a final state: the
 * competing transition is issued through the real service method while a sweep
 * is in flight, and concurrent sweepers are launched with Promise.all.
 *
 * The injected PrismaService reads DATABASE_URL, so pin it to the test database.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, BidStatus, TripStatus } from '@bidride/database';
import { Redis } from 'ioredis';
import { BidsService } from './bids.service';
import { DispatchService } from '../trips/dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);

// trip-service owns fixture block 0; 0001/0002 and 0003/0004 are taken.
const RIDER_PHONE = '+19995550005';
const DRIVER_PHONE = '+19995550006';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];
const SWEEP_LOCK_KEY = 'bid:sweep:lock';

describe('bid expiry race protection (integration)', () => {
  let moduleRef: TestingModule;
  let bids: BidsService;
  let servicePrisma: PrismaService;
  let fetchSpy: jest.SpyInstance;
  let dispatchStub: Record<string, jest.Mock>;

  let riderId: string;
  let driverId: string;
  let driverUserId: string;
  const createdTripIds: string[] = [];

  async function cleanupDb() {
    const users = await prisma.user.findMany({
      where: { phone: { in: PHONES } },
      include: { rider: true, driver: true },
    });
    const riderIds = users.map((u) => u.rider?.id).filter((id): id is string => !!id);
    const driverIds = users.map((u) => u.driver?.id).filter((id): id is string => !!id);
    const trips = await prisma.trip.findMany({
      where: { OR: [{ riderId: { in: riderIds } }, { driverId: { in: driverIds } }] },
      select: { id: true },
    });
    const tripIds = trips.map((t) => t.id);
    if (tripIds.length) {
      await prisma.trip.updateMany({ where: { id: { in: tripIds } }, data: { bidId: null } });
      await prisma.bid.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.tripEvent.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.earningsFloorLog.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    }
    if (driverIds.length) await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
    if (riderIds.length) await prisma.rider.deleteMany({ where: { id: { in: riderIds } } });
    await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  }

  /** A trip + bid already past its expiry, in the given state. */
  async function seedExpiredBid(status: BidStatus, opts: { withDriver?: boolean } = {}) {
    const trip = await prisma.trip.create({
      data: {
        riderId, status: TripStatus.searching,
        pickupAddress: 'A', dropoffAddress: 'B',
        pickupLat: 40.7357, pickupLng: -74.1724,
        dropoffLat: 40.6895, dropoffLng: -74.1745,
        aiFare: 30,
      },
    });
    const bid = await prisma.bid.create({
      data: {
        tripId: trip.id, riderId, aiFare: 30, riderOffer: 22,
        ...(opts.withDriver ? { driverId, counterOffer: 26, counterRound: 1 } : {}),
        status,
        expiresAt: new Date(Date.now() - 5_000),
      },
    });
    createdTripIds.push(trip.id);
    return { trip, bid };
  }

  const clearLock = () => redis.del(SWEEP_LOCK_KEY);

  beforeAll(async () => {
    await cleanupDb();
    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: {} } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;

    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE, role: 'driver',
        driver: {
          create: {
            status: 'approved', legalFirstName: 'Expiry', legalLastName: 'Driver',
            dateOfBirth: new Date('1990-01-01'),
          },
        },
      },
      include: { driver: true },
    });
    driverUserId = driverUser.id;
    driverId = driverUser.driver!.id;

    dispatchStub = Object.fromEntries(
      Object.getOwnPropertyNames(DispatchService.prototype)
        .filter((n) => n !== 'constructor')
        .map((n) => [n, jest.fn().mockResolvedValue(undefined)]),
    ) as Record<string, jest.Mock>;

    moduleRef = await Test.createTestingModule({
      providers: [
        BidsService, PrismaService,
        { provide: DispatchService, useValue: dispatchStub },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile(); // no .init() — the 30s sweep timer never starts

    bids = moduleRef.get(BidsService);
    servicePrisma = moduleRef.get(PrismaService);

    // Payment-service and ai-service are out of scope: record calls, never leave.
    fetchSpy = jest.spyOn(global, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('network blocked in integration test')));
  });

  afterAll(async () => {
    const settle = (w: Promise<unknown> | undefined) => Promise.resolve(w).catch(() => undefined);
    fetchSpy?.mockRestore();
    await settle(clearLock());
    await settle(cleanupDb());
    await settle(moduleRef?.close());
    await settle(servicePrisma?.$disconnect());
    await settle(prisma.$disconnect());
    await settle(redis.quit());
  });

  beforeEach(async () => {
    for (const m of Object.values(dispatchStub)) m.mockClear();
    fetchSpy.mockClear();
    await clearLock();
  });

  const voidCalls = () =>
    fetchSpy.mock.calls.filter(([url]) => String(url).includes('/payments/internal/void'));

  // ── Happy expiry ─────────────────────────────────────────────────────────

  it('expires a pending bid and cancels its trip', async () => {
    const { trip, bid } = await seedExpiredBid(BidStatus.pending);

    await bids.sweepExpiredBids();

    expect((await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } })).status).toBe('expired');
    const t = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(t.status).toBe('cancelled');
    expect(t.cancelReason).toBe('bid_expired');
    expect(t.cancelledAt).toBeInstanceOf(Date);
    expect(dispatchStub.notifyBidExpired).toHaveBeenCalledTimes(1);
  });

  it('expires a countered bid and notifies counter-expired', async () => {
    const { trip, bid } = await seedExpiredBid(BidStatus.countered, { withDriver: true });

    await bids.sweepExpiredBids();

    expect((await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } })).status).toBe('expired');
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe('cancelled');
    // F1 must hold: addressed by User.id.
    expect(dispatchStub.notifyCounterExpired).toHaveBeenCalledWith(trip.id, bid.id, driverUserId);
    expect(dispatchStub.notifyBidExpired).not.toHaveBeenCalled();
  });

  it('never leaves an expired bid’s trip searching', async () => {
    const { trip } = await seedExpiredBid(BidStatus.pending);

    await bids.sweepExpiredBids();

    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).not.toBe('searching');
  });

  // ── Terminal states are untouchable ──────────────────────────────────────

  it.each([
    ['accepted', BidStatus.accepted],
    ['withdrawn', BidStatus.withdrawn],
    ['declined', BidStatus.declined],
  ])('a %s bid is never expired by the sweep', async (_label, status) => {
    const { trip, bid } = await seedExpiredBid(status);

    await bids.sweepExpiredBids();

    expect((await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } })).status).toBe(status);
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe('searching');
    expect(dispatchStub.notifyBidExpired).not.toHaveBeenCalled();
    expect(voidCalls()).toHaveLength(0);
  });

  // ── Genuine races: the transition lands mid-sweep ────────────────────────

  /** Flip the bid to `status` while the sweep is between select and write. */
  async function raceAgainstSweep(bidId: string, status: BidStatus) {
    const original = servicePrisma.bid.findMany.bind(servicePrisma.bid);
    // Prisma returns a PrismaPromise, so the mock is cast rather than typed.
    const spy = jest.spyOn(servicePrisma.bid, 'findMany').mockImplementation((async (args: unknown) => {
      const rows = await original(args as never);
      // The competing transition commits AFTER selection, BEFORE the write —
      // exactly the window the old unconditional update lost.
      await prisma.bid.update({ where: { id: bidId }, data: { status, resolvedAt: new Date() } });
      return rows;
    }) as never);
    try {
      await bids.sweepExpiredBids();
    } finally {
      spy.mockRestore();
    }
  }

  it.each([
    ['accept', BidStatus.accepted],
    ['withdraw', BidStatus.withdrawn],
    ['decline', BidStatus.declined],
  ])('%s landing mid-sweep wins; the sweep does not overwrite it', async (_label, status) => {
    const { trip, bid } = await seedExpiredBid(BidStatus.pending);

    await raceAgainstSweep(bid.id, status);

    const after = await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } });
    expect(after.status).toBe(status); // NOT expired
    // No side effects fired for a transition the sweep did not win.
    expect(dispatchStub.notifyBidExpired).not.toHaveBeenCalled();
    expect(dispatchStub.notifyCounterExpired).not.toHaveBeenCalled();
    expect(voidCalls()).toHaveLength(0);
    // The trip is left to the winning workflow.
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).cancelReason).not.toBe('bid_expired');
    // And no expiry event was recorded.
    expect(await prisma.tripEvent.count({ where: { tripId: trip.id, eventType: 'bid_expired' } })).toBe(0);
  });

  // ── Concurrent sweepers ─────────────────────────────────────────────────

  it('two concurrent sweepers: exactly one expiry, one void attempt, one notification', async () => {
    const { trip, bid } = await seedExpiredBid(BidStatus.pending);
    // Give the hold a recovery handle so a void would actually be attempted.
    await redis.set(`bid:${bid.id}:pi`, 'pi_expiry_race_test');

    await Promise.all([bids.sweepExpiredBids(), bids.sweepExpiredBids()]);

    expect((await prisma.bid.findUniqueOrThrow({ where: { id: bid.id } })).status).toBe('expired');
    expect(dispatchStub.notifyBidExpired).toHaveBeenCalledTimes(1);
    expect(voidCalls()).toHaveLength(1);
    expect(await prisma.tripEvent.count({ where: { tripId: trip.id, eventType: 'bid_expired' } })).toBe(1);

    await redis.del(`bid:${bid.id}:pi`);
  });

  it('a second sweeper does no work while the lease is held', async () => {
    await seedExpiredBid(BidStatus.pending);
    await redis.set(SWEEP_LOCK_KEY, 'someone-else', 'EX', 25);

    await bids.sweepExpiredBids();

    expect(dispatchStub.notifyBidExpired).not.toHaveBeenCalled();
    // The foreign lease is intact — never released by a non-owner.
    expect(await redis.get(SWEEP_LOCK_KEY)).toBe('someone-else');
  });

  // ── Lease lifecycle ─────────────────────────────────────────────────────

  it('holds a bounded lease during the sweep and releases it afterwards', async () => {
    let ttlDuringSweep = -99;
    const original = servicePrisma.bid.findMany.bind(servicePrisma.bid);
    const spy = jest.spyOn(servicePrisma.bid, 'findMany').mockImplementation((async (args: unknown) => {
      ttlDuringSweep = await redis.ttl(SWEEP_LOCK_KEY);
      return original(args as never);
    }) as never);

    await bids.sweepExpiredBids();
    spy.mockRestore();

    expect(ttlDuringSweep).toBeGreaterThan(0);
    expect(ttlDuringSweep).toBeLessThanOrEqual(25); // bounded, crash-recoverable
    expect(await redis.exists(SWEEP_LOCK_KEY)).toBe(0); // released
  });

  it('leaves no lease behind when the sweep throws', async () => {
    const spy = jest.spyOn(servicePrisma.bid, 'findMany')
      .mockImplementation((() => Promise.reject(new Error('db down'))) as never);

    await expect(bids.sweepExpiredBids()).rejects.toThrow('db down');
    spy.mockRestore();

    expect(await redis.exists(SWEEP_LOCK_KEY)).toBe(0);
  });
});
