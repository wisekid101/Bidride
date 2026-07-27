/**
 * Integration tests for pricing-service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL (enforced by
 * test/integration-setup.js, so a misconfigured run fails instead of skipping).
 *
 * These tests pin CURRENT production pricing behaviour. They assert what the
 * fare engine does today; they do not propose formulas.
 *
 *   1. Standard quote   — components, minimum fare, rounding, determinism
 *   2. Surge            — baseline, threshold-driven multiplier, cap boundary
 *   3. Reconciliation   — the breakdown adds up to the quoted fare
 *   4. Airport          — premium applied exactly once, quotes stay distinct
 *   5. Feature policy   — persisted audit features carry no prohibited attrs
 *   6. Persistence      — audit row matches the returned quote; Redis untouched
 *
 * Determinism and isolation:
 *   - `requestedAt` is always supplied explicitly, so the night-premium branch
 *     never depends on when the suite runs. Dates are built from local
 *     components so the branch is timezone-independent.
 *   - AI_SERVICE_URL is removed, so getAiAdjustment takes its deterministic
 *     fallback (adjustment 0, modelVersion 'fallback-v1'). `global.fetch` is
 *     additionally replaced with a throwing spy, so any outbound HTTP attempt
 *     fails the run rather than escaping. The removal happens in beforeAll,
 *     NOT at module scope: importing @bidride/database re-loads the repo-root
 *     .env (packages/database/.env is a symlink to it), which restores any
 *     variable deleted before that import.
 *   - The suite READS platform_config and never writes it: `ai_surge_config` is
 *     a shared singleton key that cannot be namespaced per suite, so the
 *     threshold is read back and expectations are derived from it.
 *
 * The injected PrismaService reads DATABASE_URL, so we pin it to the test
 * database here to guarantee every connection targets TEST_DATABASE_URL only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { FareEngineService } from './fare-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);

/**
 * Reserved fixture identifiers for this suite.
 *
 * pricing-service creates no users, so it needs no phone block. It owns two
 * other namespaces instead:
 *   - RIDE_TYPE is echoed into every audit row as `vehicleClass`, which is how
 *     this suite scopes its cleanup.
 *   - The coordinates sit far from Newark so the derived surge zone keys can
 *     never collide with trip-service (which WRITES surge:requests:{zone} on
 *     trip creation) or with a developer's local data.
 */
const RIDE_TYPE = 'itest-pricing';
/**
 * Audit writes are fire-and-forget, so a row from an earlier test can land
 * after the next test's cleanup. Tests that assert on persisted rows therefore
 * use their OWN ride type and query for it exactly, making them race-free;
 * cleanup matches the shared prefix.
 */
const rideTypeFor = (suffix: string) => `${RIDE_TYPE}-${suffix}`;
const PICKUP = { lat: 5.1, lng: 5.1 };
const DROPOFF = { lat: 5.15, lng: 5.15 };
const PICKUP_ZONE = `${Math.floor(PICKUP.lat / 0.018)}:${Math.floor(PICKUP.lng / 0.022)}`;
const SURGE_KEY = `surge:requests:${PICKUP_ZONE}`;

// Production constants mirrored for assertions (see fare-engine.service.ts).
const BASE_FARE = 2.5;
const PER_MILE = 1.1;
const PER_MIN = 0.22;
const AIRPORT_PREMIUM = 3.5;
const NIGHT_PREMIUM = 1.0;
const MINIMUM_FARE = 5.0;
const DEFAULT_SURGE_THRESHOLD = 150;

// Local-component dates so the night branch is timezone-independent.
const DAYTIME = new Date(2026, 2, 10, 14, 0, 0);
const NIGHTTIME = new Date(2026, 2, 10, 23, 0, 0);

