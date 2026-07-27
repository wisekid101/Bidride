/**
 * Integration tests for safety-service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL (enforced by
 * test/integration-setup.js, so a misconfigured run fails instead of skipping).
 *
 * Safety decisions override everything else, so these tests exercise the real
 * persistence and real Redis semantics behind them:
 *
 *   1. SOS lifecycle       — initiate, countdown, confirm, cancel, invalid moves
 *   2. Redis countdown     — key presence, TTL, and clearing on confirm/cancel
 *   3. Panic workflow      — persistence, publication, and the rider-identity ban
 *   4. Notification        — an unreachable notification-service must not break SOS
 *   5. Route anomaly       — deviation rows, off-route timer, anomaly publication
 *   6. Recording lifecycle — local dev storage, no S3, fail-closed on missing KMS
 *
 * External isolation (nothing here reaches the network):
 *   - Google Maps: GOOGLE_MAPS_API_KEY is absent, so RouteService takes its
 *     deterministic straight-line fallback.
 *   - S3/KMS: AWS_ACCESS_KEY_ID is the dev placeholder, so recordings go to the
 *     local dev store. `s3.putObject` is additionally replaced with a throwing
 *     spy, so any attempt to reach S3 fails the run instead of escaping.
 *   - notification-service: pointed at a closed loopback port, proving SOS does
 *     not depend on it being up.
 *
 * The injected PrismaService reads DATABASE_URL, so we pin it to the test
 * database here to guarantee every connection targets TEST_DATABASE_URL only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
// notification-service is deliberately unreachable: port 9 (discard) refuses fast.
process.env.NOTIFICATION_SERVICE_URL = 'http://127.0.0.1:9';

import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SafetyService } from './safety.service';
import { RouteService, decodePolyline } from './route.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
// Command connection shared with the DI container; `subscriber` is a separate
// connection because an ioredis client in subscriber mode cannot issue commands.
const redis = new Redis(process.env.TEST_REDIS_URL!);
const subscriber = redis.duplicate();

// Reserved fixture block for this suite — distinct from other services'.
const RIDER_PHONE = '+19995557001';
const DRIVER_PHONE = '+19995557002';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];
const CONTACT_NAME = 'Safety Integration Contact';
const CONTACT_PHONE = '+19995557003';

const SOS_COUNTDOWN_TTL = 7; // SOS_COUNTDOWN_SECONDS (5) + 2
const OFF_ROUTE_TTL = 600;

const CHANNELS = ['safety:sos', 'safety:panic', 'safety:anomaly', 'notifications'];

// Repo-root artifact directory the service writes dev recordings into.
const DEV_ARTIFACT_ROOT = join(process.cwd(), '..', '..', '.dev-artifacts', 'sos-audio');

/** Messages seen on each subscribed channel, newest last. Cleared per test. */
const received: Record<string, string[]> = {};

/** Wait until `predicate` returns truthy, polling. Fails the test on timeout. */
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

/** Await the first message on `channel` matching `match`, parsed as JSON. */
async function waitForPublished(
  channel: string,
  match: (payload: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return waitFor(() => {
    for (const raw of received[channel] ?? []) {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      if (match(payload)) return payload;
    }
    return undefined;
  }, `a message on ${channel}`);
}

/** Assert a promise rejects with the given exception type. */
async function expectReject(promise: Promise<unknown>, type: new (...a: any[]) => Error) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(type);
  return caught as Error;
}

