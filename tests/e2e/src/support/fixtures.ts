/**
 * E2E fixtures: seeding, cleanup and token minting for cross-service scenarios.
 *
 * Cleanup order follows the real foreign-key graph. Two models carry NO foreign
 * key to Trip — FinancialLedger and WalletTransaction reference it as a plain
 * VarChar — so they must be removed explicitly by string match or they survive
 * the trip delete and poison the next run through
 * `@@unique([correlationId, accountId, direction])`.
 */
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { createHmac } from 'node:crypto';
import { E2E_FIXTURE_PHONES, E2E_FIXTURE_IDS } from '../../../../scripts/test/fixture-identifiers';
import { E2E_JWT_SECRET } from './services';

export const RIDER_PHONE = E2E_FIXTURE_PHONES.standardRide.rider;
export const DRIVER_PHONE = E2E_FIXTURE_PHONES.standardRide.driver;
export const PHONES = [RIDER_PHONE, DRIVER_PHONE];

/** Vendor-shaped but unmistakably ours, so cleanup can scope by prefix. */
export const STRIPE_CUSTOMER = `${E2E_FIXTURE_IDS.stripePrefix}_cus_standard_ride`;
export const STRIPE_PM = `${E2E_FIXTURE_IDS.stripePrefix}_pm_standard_ride`;
export const CORRELATION_PREFIX = E2E_FIXTURE_IDS.correlationPrefix;

export interface Fixture {
  riderUserId: string;
  riderId: string;
  driverUserId: string;
  driverId: string;
}

/** Mint an HS256 token matching the contract every service guard enforces. */
export function mintToken(sub: string, role: 'rider' | 'driver'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    role,
    jti: `${CORRELATION_PREFIX}-${sub}`,
    iss: 'bidride-auth',
    aud: 'bidride-user',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', E2E_JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/**
 * Remove every row this suite can create, children first.
 * Safe to call before seeding and after teardown.
 */
export async function cleanupDb(prisma: PrismaClient): Promise<void> {
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

  // No FK to Trip — must be matched on the string columns, and before the
  // trip rows disappear and take the ids with them.
  if (tripIds.length) {
    await prisma.financialLedger.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.walletTransaction.deleteMany({ where: { tripId: { in: tripIds } } });
  }
  for (const accountId of [...riderIds, ...driverIds]) {
    await prisma.financialLedger.deleteMany({ where: { accountId } });
  }

  if (driverIds.length) {
    const wallets = await prisma.driverWallet.findMany({
      where: { driverId: { in: driverIds } },
      select: { id: true },
    });
    if (wallets.length) {
      await prisma.walletTransaction.deleteMany({
        where: { walletId: { in: wallets.map((w) => w.id) } },
      });
    }
    await prisma.driverWallet.deleteMany({ where: { driverId: { in: driverIds } } });
  }

  if (tripIds.length) {
    await prisma.earningsFloorLog.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.rating.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.payment.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.tripEvent.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.bid.deleteMany({ where: { tripId: { in: tripIds } } });

    // createTrip nests a SafetySession; it and its children block the trip delete.
    const sessions = await prisma.safetySession.findMany({
      where: { tripId: { in: tripIds } },
      select: { id: true },
    });
    if (sessions.length) {
      const sessionIds = sessions.map((s) => s.id);
      await prisma.sosEvent.deleteMany({ where: { safetySessionId: { in: sessionIds } } });
      await prisma.panicEvent.deleteMany({ where: { safetySessionId: { in: sessionIds } } });
      await prisma.safetyRecording.deleteMany({ where: { safetySessionId: { in: sessionIds } } });
      await prisma.safeCheckIn.deleteMany({ where: { safetySessionId: { in: sessionIds } } });
      await prisma.safetySession.deleteMany({ where: { id: { in: sessionIds } } });
    }
    await prisma.tripRoute.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.chatMessage.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
  }

  if (driverIds.length) await prisma.vehicle.deleteMany({ where: { driverId: { in: driverIds } } });
  if (driverIds.length) await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  if (riderIds.length) await prisma.rider.deleteMany({ where: { id: { in: riderIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

  // These two are keyed by the stub's Stripe-shaped ids, carry unique
  // constraints, and have no FK back to the trip — an interrupted run leaves
  // them orphaned and the next run collides on the unique index.
  await prisma.payment.deleteMany({
    where: { stripePaymentIntentId: { startsWith: E2E_FIXTURE_IDS.stripePrefix } },
  });
  await prisma.paymentReconciliation.deleteMany({
    where: { stripeObjectId: { startsWith: E2E_FIXTURE_IDS.stripePrefix } },
  });
}

/** Seed a rider with a payment method on file, and an approved driver. */
export async function seed(prisma: PrismaClient): Promise<Fixture> {
  const riderUser = await prisma.user.create({
    data: {
      phone: RIDER_PHONE,
      role: 'rider',
      firstName: 'E2E',
      lastName: 'Rider',
      rider: {
        // chargeTripByDefault requires BOTH of these or it returns
        // NO_PAYMENT_METHOD before Stripe is ever reached.
        create: { stripeCustomerId: STRIPE_CUSTOMER, defaultPaymentMethodId: STRIPE_PM },
      },
    },
    include: { rider: true },
  });

  const driverUser = await prisma.user.create({
    data: {
      phone: DRIVER_PHONE,
      role: 'driver',
      driver: {
        create: {
          status: 'approved', // acceptTrip refuses any other status
          legalFirstName: 'E2E',
          legalLastName: 'Driver',
          dateOfBirth: new Date('1990-01-01'),
        },
      },
    },
    include: { driver: true },
  });

  return {
    riderUserId: riderUser.id,
    riderId: riderUser.rider!.id,
    driverUserId: driverUser.id,
    driverId: driverUser.driver!.id,
  };
}

/** Redis keys the standard ride path creates, scoped to one trip. */
export function tripRedisKeys(tripId: string): string[] {
  return [`trip:${tripId}:state`, `trip:${tripId}:claimed`, `trip:${tripId}:dispatch`];
}

/** trip-service's 2km demand grid key, mirrored from trips.service.ts. */
export function surgeZoneKey(lat: number, lng: number): string {
  return `surge:requests:${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

/**
 * The surge counter is SHARED state: trip-service increments it on every
 * creation, and pricing-service and ai-service read it. Leaving our increment
 * behind changes the next run's quote (observed: a later run saw a non-zero
 * surge component). Snapshot it and restore the exact prior value and TTL.
 */
export async function snapshotKey(redis: Redis, key: string) {
  return { key, value: await redis.get(key), ttl: await redis.ttl(key) };
}

export async function restoreKey(
  redis: Redis,
  snap: { key: string; value: string | null; ttl: number },
): Promise<void> {
  if (snap.value === null) {
    await redis.del(snap.key);
  } else if (snap.ttl > 0) {
    await redis.setex(snap.key, snap.ttl, snap.value);
  } else {
    await redis.set(snap.key, snap.value);
  }
}

export async function cleanupRedis(redis: Redis, tripIds: string[]): Promise<void> {
  const keys = tripIds.flatMap(tripRedisKeys);
  if (keys.length) await redis.del(...keys);
}
