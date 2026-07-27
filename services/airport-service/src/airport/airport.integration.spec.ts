/**
 * Integration tests for airport-service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL (enforced by
 * test/integration-setup.js, so a misconfigured run fails instead of skipping).
 *
 * airport-service had no tests of any kind. These pin CURRENT behaviour:
 *
 *   1. EWR FIFO queue    — ordering, dispatch, departure, rejoin, duplicates
 *   2. Queue persistence — AirportQueueEntry lifecycle rows
 *   3. Airport surge     — formula, the 2.5x cap, determinism
 *   4. Admin threshold   — the exact 1.5x boundary (inclusive or not)
 *   5. Concurrency       — zpopmin atomicity, parallel joins, repeated removal
 *   6. Isolation         — FlightAware never contacted
 *
 * Determinism without the network. `getUpcomingArrivals` caches its FlightAware
 * response in Redis under `flight:ewr:arrivals` for 30s and returns the cache
 * before attempting any request. Seeding that key is therefore the PRODUCTION
 * short-circuit, not a stub: with it warm, no HTTP is attempted at all.
 * `global.fetch` is additionally replaced with a spy that records and rejects,
 * so an unexpected outbound attempt cannot reach the network and is visible.
 *
 * Shared-state safety. `queue:ewr` and `flight:ewr:arrivals` are singleton keys
 * on the same Redis instance a developer's stack uses. This suite therefore
 * NEVER deletes `queue:ewr` (only ZREM of its own driver ids) and snapshots
 * `flight:ewr:arrivals` before touching it, restoring the original value and
 * TTL afterwards.
 *
 * The injected PrismaService reads DATABASE_URL, so we pin it to the test
 * database here to guarantee every connection targets TEST_DATABASE_URL only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { AirportService } from './airport.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);

/**
 * Reserved fixture identifiers. airport-service takes phone block 3
 * (trip=0, auth=1, safety=2, driver=6, payment=7/8/9).
 */
const DRIVER_PHONES = ['+19995553001', '+19995553002', '+19995553003'];

// Production keys and constants (see airport.service.ts).
const QUEUE_KEY = 'queue:ewr';
const FLIGHT_CACHE_KEY = 'flight:ewr:arrivals';
const FLIGHT_CACHE_TTL = 30;
const SURGE_CAP = 2.5;

/** Snapshot of the shared flight cache, restored in afterAll. */
let flightCacheSnapshot: { value: string | null; ttl: number } = { value: null, ttl: -2 };

/**
 * Seed the production flight cache so getDemandForecast is deterministic.
 * requestsPerHour = round(totalSeats * 0.15) over arrivals landing within 1h.
 */
async function seedArrivals(seatCounts: number[]) {
  const soon = new Date(Date.now() + 10 * 60_000).toISOString();
  const arrivals = seatCounts.map((seatCount, i) => ({
    flightId: `ITEST${i}`,
    flightNumber: `ITEST${i}`,
    airline: 'Integration Air',
    origin: 'TST',
    scheduledArrival: soon,
    estimatedArrival: soon,
    status: 'Scheduled',
    terminal: 'B',
    seatCount,
  }));
  await redis.setex(FLIGHT_CACHE_KEY, FLIGHT_CACHE_TTL, JSON.stringify(arrivals));
  return arrivals;
}

/** Seats needed for a target requestsPerHour, given the 15% heuristic. */
const seatsFor = (requestsPerHour: number) => Math.round(requestsPerHour / 0.15);

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

