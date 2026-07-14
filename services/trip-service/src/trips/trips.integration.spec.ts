/**
 * Integration tests for trip service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL environment variables.
 *
 * Scope: three DB/Redis-only scenarios that exercise real persistence without
 * any downstream service (no pricing / payment / ai / trust / safety HTTP):
 *   1. Earnings floor enforcement (EarningsFloorService.enforce)
 *   2. Redis NX race / acceptTrip concurrency guard
 *   3. markNoShow using a TripEvent('driver_arrived') timestamp
 *
 * The injected PrismaService reads DATABASE_URL, so we pin it to the test
 * database here to guarantee every connection targets TEST_DATABASE_URL only.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { TripsService } from './trips.service';
import { EarningsFloorService } from './earnings-floor.service';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// Test-owned client, explicitly pinned to the test database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
// Single Redis connection shared by the test and the DI container.
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379');

const RIDER_PHONE = '+19995550001';
const DRIVER_PHONE = '+19995550002';
const PHONES = [RIDER_PHONE, DRIVER_PHONE];

/** Delete all rows we could have created, in FK-safe order. Idempotent. */
async function cleanup() {
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
    await prisma.earningsFloorLog.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.tripEvent.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
  }
  if (driverIds.length) await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  if (riderIds.length) await prisma.rider.deleteMany({ where: { id: { in: riderIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
}

/** Assert a promise rejects with a BadRequestException carrying `{ code }`. */
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

describe('TripsService (integration)', () => {
  let moduleRef: TestingModule;
  let trips: TripsService;
  let floor: EarningsFloorService;
  let servicePrisma: PrismaService;

  let riderId: string; // Rider profile id
  let driverId: string; // Driver profile id
  let driverUserId: string; // Driver's User id (what the service APIs expect)

  beforeAll(async () => {
    await cleanup(); // clear any residue from a prior interrupted run

    const riderUser = await prisma.user.create({
      data: { phone: RIDER_PHONE, role: 'rider', rider: { create: {} } },
      include: { rider: true },
    });
    riderId = riderUser.rider!.id;

    const driverUser = await prisma.user.create({
      data: {
        phone: DRIVER_PHONE,
        role: 'driver',
        driver: {
          create: {
            status: 'approved',
            legalFirstName: 'Test',
            legalLastName: 'Driver',
            dateOfBirth: new Date('1990-01-01'),
          },
        },
      },
      include: { driver: true },
    });
    driverUserId = driverUser.id;
    driverId = driverUser.driver!.id;

    // `.compile()` without `.init()` wires DI but does NOT fire onModuleInit,
    // so the dispatch-sweep timer never starts and no background HTTP fires.
    moduleRef = await Test.createTestingModule({
      providers: [
        TripsService,
        EarningsFloorService,
        DispatchService,
        PrismaService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    trips = moduleRef.get(TripsService);
    floor = moduleRef.get(EarningsFloorService);
    servicePrisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await cleanup();
    await servicePrisma?.$disconnect();
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('earnings floor enforcement', () => {
    it('writes a supplement log when driver earnings are below the floor', async () => {
      const trip = await prisma.trip.create({
        data: {
          riderId,
          driverId,
          status: 'in_progress',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7128,
          pickupLng: -74.006,
          dropoffLat: 40.73,
          dropoffLng: -74.006,
          aiFare: 5.5,
          actualDistanceMiles: 1.2,
        },
      });

      // Floor (default formula) = 1.2*1.10 + 15*0.22 + 2.50 = 7.12; earnings 1.00 → supplement 6.12.
      const result = await floor.enforce(
        { id: trip.id, driverId, actualDistanceMiles: 1.2 },
        1.0,
        15,
      );

      expect(result.floorMet).toBe(false);
      expect(result.supplement).toBeGreaterThan(0);

      const log = await prisma.earningsFloorLog.findUnique({ where: { tripId: trip.id } });
      expect(log).not.toBeNull();
      expect(Number(log!.supplementAmount)).toBeGreaterThan(0);
      expect(Number(log!.supplementAmount)).toBeCloseTo(result.supplement, 2);
    });
  });

  describe('acceptTrip — Redis NX concurrency guard', () => {
    it('rejects a second driver when the trip is already claimed', async () => {
      const trip = await prisma.trip.create({
        data: {
          riderId,
          status: 'searching',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7,
          pickupLng: -74.0,
          dropoffLat: 40.72,
          dropoffLng: -74.01,
          aiFare: 18.5,
        },
      });

      // Simulate a first driver having already claimed the trip via the NX lock.
      const lockKey = `trip:${trip.id}:claimed`;
      await redis.set(lockKey, 'first-driver', 'EX', 30, 'NX');

      await expectRejectCode(trips.acceptTrip(trip.id, driverUserId), 'TRIP_ALREADY_CLAIMED');

      await redis.del(lockKey);
    });
  });

  describe('markNoShow — TripEvent arrival timing', () => {
    async function seedArrivedTrip(arrivedAt: Date): Promise<string> {
      const trip = await prisma.trip.create({
        data: {
          riderId,
          driverId,
          status: 'driver_arrived',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.758,
          pickupLng: -74.006,
          dropoffLat: 40.7128,
          dropoffLng: -74.006,
          aiFare: 18.5,
        },
      });
      await prisma.tripEvent.create({
        data: { tripId: trip.id, eventType: 'driver_arrived', createdAt: arrivedAt },
      });
      return trip.id;
    }

    it('rejects no-show before the 5-minute wait has elapsed', async () => {
      const tripId = await seedArrivedTrip(new Date()); // just arrived
      await expectRejectCode(trips.markNoShow(tripId, driverUserId), 'NO_SHOW_TOO_EARLY');
    });

    it('allows no-show after the 5-minute wait has elapsed', async () => {
      const tripId = await seedArrivedTrip(new Date(Date.now() - 6 * 60 * 1000)); // 6 min ago
      const result = await trips.markNoShow(tripId, driverUserId);
      expect(result.status).toBe('no_show');
    });
  });
});
