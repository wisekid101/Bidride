/**
 * E2 — STANDARD (non-bid) RIDE HAPPY PATH, end to end across real services.
 *
 * Composition is hybrid, per the approved strategy:
 *   - pricing-service, payment-service and trip-service run as REAL OS
 *     processes on test-only ports and talk to each other over REAL HTTP, so
 *     controllers, guards, DTO validation and serialization all execute.
 *   - PostgreSQL and Redis are real.
 *   - Vendors (Stripe) are severed inside each child process by a preload that
 *     intercepts at the socket layer; any other outbound host fails loudly.
 *   - Services outside the scenario (ai, trust, safety, notification) point at
 *     a closed loopback port, so their fire-and-forget calls fail
 *     deterministically — which is itself asserted.
 *
 * NODE_ENV is 'e2e', deliberately outside {development,test}, because those two
 * values make the internal-key guard fail open. Here the guard is closed and
 * must be satisfied with a real credential.
 */
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  startPrincipalServices,
  stopServices,
  portsAllFree,
  ServiceHandle,
  E2E_PORTS,
  tailLog,
} from './support/services';
import {
  seed,
  cleanupDb,
  cleanupRedis,
  mintToken,
  Fixture,
  STRIPE_CUSTOMER,
  CORRELATION_PREFIX,
  surgeZoneKey,
  snapshotKey,
  restoreKey,
} from './support/fixtures';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL!);

const TRIP = `http://127.0.0.1:${E2E_PORTS.trip}`;
const PRICING = `http://127.0.0.1:${E2E_PORTS.pricing}`;
const PAYMENT = `http://127.0.0.1:${E2E_PORTS.payment}`;

// ~12 miles, comfortably outside the EWR geofence, with addresses that cannot
// trip the strict airport name fallback.
const PICKUP = { lat: 40.7357, lng: -74.1724, address: '100 Market St, Newark NJ' };
const DROPOFF = { lat: 40.9097, lng: -74.1724, address: '200 Main St, Paterson NJ' };

const PLATFORM_FEE_RATE = 0.2;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Money assertions compare cents as integers — never raw floats. */
const cents = (n: number) => Math.round(n * 100);

/**
 * The throttler buckets on the rightmost X-Forwarded-For, and POST /trips
 * allows only 5/60s. Each run therefore needs its own bucket.
 *
 * The tag is a cryptographically random UUID, NOT a derived-from-clock value:
 * a time-derived tag with a small modulus (an earlier version used
 * `Date.now() % 250`) can repeat across back-to-back runs and inherit the
 * previous run's rate-limit budget. The tracker treats the value as an opaque
 * bucket key, so any unique string works and the space is effectively
 * unbounded — safe for unlimited consecutive executions.
 *
 * This affects rate limiting ONLY. Authentication is bearer-token based and
 * authorization derives from JWT claims; neither reads this header.
 */
const RUN_TAG = `e2e-${randomUUID()}`;

function authed(token: string, extra: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Forwarded-For': RUN_TAG,
    ...extra,
  };
}