describe('safety-service (integration)', () => {
  let moduleRef: TestingModule;
  let safety: SafetyService;
  let routes: RouteService;
  let servicePrisma: PrismaService;
  let s3Put: jest.SpyInstance;

  const configValues: Record<string, string | undefined> = {
    // No GOOGLE_MAPS_API_KEY — forces the deterministic fallback route.
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'dev-placeholder', // routes recordings to local dev store
    KMS_RECORDINGS_KEY_ID: 'dev-local-no-kms',
    S3_BUCKET_SOS_AUDIO: 'bidride-sos-audio-dev',
  };

  let riderUserId: string;
  let riderId: string;
  let driverUserId: string;
  let tripId: string;
  let sessionId: string;

  /** Remove every row this suite can create, child-first. Idempotent. */
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
      const sessions = await prisma.safetySession.findMany({
        where: { tripId: { in: tripIds } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      await prisma.sosEvent.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.panicEvent.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.safeCheckIn.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.safetyRecording.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.routeDeviationEvent.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.tripRoute.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.tripSafetyScore.deleteMany({ where: { tripId: { in: tripIds } } });
      if (sessionIds.length) {
        await prisma.safetySession.deleteMany({ where: { id: { in: sessionIds } } });
      }
      await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    }

    if (riderIds.length) {
      await prisma.trustedContact.deleteMany({ where: { riderId: { in: riderIds } } });
      await prisma.rider.deleteMany({ where: { id: { in: riderIds } } });
    }
    if (driverIds.length) await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
    await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  }

  /** Delete only the Redis keys this suite creates. Never FLUSHDB. */
  async function cleanupRedis() {
    const keys: string[] = [];
    if (tripId) keys.push(`trip:${tripId}:off_route_since`);
    const countdowns = await redis.keys('sos:countdown:*');
    for (const key of countdowns) {
      // Only remove countdowns belonging to SOS rows this suite owns.
      const sosId = key.slice('sos:countdown:'.length);
      const owned = await prisma.sosEvent.findFirst({
        where: { id: sosId, tripId },
        select: { id: true },
      }).catch(() => null);
      if (owned) keys.push(key);
    }
    if (keys.length) await redis.del(...keys);
  }

  /** Remove any local dev recording artifacts this suite wrote. */
  async function cleanupArtifacts() {
    const sosEvents = tripId
      ? await prisma.sosEvent.findMany({ where: { tripId }, select: { id: true } }).catch(() => [])
      : [];
    for (const { id } of sosEvents) {
      await fs.rm(join(DEV_ARTIFACT_ROOT, id), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Fresh trip + safety session for a test that needs a clean state machine. */
  async function resetSession(overrides: Record<string, unknown> = {}) {
    await prisma.sosEvent.deleteMany({ where: { tripId } });
    await prisma.panicEvent.deleteMany({ where: { tripId } });
    await prisma.safetyRecording.deleteMany({ where: { tripId } });
    await prisma.safetySession.update({
      where: { id: sessionId },
      data: { currentState: 'normal', slaDeadline: null, ...overrides },
    });
  }

  beforeAll(async () => {
    await cleanupDb();

    const riderUser = await prisma.user.create({
      data: {
        phone: RIDER_PHONE,
        role: 'rider',
        firstName: 'Safety',
        lastName: 'Rider',
        rider: { create: {} },
      },
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
            legalFirstName: 'Safety',
            legalLastName: 'Driver',
            dateOfBirth: new Date('1990-01-01'),
          },
        },
      },
      include: { driver: true },
    });
    driverUserId = driverUser.id;

    // A trusted contact makes notifyTrustedContacts actually attempt the call,
    // which is what proves an unreachable notification-service is survivable.
    await prisma.trustedContact.create({
      data: { riderId, name: CONTACT_NAME, phone: CONTACT_PHONE, relationship: 'friend' },
    });

    const trip = await prisma.trip.create({
      data: {
        riderId,
        driverId: driverUser.driver!.id,
        status: 'in_progress',
        pickupAddress: '1 Test Way, Newark NJ',
        dropoffAddress: 'EWR Terminal B',
        pickupLat: 40.7357,
        pickupLng: -74.1724,
        dropoffLat: 40.6895,
        dropoffLng: -74.1745,
        aiFare: 24.5,
        startedAt: new Date(),
        estimatedDurationMin: 20,
      },
    });
    tripId = trip.id;

    const session = await prisma.safetySession.create({
      data: { tripId, currentState: 'normal', isNightRide: false },
    });
    sessionId = session.id;

    const config = {
      get: (key: string, fallback?: string) => configValues[key] ?? fallback,
      getOrThrow: (key: string) => {
        const value = configValues[key];
        if (value === undefined) throw new Error(`Missing config: ${key}`);
        return value;
      },
    } as unknown as ConfigService;

    moduleRef = await Test.createTestingModule({
      providers: [
        SafetyService,
        RouteService,
        PrismaService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    safety = moduleRef.get(SafetyService);
    routes = moduleRef.get(RouteService);
    servicePrisma = moduleRef.get(PrismaService);

    // Any S3 call is a test failure, not a silent network request.
    s3Put = jest
      .spyOn((safety as unknown as { s3: { putObject: (...a: unknown[]) => unknown } }).s3, 'putObject')
      .mockImplementation(() => {
        throw new Error('S3 putObject attempted during integration test');
      });

    subscriber.on('message', (channel: string, message: string) => {
      (received[channel] ??= []).push(message);
    });
    await subscriber.subscribe(...CHANNELS);
  });

  afterAll(async () => {
    // Isolated steps: a failure here must not skip the connection teardown
    // below it, or Jest hangs on an open socket instead of exiting.
    const settle = (work: Promise<unknown> | undefined) =>
      Promise.resolve(work).catch(() => undefined);

    s3Put?.mockRestore();
    await settle(cleanupArtifacts());
    await settle(cleanupRedis());
    await settle(cleanupDb());
    await settle(subscriber.unsubscribe());
    await settle(moduleRef?.close());
    await settle(servicePrisma?.$disconnect());
    await settle(prisma.$disconnect());
    await settle(subscriber.quit());
    await settle(redis.quit());
  });

  beforeEach(() => {
    for (const channel of CHANNELS) received[channel] = [];
    s3Put.mockClear();
  });

  // ── 1 + 2. SOS lifecycle and Redis countdown ─────────────────────────────

  describe('SOS lifecycle', () => {
    beforeEach(() => resetSession());
    afterEach(() => cleanupRedis());

    it('initiates an SOS, persists it, and moves the session to sos_active', async () => {
      const result = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

      expect(result.sosId).toBeTruthy();
      expect(result.countdownSeconds).toBe(5);

      const sos = await prisma.sosEvent.findUnique({ where: { id: result.sosId } });
      expect(sos?.status).toBe('active');
      expect(sos?.initiatedByRole).toBe('rider');
      expect(sos?.activationConfirmedAt).toBeNull();

      const session = await prisma.safetySession.findUnique({ where: { id: sessionId } });
      expect(session?.currentState).toBe('sos_active');
      expect(session?.slaDeadline).toBeInstanceOf(Date);
    });

    it('publishes the SOS to admin with trip context', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

      const payload = await waitForPublished('safety:sos', (p) => p.sosId === sosId);
      expect(payload).toMatchObject({
        event: 'safety:sos_new',
        sosId,
        tripId,
        initiatedByRole: 'rider',
      });
    });

    it('creates the countdown key with the expected TTL', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

      const key = `sos:countdown:${sosId}`;
      expect(await redis.exists(key)).toBe(1);
      expect(await redis.get(key)).toBe(riderUserId);

      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(SOS_COUNTDOWN_TTL);
    });

    it('confirms an SOS, clears the countdown, and starts a recording', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

      const result = await safety.confirmSos(sosId, riderUserId);
      expect(result.confirmed).toBe(true);

      // Countdown cleared — the 3-state machine has left the countdown phase.
      expect(await redis.exists(`sos:countdown:${sosId}`)).toBe(0);

      const sos = await prisma.sosEvent.findUnique({ where: { id: sosId } });
      expect(sos?.activationConfirmedAt).toBeInstanceOf(Date);

      // Recording is created on confirmation, never on initiation.
      const recording = await prisma.safetyRecording.findFirst({ where: { tripId } });
      expect(recording?.status).toBe('recording');
      expect(recording?.storageKey).toContain(`recordings/sos/${sosId}/`);
    });

    it('does not create a recording before confirmation', async () => {
      await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

      expect(await prisma.safetyRecording.count({ where: { tripId } })).toBe(0);
    });

    it('cancels an SOS during the countdown and returns the session to normal', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

      const result = await safety.cancelSos(sosId, riderUserId);
      expect(result.cancelled).toBe(true);

      expect(await redis.exists(`sos:countdown:${sosId}`)).toBe(0);

      const sos = await prisma.sosEvent.findUnique({ where: { id: sosId } });
      expect(sos?.status).toBe('false_alarm');
      expect(sos?.cancelledAt).toBeInstanceOf(Date);

      const session = await prisma.safetySession.findUnique({ where: { id: sessionId } });
      expect(session?.currentState).toBe('normal');
    });

    describe('invalid transitions', () => {
      it('rejects an SOS for a trip with no safety session', async () => {
        const orphanTrip = await prisma.trip.create({
          data: {
            riderId,
            status: 'in_progress',
            pickupAddress: 'A',
            dropoffAddress: 'B',
            pickupLat: 40.7,
            pickupLng: -74.1,
            dropoffLat: 40.71,
            dropoffLng: -74.11,
            aiFare: 10,
          },
        });

        await expectReject(
          safety.initiateSos(orphanTrip.id, riderUserId, 'button_tap', 40.7, -74.1),
          NotFoundException,
        );

        await prisma.trip.delete({ where: { id: orphanTrip.id } });
      });

      it('rejects an SOS from an unknown user', async () => {
        await expectReject(
          safety.initiateSos(tripId, '00000000-0000-0000-0000-000000000000', 'button_tap', 40.7, -74.1),
          NotFoundException,
        );
      });

      it('refuses confirmation by someone other than the initiator', async () => {
        const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);

        await expectReject(safety.confirmSos(sosId, driverUserId), ForbiddenException);
        await expectReject(safety.cancelSos(sosId, driverUserId), ForbiddenException);

        // The SOS is untouched by the rejected attempts.
        const sos = await prisma.sosEvent.findUnique({ where: { id: sosId } });
        expect(sos?.status).toBe('active');
        expect(sos?.activationConfirmedAt).toBeNull();
      });

      it('refuses to confirm an SOS that was already cancelled', async () => {
        const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);
        await safety.cancelSos(sosId, riderUserId);

        await expectReject(safety.confirmSos(sosId, riderUserId), BadRequestException);
      });

      it('refuses to cancel an SOS after it was confirmed and the countdown expired', async () => {
        const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);
        await safety.confirmSos(sosId, riderUserId); // deletes the countdown key

        const error = await expectReject(safety.cancelSos(sosId, riderUserId), BadRequestException);
        expect(error.message).toContain('already confirmed');
      });
    });
  });

  // ── 3. Panic workflow ────────────────────────────────────────────────────

  describe('panic workflow', () => {
    beforeEach(() => resetSession());

    it('persists the panic event and moves the session to panic_active', async () => {
      const result = await safety.triggerPanic(tripId, riderUserId, 'rider', 40.73, -74.17);
      expect(result.triggered).toBe(true);

      const panic = await prisma.panicEvent.findFirst({ where: { tripId } });
      expect(panic).toBeTruthy();
      expect(panic?.initiatedByRole).toBe('rider');

      const session = await prisma.safetySession.findUnique({ where: { id: sessionId } });
      expect(session?.currentState).toBe('panic_active');
    });

    it('publishes the panic with the trip context admin needs', async () => {
      await safety.triggerPanic(tripId, riderUserId, 'rider', 40.73, -74.17);
      const panic = await prisma.panicEvent.findFirst({ where: { tripId } });

      const payload = await waitForPublished('safety:panic', (p) => p.tripId === tripId);
      expect(payload).toMatchObject({
        event: 'safety:panic_new',
        panicId: panic!.id,
        tripId,
        initiatedByRole: 'rider',
      });
    });

    it('NEVER exposes rider identity in the panic payload', async () => {
      await safety.triggerPanic(tripId, riderUserId, 'rider', 40.73, -74.17);

      const raw = await waitFor(
        () => (received['safety:panic'] ?? []).find((m) => JSON.parse(m).tripId === tripId),
        'the panic payload',
      );
      const payload = JSON.parse(raw) as Record<string, unknown>;

      // Field-level: no rider identity keys of any kind.
      const forbiddenKeys = [
        'riderId', 'riderName', 'riderPhone', 'riderEmail',
        'rider', 'userId', 'initiatedByUserId', 'firstName', 'lastName', 'phone', 'name', 'email',
      ];
      for (const key of forbiddenKeys) {
        expect(Object.keys(payload)).not.toContain(key);
      }
      expect(Object.keys(payload).sort()).toEqual(
        ['event', 'initiatedByRole', 'panicId', 'tripId'].sort(),
      );

      // Sanity: prove the containment check is meaningful on this payload
      // before trusting the negative assertions below it.
      expect(raw).toContain(tripId);

      // Value-level: the rider's actual identifiers must not appear anywhere in
      // the serialized payload, under any key name.
      for (const secret of [riderUserId, riderId, RIDER_PHONE, 'Safety', 'Rider']) {
        expect(secret.length).toBeGreaterThan(0); // no vacuous not.toContain
        expect(raw).not.toContain(secret);
      }
    });
  });

  // ── 4. Notification isolation ────────────────────────────────────────────

  describe('notification isolation', () => {
    beforeEach(() => resetSession());
    afterEach(() => cleanupRedis());

    it('confirms an SOS even though notification-service is unreachable', async () => {
      // NOTIFICATION_SERVICE_URL points at a closed port, and the rider has a
      // trusted contact, so the outbound call is genuinely attempted and fails.
      expect(await prisma.trustedContact.count({ where: { riderId } })).toBeGreaterThan(0);

      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);
      await expect(safety.confirmSos(sosId, riderUserId)).resolves.toMatchObject({
        confirmed: true,
      });

      // Persistence completed despite the failed notification.
      const sos = await prisma.sosEvent.findUnique({ where: { id: sosId } });
      expect(sos?.activationConfirmedAt).toBeInstanceOf(Date);
      expect(await prisma.safetyRecording.count({ where: { tripId } })).toBe(1);
      expect(await redis.exists(`sos:countdown:${sosId}`)).toBe(0);
    });

    it('persists a panic without any notification dependency', async () => {
      await expect(
        safety.triggerPanic(tripId, riderUserId, 'rider', 40.73, -74.17),
      ).resolves.toMatchObject({ triggered: true });

      expect(await prisma.panicEvent.count({ where: { tripId } })).toBe(1);
    });
  });

  // ── 5. Route anomaly workflow ────────────────────────────────────────────

  describe('route anomaly workflow', () => {
    const PICKUP = { lat: 40.7357, lng: -74.1724 };
    const DROPOFF = { lat: 40.6895, lng: -74.1745 };
    // ~9 miles east of the corridor — comfortably past the 0.5-mile threshold.
    const FAR_OFF_ROUTE = { lat: 40.7357, lng: -74.0 };

    beforeEach(async () => {
      await resetSession();
      await prisma.routeDeviationEvent.deleteMany({ where: { tripId } });
      await prisma.tripSafetyScore.deleteMany({ where: { tripId } });
      await prisma.safeCheckIn.deleteMany({ where: { tripId } });
      await redis.del(`trip:${tripId}:off_route_since`);
      await prisma.trip.update({
        where: { id: tripId },
        data: { routeDeviationCount: 0, startedAt: new Date(), estimatedDurationMin: 20 },
      });
    });

    afterEach(() => redis.del(`trip:${tripId}:off_route_since`));

    it('stores a deterministic fallback route when no Maps key is configured', async () => {
      await routes.fetchAndStoreRoute(tripId, PICKUP, DROPOFF);

      const route = await prisma.tripRoute.findUnique({ where: { tripId } });
      expect(route?.source).toBe('fallback');

      // The fallback is a straight line: exactly the two supplied points.
      const points = decodePolyline(route!.encodedPolyline);
      expect(points).toHaveLength(2);
      expect(points[0].lat).toBeCloseTo(PICKUP.lat, 4);
      expect(points[1].lng).toBeCloseTo(DROPOFF.lng, 4);

      // Deterministic: a second call produces an identical polyline.
      await routes.fetchAndStoreRoute(tripId, PICKUP, DROPOFF);
      const again = await prisma.tripRoute.findUnique({ where: { tripId } });
      expect(again?.encodedPolyline).toBe(route!.encodedPolyline);
    });

    it('persists a time-overrun deviation and publishes an anomaly', async () => {
      // Started 40 minutes ago against a 20-minute estimate → 20 min overrun.
      await prisma.trip.update({
        where: { id: tripId },
        data: { startedAt: new Date(Date.now() - 40 * 60_000), estimatedDurationMin: 20 },
      });

      await safety.checkRouteAnomaly(tripId, PICKUP.lat, PICKUP.lng);

      const event = await waitFor(
        () => prisma.routeDeviationEvent.findFirst({ where: { tripId, type: 'time_overrun' } }),
        'the time_overrun deviation row',
      );
      expect(event.riskLevel).toBe('low');
      expect(event.escalated).toBe(false);

      const trip = await prisma.trip.findUnique({ where: { id: tripId } });
      expect(trip?.routeDeviationCount).toBe(1);

      const payload = await waitForPublished(
        'safety:anomaly',
        (p) => p.tripId === tripId && p.type === 'time_overrun',
      );
      expect(payload.event).toBe('safety:anomaly');
    });

    it('starts the off-route timer with a 10-minute TTL on first deviation', async () => {
      await routes.fetchAndStoreRoute(tripId, PICKUP, DROPOFF);

      await safety.checkRouteAnomaly(tripId, FAR_OFF_ROUTE.lat, FAR_OFF_ROUTE.lng);

      const key = `trip:${tripId}:off_route_since`;
      const since = await redis.get(key);
      expect(since).toBeTruthy();
      expect(Number(since)).toBeLessThanOrEqual(Date.now());

      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(OFF_ROUTE_TTL - 30);
      expect(ttl).toBeLessThanOrEqual(OFF_ROUTE_TTL);

      // Not yet sustained, so no deviation is recorded.
      expect(await prisma.routeDeviationEvent.count({ where: { tripId, type: 'spatial' } })).toBe(0);
    });

    it('clears the off-route timer once the trip is back on route', async () => {
      await routes.fetchAndStoreRoute(tripId, PICKUP, DROPOFF);
      await safety.checkRouteAnomaly(tripId, FAR_OFF_ROUTE.lat, FAR_OFF_ROUTE.lng);
      expect(await redis.exists(`trip:${tripId}:off_route_since`)).toBe(1);

      await safety.checkRouteAnomaly(tripId, PICKUP.lat, PICKUP.lng);

      expect(await redis.exists(`trip:${tripId}:off_route_since`)).toBe(0);
    });

    it('records a spatial deviation once the trip has been off-route long enough', async () => {
      await routes.fetchAndStoreRoute(tripId, PICKUP, DROPOFF);

      const key = `trip:${tripId}:off_route_since`;
      // Backdate the timer past the 2-minute sustained threshold rather than
      // holding the test open for two minutes.
      await redis.set(key, String(Date.now() - 3 * 60_000), 'EX', OFF_ROUTE_TTL);

      await safety.checkRouteAnomaly(tripId, FAR_OFF_ROUTE.lat, FAR_OFF_ROUTE.lng);

      const event = await waitFor(
        () => prisma.routeDeviationEvent.findFirst({ where: { tripId, type: 'spatial' } }),
        'the spatial deviation row',
      );
      expect(Number(event.deviationMiles)).toBeGreaterThan(0.5);

      // Timer cleared so the same deviation does not fire repeatedly.
      expect(await redis.exists(key)).toBe(0);
    });

    it('escalates a high-risk deviation to an admin alert', async () => {
      await prisma.tripSafetyScore.create({
        data: { tripId, riskLevel: 'high', score: 90 },
      });
      await prisma.trip.update({
        where: { id: tripId },
        data: { startedAt: new Date(Date.now() - 40 * 60_000), estimatedDurationMin: 20 },
      });

      await safety.checkRouteAnomaly(tripId, PICKUP.lat, PICKUP.lng);

      const payload = await waitForPublished(
        'safety:anomaly',
        (p) => p.tripId === tripId && p.event === 'safety:high_risk_deviation',
      );
      expect(payload.riskLevel).toBe('high');

      const event = await waitFor(
        () => prisma.routeDeviationEvent.findFirst({ where: { tripId, escalated: true } }),
        'the escalated deviation row',
      );
      expect(event.escalationType).toBe('admin_alert');
    });
  });

  // ── 6. Recording lifecycle ───────────────────────────────────────────────

  describe('recording lifecycle', () => {
    beforeEach(() => resetSession());
    afterEach(async () => {
      await cleanupArtifacts();
      await cleanupRedis();
      configValues.AWS_ACCESS_KEY_ID = 'dev-placeholder';
      configValues.KMS_RECORDINGS_KEY_ID = 'dev-local-no-kms';
    });

    it('stores SOS audio on local disk without touching S3', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);
      await safety.confirmSos(sosId, riderUserId);

      const audio = Buffer.from('integration-test-audio').toString('base64');
      const result = await safety.storeRecordingAudio(sosId, riderUserId, audio, 12);

      expect(result.backend).toBe('local-dev');
      expect(result.stored).toBe(true);
      expect(s3Put).not.toHaveBeenCalled();

      // The file really exists under the approved dev artifact path.
      const dir = join(DEV_ARTIFACT_ROOT, sosId);
      const files = await fs.readdir(dir);
      expect(files).toHaveLength(1);
      const written = await fs.readFile(join(dir, files[0]));
      expect(written.toString()).toBe('integration-test-audio');

      const recording = await prisma.safetyRecording.findFirst({ where: { tripId } });
      expect(recording?.status).toBe('complete');
      expect(recording?.durationSeconds).toBe(12);
    });

    it('refuses to store audio for someone else’s SOS', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);
      await safety.confirmSos(sosId, riderUserId);

      const audio = Buffer.from('nope').toString('base64');
      await expectReject(
        safety.storeRecordingAudio(sosId, driverUserId, audio, 5),
        ForbiddenException,
      );

      const recording = await prisma.safetyRecording.findFirst({ where: { tripId } });
      expect(recording?.status).toBe('recording'); // untouched
    });

    it('fails closed when AWS is configured but the KMS key is not', async () => {
      const { sosId } = await safety.initiateSos(tripId, riderUserId, 'button_tap', 40.73, -74.17);
      await safety.confirmSos(sosId, riderUserId);

      // Real-looking AWS credentials with no dedicated recordings KMS key.
      configValues.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      configValues.KMS_RECORDINGS_KEY_ID = 'dev-local-no-kms';

      const audio = Buffer.from('should-never-be-stored').toString('base64');
      await expectReject(
        safety.storeRecordingAudio(sosId, riderUserId, audio, 5),
        InternalServerErrorException,
      );

      // Rejected before any S3 call, and nothing written to disk either.
      expect(s3Put).not.toHaveBeenCalled();
      await expect(fs.readdir(join(DEV_ARTIFACT_ROOT, sosId))).rejects.toThrow();

      const recording = await prisma.safetyRecording.findFirst({ where: { tripId } });
      expect(recording?.status).toBe('recording'); // never marked complete
    });
  });
});