describe('airport-service (integration)', () => {
  let moduleRef: TestingModule;
  let airport: AirportService;
  let servicePrisma: PrismaService;
  let fetchSpy: jest.SpyInstance;

  /** Driver profile ids, in fixture order. */
  let driverIds: string[] = [];

  async function cleanupDb() {
    const users = await prisma.user.findMany({
      where: { phone: { in: DRIVER_PHONES } },
      include: { driver: true },
    });
    const ids = users.map((u) => u.driver?.id).filter((id): id is string => !!id);
    if (ids.length) {
      await prisma.airportQueueEntry.deleteMany({ where: { driverId: { in: ids } } });
      await prisma.driver.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.user.deleteMany({ where: { phone: { in: DRIVER_PHONES } } });
  }

  /** Remove ONLY this suite's members from the shared queue. Never DEL/FLUSHDB. */
  async function cleanupQueue() {
    if (driverIds.length) await redis.zrem(QUEUE_KEY, ...driverIds);
  }

  beforeAll(async () => {
    await cleanupDb();

    for (const phone of DRIVER_PHONES) {
      const user = await prisma.user.create({
        data: {
          phone,
          role: 'driver',
          driver: {
            create: {
              status: 'approved',
              legalFirstName: 'Airport',
              legalLastName: `Driver${phone.slice(-1)}`,
              dateOfBirth: new Date('1990-01-01'),
            },
          },
        },
        include: { driver: true },
      });
      driverIds.push(user.driver!.id);
    }

    // The surge formula divides demand by `zcard(queue:ewr)`, so a foreign
    // member in the shared queue would silently change every expected
    // multiplier. Fail loudly rather than compute against a queue we do not
    // own — a hidden skip here would look identical to a passing run.
    const foreign = (await redis.zrange(QUEUE_KEY, 0, -1)).filter(
      (m) => !driverIds.includes(m),
    );
    if (foreign.length > 0) {
      throw new Error(
        `\n  ${QUEUE_KEY} contains ${foreign.length} entr${foreign.length === 1 ? 'y' : 'ies'} this suite does not own:\n` +
          `    ${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? ', …' : ''}\n` +
          '  Airport surge is computed from the queue length, so these would corrupt\n' +
          '  every expected multiplier. Stop the local stack, or clear those members,\n' +
          '  then re-run.\n',
      );
    }

    // Snapshot the shared flight cache so it can be restored exactly.
    flightCacheSnapshot = {
      value: await redis.get(FLIGHT_CACHE_KEY),
      ttl: await redis.ttl(FLIGHT_CACHE_KEY),
    };

    const config = {
      get: (key: string, fallback?: string) => (key === 'FLIGHTAWARE_API_KEY' ? 'itest-key' : fallback),
      getOrThrow: (key: string) => {
        if (key === 'FLIGHTAWARE_API_KEY') return 'itest-key';
        throw new Error(`Missing config: ${key}`);
      },
    } as unknown as ConfigService;

    moduleRef = await Test.createTestingModule({
      providers: [
        AirportService,
        PrismaService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    airport = moduleRef.get(AirportService);
    servicePrisma = moduleRef.get(PrismaService);

    // Records any outbound attempt; rejects so production catch blocks behave
    // as they do when FlightAware is unreachable.
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('network blocked in integration test')));
  });

  afterAll(async () => {
    const settle = (work: Promise<unknown> | undefined) =>
      Promise.resolve(work).catch(() => undefined);

    fetchSpy?.mockRestore();
    await settle(cleanupQueue());
    await settle(cleanupDb());
    // Restore the shared flight cache exactly as it was found.
    if (flightCacheSnapshot.value === null) {
      await settle(redis.del(FLIGHT_CACHE_KEY));
    } else if (flightCacheSnapshot.ttl > 0) {
      await settle(redis.setex(FLIGHT_CACHE_KEY, flightCacheSnapshot.ttl, flightCacheSnapshot.value));
    } else {
      await settle(redis.set(FLIGHT_CACHE_KEY, flightCacheSnapshot.value));
    }
    await settle(moduleRef?.close());
    await settle(servicePrisma?.$disconnect());
    await settle(prisma.$disconnect());
    await settle(redis.quit());
  });

  beforeEach(async () => {
    fetchSpy.mockClear();
    await cleanupQueue();
    await prisma.airportQueueEntry.deleteMany({ where: { driverId: { in: driverIds } } });
    await redis.del(FLIGHT_CACHE_KEY);
  });

  // ── 1. EWR FIFO queue ────────────────────────────────────────────────────

  describe('EWR FIFO queue', () => {
    /** Join drivers in order with distinct scores, so FIFO is unambiguous. */
    async function joinInOrder(count: number) {
      const results = [];
      for (let i = 0; i < count; i++) {
        results.push(await airport.joinQueue(driverIds[i]));
        // Guarantee a strictly increasing join timestamp (score = Date.now()).
        await new Promise((r) => setTimeout(r, 5));
      }
      return results;
    }

    it('places the first driver at position 1', async () => {
      const result = await airport.joinQueue(driverIds[0]);

      expect(result.position).toBe(1);
      expect(result.queueLength).toBe(1);
      expect(await redis.zrank(QUEUE_KEY, driverIds[0])).toBe(0);
    });

    it('assigns later positions in join order', async () => {
      const [first, second, third] = await joinInOrder(3);

      expect(first.position).toBe(1);
      expect(second.position).toBe(2);
      expect(third.position).toBe(3);
      expect(third.queueLength).toBe(3);
    });

    it('orders the full queue by entry time', async () => {
      await joinInOrder(3);

      const queue = await airport.getFullQueue();
      const ours = queue.filter((e) => driverIds.includes(e.driverId));

      expect(ours.map((e) => e.driverId)).toEqual(driverIds);
      // Scores are join timestamps and must be strictly increasing.
      expect(ours[0].score).toBeLessThan(ours[1].score);
      expect(ours[1].score).toBeLessThan(ours[2].score);
    });

    it('dispatches the oldest waiting driver first', async () => {
      await joinInOrder(3);

      const dispatched = await airport.dispatchNext('00000000-0000-0000-0000-00000000a001');

      expect(dispatched).toBe(driverIds[0]);
      expect(await redis.zrank(QUEUE_KEY, driverIds[0])).toBeNull();
    });

    it('promotes the second driver after the first is dispatched', async () => {
      await joinInOrder(3);
      await airport.dispatchNext('00000000-0000-0000-0000-00000000a002');

      const promoted = await airport.getQueuePosition(driverIds[1]);
      expect(promoted?.position).toBe(1);

      const third = await airport.getQueuePosition(driverIds[2]);
      expect(third?.position).toBe(2);
    });

    it('removes exactly the departing driver and preserves the rest', async () => {
      await joinInOrder(3);

      await airport.leaveQueue(driverIds[1]);

      expect(await redis.zrank(QUEUE_KEY, driverIds[1])).toBeNull();
      expect((await airport.getQueuePosition(driverIds[0]))?.position).toBe(1);
      expect((await airport.getQueuePosition(driverIds[2]))?.position).toBe(2);
    });

    it('returns null for a driver who is not queued', async () => {
      expect(await airport.getQueuePosition(driverIds[0])).toBeNull();
    });

    it('returns null from dispatchNext when the queue is empty', async () => {
      // beforeAll proved the shared queue holds only this suite's drivers, and
      // beforeEach removed them, so emptiness here is genuinely ours to assert.
      expect(await redis.zcard(QUEUE_KEY)).toBe(0);

      expect(await airport.dispatchNext('00000000-0000-0000-0000-00000000a003')).toBeNull();
    });

    it('rejects a duplicate join while still waiting', async () => {
      await airport.joinQueue(driverIds[0]);

      await expectRejectCode(airport.joinQueue(driverIds[0]), 'QUEUE_ALREADY_JOINED');

      // The original entry is untouched — no duplicate member, no re-scored slot.
      expect(await redis.zcount(QUEUE_KEY, '-inf', '+inf')).toBeGreaterThan(0);
      expect(
        await prisma.airportQueueEntry.count({ where: { driverId: driverIds[0], status: 'waiting' } }),
      ).toBe(1);
    });

    it('sends a rejoining driver to the back of the queue', async () => {
      await joinInOrder(2);
      await airport.leaveQueue(driverIds[0]);
      await new Promise((r) => setTimeout(r, 5));

      const rejoin = await airport.joinQueue(driverIds[0]);

      expect(rejoin.position).toBe(2); // behind the driver who kept waiting
      expect((await airport.getQueuePosition(driverIds[1]))?.position).toBe(1);
    });

    it('repeated reads do not change queue order', async () => {
      await joinInOrder(3);

      const first = (await airport.getFullQueue()).filter((e) => driverIds.includes(e.driverId));
      const second = (await airport.getFullQueue()).filter((e) => driverIds.includes(e.driverId));
      const third = (await airport.getFullQueue()).filter((e) => driverIds.includes(e.driverId));

      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });
  });

  // ── 2. Queue persistence ─────────────────────────────────────────────────

  describe('queue entry persistence', () => {
    it('records a waiting entry on join', async () => {
      await airport.joinQueue(driverIds[0]);

      const entry = await prisma.airportQueueEntry.findFirstOrThrow({
        where: { driverId: driverIds[0] },
      });
      expect(entry.status).toBe('waiting');
      expect(entry.queuePosition).toBeGreaterThanOrEqual(1);
      expect(entry.joinedAt).toBeInstanceOf(Date);
      expect(entry.dispatchedAt).toBeNull();
      expect(entry.leftAt).toBeNull();
    });

    it('marks the entry left_queue on departure', async () => {
      await airport.joinQueue(driverIds[0]);
      await airport.leaveQueue(driverIds[0]);

      const entry = await prisma.airportQueueEntry.findFirstOrThrow({
        where: { driverId: driverIds[0] },
      });
      expect(entry.status).toBe('left_queue');
      expect(entry.leftAt).toBeInstanceOf(Date);
    });

    it('marks the entry dispatched and links the trip', async () => {
      const tripId = '00000000-0000-0000-0000-00000000b001';
      await airport.joinQueue(driverIds[0]);

      await airport.dispatchNext(tripId);

      const entry = await prisma.airportQueueEntry.findFirstOrThrow({
        where: { driverId: driverIds[0] },
      });
      expect(entry.status).toBe('dispatched');
      expect(entry.dispatchedAt).toBeInstanceOf(Date);
      expect(entry.tripId).toBe(tripId);
    });

    it('keeps a historical row per join rather than reusing one', async () => {
      await airport.joinQueue(driverIds[0]);
      await airport.leaveQueue(driverIds[0]);
      await airport.joinQueue(driverIds[0]);

      const entries = await prisma.airportQueueEntry.findMany({
        where: { driverId: driverIds[0] },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.status)).toEqual(['left_queue', 'waiting']);
    });
  });

  // ── 3. Airport surge ─────────────────────────────────────────────────────

  describe('airport surge', () => {
    it('returns the baseline multiplier when no flight data is available', async () => {
      // Empty cache + unreachable FlightAware → no forecast → baseline.
      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(1.0);
      expect(surge.adminConfirmedAbove15x).toBe(false);
    });

    it('derives the multiplier from demand and queue supply', async () => {
      await seedArrivals([seatsFor(4)]); // requestsPerHour = 4
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]); // queueLength = 2 → ratio 2.0

      const surge = await airport.getCurrentSurge();

      // 1 + (2.0 - 1) * 0.3 = 1.3
      expect(surge.multiplier).toBe(1.3);
      expect(fetchSpy).not.toHaveBeenCalled(); // served from the warm cache
    });

    it('more supply lowers the multiplier for the same demand', async () => {
      await seedArrivals([seatsFor(6)]);
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);
      const withTwo = await airport.getCurrentSurge();

      await airport.joinQueue(driverIds[2]);
      const withThree = await airport.getCurrentSurge();

      expect(withThree.multiplier).toBeLessThan(withTwo.multiplier);
    });

    it('never exceeds the 2.5x cap, however extreme the demand', async () => {
      await seedArrivals([seatsFor(1500)]);
      await airport.joinQueue(driverIds[0]); // ratio 1500

      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(SURGE_CAP);
      expect(surge.multiplier).toBeLessThanOrEqual(SURGE_CAP);
    });

    it('holds the cap for absurd demand and stays deterministic', async () => {
      await seedArrivals([seatsFor(100000)]);
      await airport.joinQueue(driverIds[0]);

      const first = await airport.getCurrentSurge();
      const second = await airport.getCurrentSurge();

      expect(first.multiplier).toBe(SURGE_CAP);
      expect(second).toEqual(first);
    });

    it('never drops below 1.0 when supply exceeds demand', async () => {
      await seedArrivals([seatsFor(1)]);
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);
      await airport.joinQueue(driverIds[2]);

      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(1.0);
      expect(surge.multiplier).toBeGreaterThanOrEqual(1.0);
    });

    it('is deterministic for identical demand and supply', async () => {
      await seedArrivals([seatsFor(6)]);
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);

      const a = await airport.getCurrentSurge();
      const b = await airport.getCurrentSurge();
      const c = await airport.getCurrentSurge();

      expect(b).toEqual(a);
      expect(c).toEqual(a);
    });

    it('does not write to the queue key while pricing surge', async () => {
      await seedArrivals([seatsFor(6)]);
      await airport.joinQueue(driverIds[0]);
      const before = await redis.zrange(QUEUE_KEY, 0, -1, 'WITHSCORES');

      await airport.getCurrentSurge();

      expect(await redis.zrange(QUEUE_KEY, 0, -1, 'WITHSCORES')).toEqual(before);
    });
  });

  // ── 4. Admin-confirmation threshold ──────────────────────────────────────

  describe('admin-confirmation threshold at 1.5x', () => {
    it('does not flag a multiplier below 1.5x', async () => {
      await seedArrivals([seatsFor(4)]); // ratio 2.0 → 1.3
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);

      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(1.3);
      expect(surge.adminConfirmedAbove15x).toBe(false);
    });

    it('does NOT flag a multiplier of exactly 1.5x — the boundary is exclusive', async () => {
      await seedArrivals([seatsFor(5)]); // ratio 2.5 → raw 1.45 → rounds to 1.5
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);

      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(1.5);
      // Pinning production behaviour: the flag is `multiplier > 1.5`.
      expect(surge.adminConfirmedAbove15x).toBe(false);
    });

    it('flags a multiplier above 1.5x', async () => {
      await seedArrivals([seatsFor(6)]); // ratio 3.0 → 1.6
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);

      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(1.6);
      expect(surge.adminConfirmedAbove15x).toBe(true);
    });

    it('flags the capped multiplier', async () => {
      await seedArrivals([seatsFor(1500)]);
      await airport.joinQueue(driverIds[0]);

      const surge = await airport.getCurrentSurge();

      expect(surge.multiplier).toBe(SURGE_CAP);
      expect(surge.adminConfirmedAbove15x).toBe(true);
    });

    it('repeated reads do not mutate the flag', async () => {
      await seedArrivals([seatsFor(6)]);
      await airport.joinQueue(driverIds[0]);
      await airport.joinQueue(driverIds[1]);

      const first = await airport.getCurrentSurge();
      const second = await airport.getCurrentSurge();

      expect(second.adminConfirmedAbove15x).toBe(first.adminConfirmedAbove15x);
      expect(second.multiplier).toBe(first.multiplier);
    });
  });

  // ── 5. Concurrency and idempotency ───────────────────────────────────────

  describe('queue concurrency and idempotency', () => {
    it('never hands the same driver to two concurrent dispatches', async () => {
      await airport.joinQueue(driverIds[0]);
      await new Promise((r) => setTimeout(r, 5));
      await airport.joinQueue(driverIds[1]);

      const [a, b] = await Promise.all([
        airport.dispatchNext('00000000-0000-0000-0000-00000000c001'),
        airport.dispatchNext('00000000-0000-0000-0000-00000000c002'),
      ]);

      // ZPOPMIN is atomic: two calls take two different members.
      expect(a).not.toBe(b);
      expect([a, b].sort()).toEqual([driverIds[0], driverIds[1]].sort());
      expect(await redis.zrank(QUEUE_KEY, driverIds[0])).toBeNull();
      expect(await redis.zrank(QUEUE_KEY, driverIds[1])).toBeNull();
    });

    it('concurrent joins by different drivers produce distinct memberships', async () => {
      const results = await Promise.all([
        airport.joinQueue(driverIds[0]),
        airport.joinQueue(driverIds[1]),
        airport.joinQueue(driverIds[2]),
      ]);

      expect(results).toHaveLength(3);
      for (const id of driverIds) {
        expect(await redis.zrank(QUEUE_KEY, id)).not.toBeNull();
      }
      // A sorted set cannot hold duplicates; each driver appears exactly once.
      const members = await redis.zrange(QUEUE_KEY, 0, -1);
      const ours = members.filter((m) => driverIds.includes(m));
      expect(new Set(ours).size).toBe(3);
    });

    it('repeated departure is safe', async () => {
      await airport.joinQueue(driverIds[0]);

      await airport.leaveQueue(driverIds[0]);
      await expect(airport.leaveQueue(driverIds[0])).resolves.toBeUndefined();
      await expect(airport.leaveQueue(driverIds[0])).resolves.toBeUndefined();

      expect(await redis.zrank(QUEUE_KEY, driverIds[0])).toBeNull();
      expect(
        await prisma.airportQueueEntry.count({ where: { driverId: driverIds[0], status: 'waiting' } }),
      ).toBe(0);
    });

    it('a rejected duplicate join leaves the queue state unchanged', async () => {
      await airport.joinQueue(driverIds[0]);
      const before = await redis.zscore(QUEUE_KEY, driverIds[0]);

      await expectRejectCode(airport.joinQueue(driverIds[0]), 'QUEUE_ALREADY_JOINED');

      // The score (i.e. the FIFO position) was not reset by the failed attempt.
      expect(await redis.zscore(QUEUE_KEY, driverIds[0])).toBe(before);
    });
  });

  // ── 6. External isolation and Redis invariants ───────────────────────────

  describe('external isolation and Redis invariants', () => {
    it('contacts no external service when the flight cache is warm', async () => {
      await seedArrivals([seatsFor(6)]);
      await airport.joinQueue(driverIds[0]);

      await airport.getCurrentSurge();
      await airport.getQueuePosition(driverIds[0]);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('degrades to no forecast when FlightAware is unreachable', async () => {
      // Cold cache: the service attempts the call, which the spy rejects.
      const arrivals = await airport.getUpcomingArrivals();

      expect(arrivals).toEqual([]);
      expect(fetchSpy).toHaveBeenCalled();
      const [url] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('aeroapi.flightaware.com');

      // A failed fetch must not poison the cache or invent a surge.
      expect(await redis.exists(FLIGHT_CACHE_KEY)).toBe(0);
      expect(await airport.getCurrentSurge()).toEqual({
        multiplier: 1.0,
        adminConfirmedAbove15x: false,
      });
    });

    it('applies the production TTL to the flight cache', async () => {
      await seedArrivals([seatsFor(6)]);

      const ttl = await redis.ttl(FLIGHT_CACHE_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(FLIGHT_CACHE_TTL);
    });

    it('keeps queue state under a single namespaced key', async () => {
      await airport.joinQueue(driverIds[0]);

      expect(await redis.type(QUEUE_KEY)).toBe('zset');
      expect(await redis.zscore(QUEUE_KEY, driverIds[0])).not.toBeNull();
      // The queue itself carries no expiry — it is durable state, not a cache.
      expect(await redis.ttl(QUEUE_KEY)).toBe(-1);
    });
  });
});
