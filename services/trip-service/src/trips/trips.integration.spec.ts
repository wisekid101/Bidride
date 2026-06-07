/**
 * Integration tests for trip service — runs against real PostgreSQL + Redis.
 * Requires TEST_DATABASE_URL and TEST_REDIS_URL environment variables.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@bidride/database';
import { Redis } from 'ioredis';
import { TripsService } from './trips.service';
import { EarningsFloorService } from './earnings-floor.service';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1');

describe('TripsService (integration)', () => {
  let service: TripsService;
  let floorService: EarningsFloorService;
  let testRiderId: string;
  let testDriverId: string;
  let testTripId: string;

  beforeAll(async () => {
    // Create test user + rider
    const riderUser = await prisma.user.create({
      data: {
        phone: '+19995550001',
        role: 'rider',
        rider: {
          create: {
            stripeCustomerId: 'cus_test_integration',
          },
        },
      },
      include: { rider: true },
    });
    testRiderId = riderUser.rider!.id;

    // Create test user + driver
    const driverUser = await prisma.user.create({
      data: {
        phone: '+19995550002',
        role: 'driver',
        driver: {
          create: {
            status: 'approved',
            legalFirstName: 'Test',
            legalLastName: 'Driver',
            stripeAccountId: 'acct_test_integration',
          },
        },
      },
      include: { driver: true },
    });
    testDriverId = driverUser.driver!.id;

    const module: TestingModule = await Test.createTestingModule({
      providers: [TripsService, EarningsFloorService],
    }).compile();

    service = module.get(TripsService);
    floorService = module.get(EarningsFloorService);
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.trip.deleteMany({ where: { riderId: testRiderId } });
    await prisma.driver.deleteMany({ where: { id: testDriverId } });
    await prisma.rider.deleteMany({ where: { id: testRiderId } });
    await prisma.user.deleteMany({ where: { phone: { in: ['+19995550001', '+19995550002'] } } });
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('requestTrip', () => {
    it('creates a trip in searching status', async () => {
      const trip = await service.requestTrip(
        { id: 'user-rider-1' } as any,
        {
          pickupLat: 40.7580,
          pickupLng: -74.0060,
          dropoffLat: 40.7128,
          dropoffLng: -74.0060,
          pickupAddress: '30 Rockefeller Plaza, New York',
          dropoffAddress: '1 World Trade Center, New York',
          vehicleClass: 'standard',
          paymentMethodId: 'pm_test_card',
          riderId: testRiderId,
        },
      );

      testTripId = trip.id;
      expect(trip.status).toBe('searching');
      expect(trip.riderId).toBe(testRiderId);
      expect(trip.driverId).toBeNull();
    });
  });

  describe('acceptTrip — race condition prevention', () => {
    it('only one driver can claim a trip via Redis NX', async () => {
      // Set up lock as if first driver already claimed
      await redis.set(`trip:accept:lock:${testTripId}`, testDriverId, 'NX', 'EX', 30);

      await expect(
        service.acceptTrip(testTripId, 'driver-id-two'),
      ).rejects.toThrow('TRIP_ALREADY_CLAIMED');
    });

    it('first driver wins the race', async () => {
      // Create a fresh trip
      const trip = await prisma.trip.create({
        data: {
          riderId: testRiderId,
          status: 'searching',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7,
          pickupLng: -74.0,
          dropoffLat: 40.72,
          dropoffLng: -74.01,
          aiFare: 18.50,
          vehicleClass: 'standard',
        },
      });

      const accepted = await service.acceptTrip(trip.id, testDriverId);
      expect(accepted.driverId).toBe(testDriverId);
      expect(accepted.status).toBe('accepted');

      // Clean up
      await prisma.trip.delete({ where: { id: trip.id } });
    });
  });

  describe('endTrip — haversine check', () => {
    it('rejects end trip if driver is too far from dropoff', async () => {
      const trip = await prisma.trip.create({
        data: {
          riderId: testRiderId,
          driverId: testDriverId,
          status: 'in_progress',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7580,
          pickupLng: -74.0060,
          dropoffLat: 40.7128,
          dropoffLng: -74.0060,
          aiFare: 18.50,
          vehicleClass: 'standard',
          startedAt: new Date(Date.now() - 1800000),
        },
      });

      await expect(
        service.endTrip(trip.id, testDriverId, {
          currentLat: 40.8,  // ~6 miles away
          currentLng: -74.0,
        }),
      ).rejects.toThrow('TRIP_TOO_FAR_FROM_DROPOFF');

      await prisma.trip.delete({ where: { id: trip.id } });
    });
  });

  describe('markNoShow', () => {
    it('rejects no-show if driver has not waited 5 minutes', async () => {
      const trip = await prisma.trip.create({
        data: {
          riderId: testRiderId,
          driverId: testDriverId,
          status: 'driver_arrived',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7580,
          pickupLng: -74.0060,
          dropoffLat: 40.7128,
          dropoffLng: -74.0060,
          aiFare: 18.50,
          vehicleClass: 'standard',
          arrivedAt: new Date(),  // just arrived
        },
      });

      await expect(
        service.markNoShow(trip.id, testDriverId),
      ).rejects.toThrow('NO_SHOW_TOO_EARLY');

      await prisma.trip.delete({ where: { id: trip.id } });
    });

    it('allows no-show after 5 minutes', async () => {
      const trip = await prisma.trip.create({
        data: {
          riderId: testRiderId,
          driverId: testDriverId,
          status: 'driver_arrived',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7580,
          pickupLng: -74.0060,
          dropoffLat: 40.7128,
          dropoffLng: -74.0060,
          aiFare: 18.50,
          vehicleClass: 'standard',
          arrivedAt: new Date(Date.now() - 6 * 60 * 1000),  // 6 minutes ago
        },
      });

      const result = await service.markNoShow(trip.id, testDriverId);
      expect(result.status).toBe('no_show');

      await prisma.trip.delete({ where: { id: trip.id } });
    });
  });

  describe('earnings floor integration', () => {
    it('supplements driver earnings when fare is below floor', async () => {
      // Floor: (2 miles × $1.10) + (15 min × $0.22) + $2.50 = $7.00
      const supplementSpy = jest.spyOn(floorService, 'checkAndSupplement');

      const trip = await prisma.trip.create({
        data: {
          riderId: testRiderId,
          driverId: testDriverId,
          status: 'in_progress',
          pickupAddress: 'A',
          dropoffAddress: 'B',
          pickupLat: 40.7128,
          pickupLng: -74.0060,
          dropoffLat: 40.7300,   // ~1.2 miles
          dropoffLng: -74.0060,
          aiFare: 5.50,          // Below floor
          finalFare: 5.50,
          vehicleClass: 'standard',
          startedAt: new Date(Date.now() - 15 * 60 * 1000),
        },
      });

      // Simulate endTrip calling the floor service
      await floorService.checkAndSupplement(trip.id, testDriverId, 5.50 * 0.80, 1.2, 15);

      expect(supplementSpy).toHaveBeenCalled();

      const log = await prisma.earningsFloorLog.findFirst({
        where: { tripId: trip.id },
      });
      expect(log).not.toBeNull();
      expect(parseFloat(log!.supplement.toString())).toBeGreaterThan(0);

      await prisma.earningsFloorLog.deleteMany({ where: { tripId: trip.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
    });
  });
});