async function waitFor<T>(
  fn: () => Promise<T | undefined | null>,
  what: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('E2 — standard ride happy path (cross-service)', () => {
  let services: ServiceHandle[] = [];
  let fx: Fixture;
  let riderToken: string;
  let driverToken: string;
  let tripId: string;
  let quotedFare: number;

  let surgeSnap: { key: string; value: string | null; ttl: number };

  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => unhandled.push(r);

  beforeAll(async () => {
    process.on('unhandledRejection', onUnhandled);
    await cleanupDb(prisma);
    // trip creation INCRs the shared demand counter for this zone; capture it
    // so the run leaves the value exactly as it found it.
    surgeSnap = await snapshotKey(redis, surgeZoneKey(PICKUP.lat, PICKUP.lng));
    fx = await seed(prisma);
    riderToken = mintToken(fx.riderUserId, 'rider');
    driverToken = mintToken(fx.driverUserId, 'driver');
    services = await startPrincipalServices();
  }, 240_000);

  afterAll(async () => {
    // Teardown steps are isolated so one failure cannot skip the connection
    // close below it, but failures are REPORTED rather than swallowed: a silent
    // catch here once hid a broken cleanup that only surfaced as a collision on
    // the following run.
    const teardownErrors: string[] = [];
    const settle = async (label: string, w: Promise<unknown> | undefined) => {
      try {
        await w;
      } catch (e) {
        teardownErrors.push(`${label}: ${(e as Error).message}`);
      }
    };

    process.off('unhandledRejection', onUnhandled);
    await settle('stopServices', stopServices(services));
    if (tripId) await settle('cleanupRedis', cleanupRedis(redis, [tripId]));
    await settle('restore surge counter', restoreKey(redis, surgeSnap));
    await settle('cleanupDb', cleanupDb(prisma));
    await settle('prisma.$disconnect', prisma.$disconnect());
    await settle('redis.quit', redis.quit());

    if (teardownErrors.length) {
      // eslint-disable-next-line no-console
      console.error(`E2E teardown problems (fixtures may remain):\n  ${teardownErrors.join('\n  ')}`);
    }
  }, 60_000);

  // ── Security boundary ────────────────────────────────────────────────────

  describe('internal-service authentication', () => {
    const body = JSON.stringify({ tripId: 'x', riderId: 'y', amount: 1 });

    it('rejects charge-trip with NO internal key', async () => {
      const res = await fetch(`${PAYMENT}/payments/internal/charge-trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': RUN_TAG },
        body,
      });
      expect(res.status).toBe(401);
    });

    it('rejects charge-trip with a WRONG internal key', async () => {
      const res = await fetch(`${PAYMENT}/payments/internal/charge-trip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': 'definitely-not-the-key',
          'X-Forwarded-For': RUN_TAG,
        },
        body,
      });
      expect(res.status).toBe(401);
    });

    it('rejects a user JWT presented as an internal credential', async () => {
      const res = await fetch(`${PAYMENT}/payments/internal/charge-trip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': riderToken, // a valid user token is NOT a service credential
          'X-Forwarded-For': RUN_TAG,
        },
        body,
      });
      expect(res.status).toBe(401);
    });

    it('rejects an unauthenticated trip creation', async () => {
      const res = await fetch(`${TRIP}/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': RUN_TAG },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Quote ────────────────────────────────────────────────────────────────

  describe('pricing quote', () => {
    it('returns a deterministic quote over real HTTP', async () => {
      const payload = {
        pickupLat: PICKUP.lat, pickupLng: PICKUP.lng,
        dropoffLat: DROPOFF.lat, dropoffLng: DROPOFF.lng,
        rideType: 'standard', isAirportTrip: false, riderTotalTrips: 0,
      };
      const res = await fetch(`${PRICING}/pricing/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(201);
      const quote = (await res.json()) as {
        fare: number; distanceMiles: number; surgeMultiplier: number;
        breakdown: { airport: number; surge: number; aiAdjustment: number };
        modelVersion: string;
      };

      quotedFare = quote.fare;
      expect(quote.fare).toBeGreaterThan(0);
      expect(round2(quote.fare)).toBe(quote.fare);
      // Deterministic conditions: no surge, no AI, and NOT an airport trip.
      expect(quote.surgeMultiplier).toBe(1);
      expect(quote.breakdown.surge).toBe(0);
      expect(quote.breakdown.aiAdjustment).toBe(0);
      expect(quote.breakdown.airport).toBe(0);
      expect(quote.modelVersion).toBe('fallback-v1');

      // Same inputs, same answer.
      const again = await fetch(`${PRICING}/pricing/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(((await again.json()) as { fare: number }).fare).toBe(quotedFare);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  describe('ride lifecycle', () => {
    it('creates the trip, persisting exactly the quoted fare as aiFare', async () => {
      const res = await fetch(`${TRIP}/trips`, {
        method: 'POST',
        headers: authed(riderToken),
        body: JSON.stringify({
          pickupAddress: PICKUP.address, pickupLat: PICKUP.lat, pickupLng: PICKUP.lng,
          dropoffAddress: DROPOFF.address, dropoffLat: DROPOFF.lat, dropoffLng: DROPOFF.lng,
          rideType: 'standard',
        }),
      });
      if (res.status !== 201) {
        throw new Error(`createTrip failed ${res.status}: ${await res.text()}\n${tailLog(services[2])}`);
      }
      const created = (await res.json()) as { id?: string; trip?: { id: string } };
      tripId = created.id ?? created.trip!.id;
      expect(tripId).toBeTruthy();

      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      // The quote crossed a real HTTP boundary and was stored unchanged.
      expect(cents(Number(trip.aiFare))).toBe(cents(quotedFare));
      expect(trip.status).toBe('searching');
      expect(trip.isAirportTrip).toBe(false);
      // Standard ride: no bid, and therefore no negotiated fare.
      expect(trip.bidId).toBeNull();
      expect(trip.finalFare).toBeNull();
      expect(trip.platformFee).toBeNull();
      expect(trip.driverEarnings).toBeNull();
    });

    it('progresses through the production status sequence', async () => {
      const step = async (path: string, body?: unknown) => {
        const res = await fetch(`${TRIP}/trips/${tripId}/${path}`, {
          method: 'POST',
          headers: authed(driverToken),
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          throw new Error(`${path} failed ${res.status}: ${await res.text()}`);
        }
        return res;
      };

      await step('accept');
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe('accepted');

      await step('arrived');
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe('driver_arrived');

      await step('start');
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe('in_progress');

      // endTrip enforces a dropoff-proximity lock.
      await step('end', { currentLat: DROPOFF.lat, currentLng: DROPOFF.lng });
      const done = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(done.status).toBe('completed');
      expect(done.completedAt).toBeInstanceOf(Date);
    });
  });

  // ── Financial invariants ─────────────────────────────────────────────────

  describe('canonical fare and platform economics', () => {
    it('uses the standard-ride canonical rule: finalFare = aiFare', async () => {
      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(cents(Number(t.finalFare))).toBe(cents(Number(t.aiFare)));
      expect(cents(Number(t.finalFare))).toBe(cents(quotedFare));
      expect(t.bidId).toBeNull(); // never a negotiated fare
    });

    it('charges the platform fee exactly once and reconciles', async () => {
      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      const fare = Number(t.finalFare);
      const fee = Number(t.platformFee);
      const earnings = Number(t.driverEarnings);
      const supplement = Number(t.earningsSupplement);

      expect(cents(fee)).toBe(cents(round2(fare * PLATFORM_FEE_RATE)));

      if (t.earningsFloorMet) {
        // No supplement: the split must reconcile to the cent.
        expect(cents(supplement)).toBe(0);
        expect(cents(fee) + cents(earnings)).toBe(cents(fare));
      } else {
        // Platform-funded supplement: the rider's fare is untouched and the
        // excess over the split is exactly the supplement.
        expect(cents(supplement)).toBeGreaterThan(0);
        expect(cents(fee) + cents(earnings) - cents(supplement)).toBe(cents(fare));
        const log = await prisma.earningsFloorLog.findFirstOrThrow({ where: { tripId } });
        expect(cents(Number(log.supplementAmount))).toBe(cents(supplement));
      }
    });

    it('applies no airport premium to a non-airport ride', async () => {
      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(t.isAirportTrip).toBe(false);
      // The fare is exactly the quote — nothing was added after the estimate.
      expect(cents(Number(t.finalFare))).toBe(cents(quotedFare));
    });
  });

  // ── Payment handoff ──────────────────────────────────────────────────────

  describe('payment handoff', () => {
    it('creates exactly one succeeded payment for the canonical fare', async () => {
      // charge-trip is dispatched fire-and-forget by trip-service, so the row
      // appears asynchronously after the completion response.
      let payment = await prisma.payment.findFirst({ where: { tripId } }).catch(() => null);
      if (!payment) {
        try {
          payment = await waitFor(
            () => prisma.payment.findFirst({ where: { tripId } }),
            'the payment row for the completed trip',
          );
        } catch (timeout) {
          // No row appeared. trip-service dispatches charge-trip
          // fire-and-forget and swallows the response, so the only way to see
          // why is to make the same call ourselves and read the answer.
          const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
          const probe = await fetch(`${PAYMENT}/payments/internal/charge-trip`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-key': process.env.INTERNAL_SERVICE_KEY!,
              'X-Forwarded-For': RUN_TAG,
            },
            body: JSON.stringify({
              tripId,
              riderId: fx.riderId,
              amount: Number(t.finalFare),
            }),
            signal: AbortSignal.timeout(15_000),
          }).catch((e) => ({ status: 0, text: async () => `probe failed: ${(e as Error).message}` }));
          throw new Error(
            `${(timeout as Error).message}\n` +
              `  direct charge-trip probe -> ${probe.status} ${await probe.text()}\n` +
              `  trip.finalFare=${String(t.finalFare)} bidId=${String(t.bidId)}`,
          );
        }
      }

      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(cents(Number(payment.amount))).toBe(cents(Number(t.finalFare)));
      expect(payment.status).toBe('succeeded');
      expect(payment.riderId).toBe(fx.riderId);
      // Proves the Stripe boundary was served by the harness stub, never a vendor.
      expect(payment.stripePaymentIntentId).toMatch(/^e2e_test_pi_/);

      expect(await prisma.payment.count({ where: { tripId } })).toBe(1);
    });

    it('books a balanced double-entry ledger for the same amount', async () => {
      // A completed trip books TWO ledger pairs against the same tripId: the
      // rider charge (entryType 'rider_payment') and the driver wallet credit
      // (from credit-wallet). Scope to the charge, or the driver-earning leg is
      // matched by mistake.
      const entries = await waitFor(async () => {
        const rows = await prisma.financialLedger.findMany({
          where: { tripId, entryType: 'rider_payment' },
        });
        return rows.length >= 2 ? rows : undefined;
      }, 'the rider payment ledger entries');

      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      const debit = entries.find((e) => e.direction === 'debit');
      const credit = entries.find((e) => e.direction === 'credit');

      expect(debit).toBeTruthy();
      expect(credit).toBeTruthy();
      expect(cents(Number(debit!.amount))).toBe(cents(Number(t.finalFare)));
      expect(cents(Number(credit!.amount))).toBe(cents(Number(t.finalFare)));
      expect(debit!.accountId).toBe(fx.riderId);
      expect(debit!.accountType).toBe('rider');
      expect(credit!.accountType).toBe('platform');
      // Exactly one double-entry pair for the charge — no duplicate booking.
      expect(entries).toHaveLength(2);
    });

    it('never uses a bid hold for a standard ride', async () => {
      // The invariant: a standard ride never creates or consumes a bid
      // authorization hold. It is asserted against THIS scenario's trip, never
      // against the whole keyspace — trip-service integration fixtures run in a
      // parallel Turbo workspace against the same Redis and legitimately own
      // keys under `bid:*:pi`. A global scan failed on one of theirs.
      expect(await prisma.bid.count({ where: { tripId } })).toBe(0);

      // Second gate, in case a hold were ever placed for a bid on this trip
      // without the count above catching it: resolve every live handle back to
      // its bid row and keep only the ones belonging to this trip. Keys that
      // resolve to another trip's bid — or to no bid at all, because the owning
      // worker has already cleaned up — are not ours and are not evidence.
      const handleKeys = await redis.keys('bid:*:pi');
      const bidIds = handleKeys
        .map((k) => /^bid:(.+):pi$/.exec(k)?.[1])
        .filter((id): id is string => !!id);
      const ours = bidIds.length
        ? await prisma.bid.findMany({ where: { id: { in: bidIds }, tripId }, select: { id: true } })
        : [];
      expect(ours).toHaveLength(0);
    });
  });

  // ── Replay boundary ──────────────────────────────────────────────────────

  describe('replay boundary', () => {
    it('reading the trip does not create additional financial rows', async () => {
      const before = {
        payments: await prisma.payment.count({ where: { tripId } }),
        ledger: await prisma.financialLedger.count({ where: { tripId } }),
      };

      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${TRIP}/trips/${tripId}`, { headers: authed(riderToken) });
        expect(res.ok).toBe(true);
      }
      const list = await fetch(`${TRIP}/trips`, { headers: authed(riderToken) });
      expect(list.ok).toBe(true);

      expect(await prisma.payment.count({ where: { tripId } })).toBe(before.payments);
      expect(await prisma.financialLedger.count({ where: { tripId } })).toBe(before.ledger);
    });

    it('the receipt amount equals the canonical fare', async () => {
      const res = await fetch(`${TRIP}/trips/${tripId}`, { headers: authed(riderToken) });
      const body = (await res.json()) as { finalFare?: unknown };
      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(cents(Number(body.finalFare))).toBe(cents(Number(t.finalFare)));
    });
  });

  // ── Side effects and isolation ───────────────────────────────────────────

  describe('side effects and vendor isolation', () => {
    it('failing non-critical side effects changed neither the fare nor the payment', async () => {
      // ai / trust / safety / notification all pointed at a closed port for the
      // whole run, so every fire-and-forget call to them failed.
      const t = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(cents(Number(t.finalFare))).toBe(cents(quotedFare));
      expect(await prisma.payment.count({ where: { tripId } })).toBe(1);
    });

    it('no unhandled promise rejection escaped the test process', () => {
      expect(unhandled).toEqual([]);
    });

    it('the rider fixture kept its payment method on file', async () => {
      const rider = await prisma.rider.findUniqueOrThrow({ where: { id: fx.riderId } });
      expect(rider.stripeCustomerId).toBe(STRIPE_CUSTOMER);
    });

    it('correlation ids are namespaced to this suite', () => {
      expect(CORRELATION_PREFIX).toBe('e2e-standard-ride');
    });
  });

  // ── Process hygiene ──────────────────────────────────────────────────────

  describe('harness hygiene', () => {
    it('all three services are still healthy at the end of the scenario', async () => {
      for (const h of services) {
        const res = await fetch(`http://127.0.0.1:${h.port}/health`);
        expect(res.ok).toBe(true);
      }
      expect(portsAllFree()).toBe(false); // still running until afterAll
    });
  });
});