const baseInput = (over: Record<string, unknown> = {}) => ({
  pickupLat: PICKUP.lat,
  pickupLng: PICKUP.lng,
  dropoffLat: DROPOFF.lat,
  dropoffLng: DROPOFF.lng,
  rideType: RIDE_TYPE,
  requestedAt: DAYTIME,
  ...over,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wait until `predicate` returns truthy. Fails the test on timeout. */
async function waitFor<T>(
  predicate: () => Promise<T | undefined | null> | T | undefined | null,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('pricing-service (integration)', () => {
  let moduleRef: TestingModule;
  let engine: FareEngineService;
  let servicePrisma: PrismaService;
  let fetchSpy: jest.SpyInstance;

  /** The live surge threshold — read, never written. */
  let surgeThreshold = DEFAULT_SURGE_THRESHOLD;

  /** Delete only the audit rows this suite created, identified by ride type. */
  async function cleanupAuditRows() {
    await prisma.aiPricingLog.deleteMany({
      where: { inputFeatures: { path: ['vehicleClass'], string_starts_with: RIDE_TYPE } },
    });
  }

  /** Delete only this suite's surge counter. Never FLUSHDB. */
  async function cleanupRedis() {
    await redis.del(SURGE_KEY);
  }

  /** Audit rows for one specific ride type, newest first. */
  function auditRows(rideType: string) {
    return prisma.aiPricingLog.findMany({
      where: { inputFeatures: { path: ['vehicleClass'], equals: rideType } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Await exactly `count` audit rows for a ride type. */
  function expectRows(rideType: string, count: number) {
    return waitFor(async () => {
      const found = await auditRows(rideType);
      return found.length === count ? found : undefined;
    }, `${count} audit row(s) for ${rideType}`);
  }

  beforeAll(async () => {
    // Must happen AFTER the imports above: loading @bidride/database re-reads
    // the repo-root .env and would restore this variable if deleted earlier.
    delete process.env.AI_SERVICE_URL;
    await cleanupAuditRows();
    await cleanupRedis();

    const config = await prisma.platformConfig.findUnique({
      where: { key: 'ai_surge_config' },
    });
    const value = config?.value as { requests_per_zone_threshold?: number } | null;
    surgeThreshold = value?.requests_per_zone_threshold ?? DEFAULT_SURGE_THRESHOLD;

    moduleRef = await Test.createTestingModule({
      providers: [
        FareEngineService,
        PrismaService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    engine = moduleRef.get(FareEngineService);
    servicePrisma = moduleRef.get(PrismaService);

    // No pricing path in scope may reach the network.
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('Outbound HTTP attempted during integration test');
    });
  });

  afterAll(async () => {
    const settle = (work: Promise<unknown> | undefined) =>
      Promise.resolve(work).catch(() => undefined);

    fetchSpy?.mockRestore();
    await settle(cleanupAuditRows());
    await settle(cleanupRedis());
    await settle(moduleRef?.close());
    await settle(servicePrisma?.$disconnect());
    await settle(prisma.$disconnect());
    await settle(redis.quit());
  });

  beforeEach(async () => {
    delete process.env.AI_SERVICE_URL; // stays on the deterministic fallback
    fetchSpy.mockClear();
    await cleanupAuditRows();
    await cleanupRedis();
  });

  // ── 1. Standard quote calculation ────────────────────────────────────────

  describe('standard quote calculation', () => {
    it('builds the fare from base, distance and duration components', async () => {
      const q = await engine.estimateFare(baseInput());

      expect(q.breakdown.base).toBe(BASE_FARE);
      expect(q.distanceMiles).toBeGreaterThan(0);
      expect(q.durationMin).toBeGreaterThan(0);

      // Components are derived from the engine's own distance/duration outputs.
      expect(q.breakdown.distance).toBeCloseTo(round2(q.distanceMiles * PER_MILE), 1);
      expect(q.breakdown.duration).toBeCloseTo(round2(q.durationMin * PER_MIN), 2);

      // No surge, no AI, daytime, non-airport.
      expect(q.surgeMultiplier).toBe(1);
      expect(q.breakdown.surge).toBe(0);
      expect(q.breakdown.aiAdjustment).toBe(0);
      expect(q.breakdown.airport).toBe(0);
      expect(q.breakdown.night).toBe(0);
      expect(q.modelVersion).toBe('fallback-v1');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('derives duration from distance at the configured average speed', async () => {
      const q = await engine.estimateFare(baseInput());

      // durationMin = round(distance / 20mph * 60)
      expect(q.durationMin).toBe(Math.round((q.distanceMiles / 20) * 60));
    });

    it('applies the minimum fare to a zero-distance trip', async () => {
      const q = await engine.estimateFare(
        baseInput({ dropoffLat: PICKUP.lat, dropoffLng: PICKUP.lng }),
      );

      expect(q.distanceMiles).toBe(0);
      expect(q.durationMin).toBe(0);
      // Raw fare would be just the base ($2.50); the floor lifts it to $5.00.
      expect(q.fare).toBe(MINIMUM_FARE);
    });

    it('rounds every money value to at most two decimals', async () => {
      const q = await engine.estimateFare(baseInput());

      const monies = [
        q.fare,
        q.breakdown.base, q.breakdown.distance, q.breakdown.duration,
        q.breakdown.surge, q.breakdown.airport, q.breakdown.night,
        q.breakdown.aiAdjustment,
      ];
      for (const value of monies) {
        expect(round2(value)).toBe(value);
      }
      expect(round2(q.surgeMultiplier)).toBe(q.surgeMultiplier);
    });

    it('is deterministic for identical inputs', async () => {
      const first = await engine.estimateFare(baseInput());
      const second = await engine.estimateFare(baseInput());
      const third = await engine.estimateFare(baseInput());

      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });

    it('charges the night premium only during night hours', async () => {
      const day = await engine.estimateFare(baseInput({ requestedAt: DAYTIME }));
      const night = await engine.estimateFare(baseInput({ requestedAt: NIGHTTIME }));

      expect(day.breakdown.night).toBe(0);
      expect(night.breakdown.night).toBe(NIGHT_PREMIUM);
      expect(round2(night.fare - day.fare)).toBe(NIGHT_PREMIUM);
    });
  });

  // ── 2. Surge pricing ─────────────────────────────────────────────────────

  describe('surge pricing', () => {
    it('applies no surge when the zone has no demand counter', async () => {
      expect(await redis.exists(SURGE_KEY)).toBe(0);

      const q = await engine.estimateFare(baseInput());

      expect(q.surgeMultiplier).toBe(1);
      expect(q.breakdown.surge).toBe(0);
    });

    it('scales the multiplier with the zone demand counter', async () => {
      // score = min(1, raw / threshold); multiplier = 1 + score * 0.4
      await redis.set(SURGE_KEY, String(Math.floor(surgeThreshold / 2)));

      const q = await engine.estimateFare(baseInput());

      const expectedScore = Math.floor(surgeThreshold / 2) / surgeThreshold;
      expect(q.surgeMultiplier).toBeCloseTo(round2(1 + expectedScore * 0.4), 2);
      expect(q.surgeMultiplier).toBeGreaterThan(1);
      expect(q.surgeMultiplier).toBeLessThan(1.4);
    });

    it('caps the multiplier at 1.4 once demand reaches the threshold', async () => {
      await redis.set(SURGE_KEY, String(surgeThreshold));

      const atThreshold = await engine.estimateFare(baseInput());
      expect(atThreshold.surgeMultiplier).toBe(1.4);
    });

    it('holds the cap for demand far above the threshold', async () => {
      await redis.set(SURGE_KEY, String(surgeThreshold * 100));

      const wayOver = await engine.estimateFare(baseInput());
      expect(wayOver.surgeMultiplier).toBe(1.4);

      // Deterministic at the cap boundary.
      const again = await engine.estimateFare(baseInput());
      expect(again).toEqual(wayOver);
    });

    it('multiplies the whole pre-AI fare, not just part of it', async () => {
      const flat = await engine.estimateFare(baseInput());
      await redis.set(SURGE_KEY, String(surgeThreshold * 100)); // cap: 1.4×
      const surged = await engine.estimateFare(baseInput());

      // The engine multiplies the UNROUNDED fare and rounds once at the end,
      // so comparing against the already-rounded flat fare can differ by a
      // cent. That is the current rounding behaviour, not a discrepancy.
      expect(surged.fare).toBeCloseTo(flat.fare * 1.4, 1);
      expect(surged.breakdown.surge).toBeCloseTo(flat.fare * 0.4, 1);
    });

    it('reads the surge counter without mutating it', async () => {
      await redis.set(SURGE_KEY, '42');

      await engine.estimateFare(baseInput());

      // pricing-service is a READER of surge counters; trip-service writes them.
      expect(await redis.get(SURGE_KEY)).toBe('42');
      expect(await redis.ttl(SURGE_KEY)).toBe(-1); // untouched: no TTL applied
    });
  });

  // ── 3. Fare reconciliation ───────────────────────────────────────────────

  describe('fare reconciliation', () => {
    it('breakdown components sum to the quoted fare', async () => {
      const q = await engine.estimateFare(baseInput());
      const b = q.breakdown;

      const sum = b.base + b.distance + b.duration + b.airport + b.night + b.surge + b.aiAdjustment;
      // Components are each rounded independently, so allow a sub-cent delta.
      expect(sum).toBeCloseTo(q.fare, 1);
    });

    it('breakdown still reconciles under surge and airport together', async () => {
      await redis.set(SURGE_KEY, String(surgeThreshold * 100));

      const q = await engine.estimateFare(
        baseInput({ isAirportTrip: true, requestedAt: NIGHTTIME }),
      );
      const b = q.breakdown;

      const sum = b.base + b.distance + b.duration + b.airport + b.night + b.surge + b.aiAdjustment;
      expect(sum).toBeCloseTo(q.fare, 1);
    });

    it('does NOT reconcile when the minimum fare floor lifts the quote', async () => {
      // Documented current behaviour: the floor is applied to the final fare
      // only, so the breakdown legitimately sums to less than the quote.
      const q = await engine.estimateFare(
        baseInput({ dropoffLat: PICKUP.lat, dropoffLng: PICKUP.lng }),
      );
      const b = q.breakdown;

      const sum = b.base + b.distance + b.duration + b.airport + b.night + b.surge + b.aiAdjustment;
      expect(q.fare).toBe(MINIMUM_FARE);
      expect(sum).toBe(BASE_FARE);
      expect(sum).toBeLessThan(q.fare); // the floor supplement is not itemised
    });
  });

  // ── 4. Airport pricing ───────────────────────────────────────────────────

  describe('airport pricing', () => {
    it('adds the airport premium exactly once', async () => {
      const standard = await engine.estimateFare(baseInput({ isAirportTrip: false }));
      const airport = await engine.estimateFare(baseInput({ isAirportTrip: true }));

      expect(standard.breakdown.airport).toBe(0);
      expect(airport.breakdown.airport).toBe(AIRPORT_PREMIUM);
      // With no surge the difference is exactly one premium — not two.
      expect(round2(airport.fare - standard.fare)).toBe(AIRPORT_PREMIUM);
    });

    it('keeps airport and non-airport quotes distinct', async () => {
      const standard = await engine.estimateFare(baseInput({ isAirportTrip: false }));
      const airport = await engine.estimateFare(baseInput({ isAirportTrip: true }));

      expect(airport.fare).not.toBe(standard.fare);
      expect(airport.fare).toBeGreaterThan(standard.fare);
    });

    it('applies the premium once under surge, scaled by the multiplier', async () => {
      await redis.set(SURGE_KEY, String(surgeThreshold * 100)); // 1.4×

      const standard = await engine.estimateFare(baseInput({ isAirportTrip: false }));
      const airport = await engine.estimateFare(baseInput({ isAirportTrip: true }));

      // One premium, multiplied by surge — never added twice.
      expect(round2(airport.fare - standard.fare)).toBeCloseTo(
        round2(AIRPORT_PREMIUM * 1.4), 1,
      );
      expect(airport.breakdown.airport).toBe(AIRPORT_PREMIUM);
    });

    it('records the airport flag on the persisted audit row exactly once', async () => {
      const rideType = rideTypeFor('airport');
      const q = await engine.estimateFare(baseInput({ isAirportTrip: true, rideType }));

      const rows = await expectRows(rideType, 1);
      const features = rows[0].inputFeatures as Record<string, unknown>;

      expect(features.isAirport).toBe(true);
      expect(features.isAirportTrip).toBe(true);
      expect(Number(rows[0].finalFare)).toBe(q.fare);
    });
  });

  // ── 5. Feature policy (trust scores are prohibited) ──────────────────────

  describe('pricing feature policy', () => {
    it('persists only allowlisted features — no trust or identity attributes', async () => {
      const rideType = rideTypeFor('features');
      await engine.estimateFare(
        baseInput({
          rideType,
          // Prohibited / unknown attributes offered at the input boundary.
          trustScore: 95,
          riderTrustScore: 95,
          riderId: 'rider-should-never-appear',
          riderPhone: '+15550001111',
          riderName: 'Should Not Appear',
        } as never),
      );

      const rows = await expectRows(rideType, 1);
      const features = rows[0].inputFeatures as Record<string, unknown>;
      const serialized = JSON.stringify(features);

      for (const key of ['trustScore', 'riderTrustScore', 'riderId', 'riderPhone', 'riderName']) {
        expect(Object.keys(features)).not.toContain(key);
      }
      // Sanity: the containment check is meaningful on this payload.
      expect(serialized).toContain('vehicleClass');
      for (const secret of ['rider-should-never-appear', '+15550001111', 'Should Not Appear']) {
        expect(serialized).not.toContain(secret);
      }
      expect(features.schemaVersion).toBe(2);
    });

    it('a rider trip count changes nothing about the fare', async () => {
      const none = await engine.estimateFare(baseInput({ riderTotalTrips: 0 }));
      const loyal = await engine.estimateFare(baseInput({ riderTotalTrips: 500 }));

      // riderTotalTrips is an allowlisted feature but is not a fare input today.
      expect(loyal.fare).toBe(none.fare);
    });
  });

  // ── 6. Persistence and Redis ─────────────────────────────────────────────

  describe('audit persistence', () => {
    it('writes exactly one audit row per quote, matching the returned values', async () => {
      const rideType = rideTypeFor('quote');
      const q = await engine.estimateFare(baseInput({ rideType }));

      const rows = await expectRows(rideType, 1);
      const row = rows[0];

      expect(Number(row.finalFare)).toBe(q.fare);
      expect(Number(row.aiAdjustment)).toBe(q.breakdown.aiAdjustment);
      expect(row.modelVersion).toBe(q.modelVersion);
      expect(Number(row.rawFare)).toBeGreaterThan(0);
    });

    it('stores the quote linkage and zones, not a real trip id', async () => {
      const rideType = rideTypeFor('linkage');
      await engine.estimateFare(baseInput({ rideType }));

      const rows = await expectRows(rideType, 1);
      const row = rows[0];
      const features = row.inputFeatures as Record<string, unknown>;

      expect(features.requestId).toEqual(expect.any(String));
      expect(features.quoteId).toBe(row.tripId);
      expect(features.pickupZone).toBe(PICKUP_ZONE);
      expect(features.vehicleClass).toBe(rideType);

      // The audit table is NOT financial truth: its tripId is a synthetic quote
      // id, and no trip with that id exists.
      expect(await prisma.trip.count({ where: { id: row.tripId } })).toBe(0);
    });

    it('writes one row per request across repeated identical quotes', async () => {
      const rideType = rideTypeFor('repeat');
      const first = await engine.estimateFare(baseInput({ rideType }));
      const second = await engine.estimateFare(baseInput({ rideType }));

      const rows = await expectRows(rideType, 2);

      // Same quote, distinct audit identities.
      expect(second.fare).toBe(first.fare);
      expect(rows[0].tripId).not.toBe(rows[1].tripId);
      expect(Number(rows[0].finalFare)).toBe(Number(rows[1].finalFare));
    });

    it('persists the surged fare that was quoted', async () => {
      await redis.set(SURGE_KEY, String(surgeThreshold * 100));

      const rideType = rideTypeFor('surge');
      const q = await engine.estimateFare(baseInput({ rideType }));

      const rows = await expectRows(rideType, 1);
      const features = rows[0].inputFeatures as Record<string, unknown>;

      expect(Number(rows[0].finalFare)).toBe(q.fare);
      expect(features.surgeMultiplier).toBe(q.surgeMultiplier);
      expect(features.surgeZoneScore).toBe(1);
    });
  });

  // ── Demand zones (Redis read path) ───────────────────────────────────────

  describe('demand zones', () => {
    it('projects a zone counter into a weighted point', async () => {
      await redis.set(SURGE_KEY, '17');

      const result = await engine.getDemandZones(PICKUP.lat, PICKUP.lng, 5);

      const [latZone, lngZone] = PICKUP_ZONE.split(':').map(Number);
      const match = result.points.find(
        (p) =>
          Math.abs(p.latitude - (latZone + 0.5) * 0.018) < 1e-6 &&
          Math.abs(p.longitude - (lngZone + 0.5) * 0.022) < 1e-6,
      );
      expect(match?.weight).toBe(17);
      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    });

    it('returns no points when the surrounding zones are empty', async () => {
      const result = await engine.getDemandZones(PICKUP.lat, PICKUP.lng, 1);
      expect(result.points).toEqual([]);
    });

    it('returns no points for non-numeric coordinates', async () => {
      const result = await engine.getDemandZones(NaN, NaN, 5);
      expect(result.points).toEqual([]);
    });
  });
});
