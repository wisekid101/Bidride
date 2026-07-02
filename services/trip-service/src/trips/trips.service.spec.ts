import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TripStatus } from '@bidride/database/generated/client';
import { TripsService } from './trips.service';
import { DispatchService } from './dispatch.service';
import { EarningsFloorService } from './earnings-floor.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrip(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'trip-1',
    riderId: 'rider-1',
    driverId: 'driver-1',
    status: TripStatus.completed,
    aiFare: 20,
    startedAt: new Date(Date.now() - 30 * 60000),
    pickupLat: 40.7, pickupLng: -74.1,
    dropoffLat: 40.71, dropoffLng: -74.11,
    riderRatingDriver: null,
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  rider: { findUnique: jest.fn() },
  driver: { findUnique: jest.fn(), update: jest.fn() },
  trustScore: { findUnique: jest.fn() },
  fraudAlert: { findFirst: jest.fn() },
  rating: { upsert: jest.fn().mockResolvedValue({}) },
  trip: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
  },
};

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  get: jest.fn(),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
};

const mockDispatch = {
  notifyRiderDriverAssigned: jest.fn().mockResolvedValue(undefined),
  notifyTripCompleted: jest.fn().mockResolvedValue(undefined),
  broadcastRequest: jest.fn().mockResolvedValue(undefined),
  notifyDriverRatingReceived: jest.fn().mockResolvedValue(undefined),
};

const mockFloor = {
  enforce: jest.fn().mockResolvedValue({
    floorMet: true,
    floorAmount: 0,
    earnedAmount: 16,
    supplement: 0,
    totalDriverEarnings: 16,
  }),
};

async function buildService(): Promise<TripsService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TripsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: DispatchService, useValue: mockDispatch },
      { provide: EarningsFloorService, useValue: mockFloor },
      { provide: REDIS_CLIENT, useValue: mockRedis },
    ],
  }).compile();
  return module.get(TripsService);
}

beforeEach(() => jest.clearAllMocks());

// ─── rateDriver ───────────────────────────────────────────────────────────────

describe('TripsService — rateDriver', () => {
  it('writes rating to trip row', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip());
    mockPrisma.trip.update.mockResolvedValue(makeTrip({ riderRatingDriver: 5 }));
    mockPrisma.trip.aggregate.mockResolvedValue({ _avg: { riderRatingDriver: 5 } });
    mockPrisma.driver.update.mockResolvedValue({});

    await service.rateDriver('trip-1', 'user-1', { rating: 5 });

    expect(mockPrisma.trip.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { riderRatingDriver: 5 } }),
    );
  });

  it('recalculates driver avgRating after rating is saved', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip());
    mockPrisma.trip.update.mockResolvedValue(makeTrip({ riderRatingDriver: 4 }));
    mockPrisma.trip.aggregate.mockResolvedValue({ _avg: { riderRatingDriver: 4.25 } });
    mockPrisma.driver.update.mockResolvedValue({});

    await service.rateDriver('trip-1', 'user-1', { rating: 4 });

    expect(mockPrisma.trip.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { driverId: 'driver-1', riderRatingDriver: { not: null } },
        _avg: { riderRatingDriver: true },
      }),
    );
    expect(mockPrisma.driver.update).toHaveBeenCalledWith({
      where: { id: 'driver-1' },
      data: { avgRating: 4.25 },
    });
  });

  it('skips avgRating update when aggregate returns null (no prior ratings)', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip());
    mockPrisma.trip.update.mockResolvedValue(makeTrip({ riderRatingDriver: 3 }));
    mockPrisma.trip.aggregate.mockResolvedValue({ _avg: { riderRatingDriver: null } });

    await service.rateDriver('trip-1', 'user-1', { rating: 3 });

    expect(mockPrisma.driver.update).not.toHaveBeenCalled();
  });

  it('skips avgRating update when trip has no driverId', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ driverId: null }));
    mockPrisma.trip.update.mockResolvedValue(makeTrip({ driverId: null, riderRatingDriver: 5 }));
    mockPrisma.trip.aggregate.mockResolvedValue({ _avg: { riderRatingDriver: 5 } });

    await service.rateDriver('trip-1', 'user-1', { rating: 5 });

    expect(mockPrisma.driver.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when trip not found', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(null);

    await expect(service.rateDriver('trip-x', 'user-1', { rating: 5 }))
      .rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when trip already rated', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ riderRatingDriver: 4 }));

    await expect(service.rateDriver('trip-1', 'user-1', { rating: 5 }))
      .rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when trip is not completed', async () => {
    const service = await buildService();
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ status: TripStatus.in_progress }));

    await expect(service.rateDriver('trip-1', 'user-1', { rating: 5 }))
      .rejects.toThrow(BadRequestException);
  });
});

// ─── rateRider ───────────────────────────────────────────────────────────────

describe('TripsService — rateRider', () => {
  function makeDriverTrip(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'trip-1',
      riderId: 'rider-1',
      driverId: 'driver-1',
      status: TripStatus.completed,
      driverRatingRider: null,
      ...overrides,
    };
  }

  it('writes driverRatingRider to trip row and upserts Rating', async () => {
    const service = await buildService();
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeDriverTrip());
    mockPrisma.trip.update.mockResolvedValue(makeDriverTrip({ driverRatingRider: 4 }));

    await service.rateRider('trip-1', 'user-driver-1', { rating: 4 });

    expect(mockPrisma.trip.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { driverRatingRider: 4 } }),
    );
    expect(mockPrisma.rating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tripId: 'trip-1' },
        create: expect.objectContaining({ driverToRider: 4, riderFlagged: false }),
        update: expect.objectContaining({ driverToRider: 4, riderFlagged: false }),
      }),
    );
  });

  it('sets riderFlagged true when flagRider is passed', async () => {
    const service = await buildService();
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeDriverTrip());
    mockPrisma.trip.update.mockResolvedValue(makeDriverTrip({ driverRatingRider: 2 }));

    await service.rateRider('trip-1', 'user-driver-1', { rating: 2, flagRider: true });

    expect(mockPrisma.rating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ riderFlagged: true }),
        update: expect.objectContaining({ riderFlagged: true }),
      }),
    );
  });

  it('throws BadRequestException when rider already rated', async () => {
    const service = await buildService();
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeDriverTrip({ driverRatingRider: 3 }));

    await expect(service.rateRider('trip-1', 'user-driver-1', { rating: 5 }))
      .rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when trip is not completed', async () => {
    const service = await buildService();
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1' });
    mockPrisma.trip.findUnique.mockResolvedValue(makeDriverTrip({ status: TripStatus.in_progress }));

    await expect(service.rateRider('trip-1', 'user-driver-1', { rating: 5 }))
      .rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when trip not found or not this driver\'s', async () => {
    const service = await buildService();
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-2' }); // different driver
    mockPrisma.trip.findUnique.mockResolvedValue(makeDriverTrip()); // belongs to driver-1

    await expect(service.rateRider('trip-1', 'user-driver-2', { rating: 5 }))
      .rejects.toThrow(NotFoundException);
  });
});

// ─── acceptTrip ──────────────────────────────────────────────────────────────

describe('TripsService — acceptTrip', () => {
  it('notifies rider with driver name and vehicle info', async () => {
    const service = await buildService();
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ status: TripStatus.searching, driverId: null }));
    mockPrisma.driver.findUnique
      .mockResolvedValueOnce({ id: 'driver-1', status: 'approved', currentBadge: 'Trusted' })
      .mockResolvedValueOnce({
        id: 'driver-1',
        currentBadge: 'Trusted',
        vehicles: [{ make: 'Toyota', model: 'Camry', color: 'White', licensePlate: 'NJA123' }],
        user: { firstName: 'Marcus', lastName: 'Williams' },
      });
    mockRedis.set.mockResolvedValue('OK');
    mockPrisma.trip.update.mockResolvedValue(makeTrip({ status: TripStatus.accepted }));

    await service.acceptTrip('trip-1', 'user-1');

    expect(mockDispatch.notifyRiderDriverAssigned).toHaveBeenCalledWith(
      'trip-1',
      'driver-1',
      expect.objectContaining({
        name: 'Marcus Williams',
        badge: 'Trusted',
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        vehicleColor: 'White',
        licensePlate: 'NJA123',
      }),
    );
  });

  it('throws when trip already claimed (NX returns null)', async () => {
    const service = await buildService();
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ status: TripStatus.searching, driverId: null }));
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1', status: 'approved', currentBadge: 'Verified' });
    mockRedis.set.mockResolvedValue(null); // NX failed — already claimed

    await expect(service.acceptTrip('trip-1', 'user-1'))
      .rejects.toThrow(BadRequestException);
  });
});

// ─── createTrip — trust score wiring ─────────────────────────────────────────

describe('TripsService — createTrip trust score', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ fare: 18 }),
    });
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1', totalTrips: 10 });
    mockPrisma.trip.create.mockResolvedValue(makeTrip({ status: TripStatus.searching }));
    mockRedis.setex.mockResolvedValue('OK');
  });

  it('passes real trust score to pricing-service when one exists', async () => {
    const service = await buildService();
    mockPrisma.trustScore.findUnique.mockResolvedValue({ trustScore: 780 });

    await service.createTrip('user-1', {
      pickupAddress: 'A', pickupLat: 40.7, pickupLng: -74.1,
      dropoffAddress: 'B', dropoffLat: 40.71, dropoffLng: -74.11,
      rideType: 'standard' as any,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.riderTrustScore).toBe(780);
    expect(body.riderTotalTrips).toBe(10);
  });

  it('defaults trust score to 500 when rider has no trust record yet', async () => {
    const service = await buildService();
    mockPrisma.trustScore.findUnique.mockResolvedValue(null);

    await service.createTrip('user-1', {
      pickupAddress: 'A', pickupLat: 40.7, pickupLng: -74.1,
      dropoffAddress: 'B', dropoffLat: 40.71, dropoffLng: -74.11,
      rideType: 'standard' as any,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.riderTrustScore).toBe(500);
  });
});

// ─── createTrip — surge:requests counter ─────────────────────────────────────

describe('TripsService — createTrip surge counter', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ fare: 18 }) });
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1', totalTrips: 5 });
    mockPrisma.trustScore.findUnique.mockResolvedValue({ trustScore: 600 });
    mockPrisma.fraudAlert.findFirst.mockResolvedValue(null);
    mockPrisma.trip.create.mockResolvedValue(makeTrip({ status: TripStatus.searching }));
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
  });

  it('increments surge:requests:{zone} after trip creation', async () => {
    const service = await buildService();

    await service.createTrip('user-1', {
      pickupAddress: 'A', pickupLat: 40.7, pickupLng: -74.1,
      dropoffAddress: 'B', dropoffLat: 40.71, dropoffLng: -74.11,
      rideType: 'standard' as any,
    });

    // Allow fire-and-forget to settle
    await new Promise(setImmediate);

    const expectedZone = `${Math.floor(40.7 / 0.018)}:${Math.floor(-74.1 / 0.022)}`;
    expect(mockRedis.incr).toHaveBeenCalledWith(`surge:requests:${expectedZone}`);
    expect(mockRedis.expire).toHaveBeenCalledWith(`surge:requests:${expectedZone}`, 600);
  });
});

// ─── endTrip — trust refresh scheduling ──────────────────────────────────────

describe('TripsService — endTrip schedules trust refresh', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('schedules trust refresh for both rider and driver after trip ends', async () => {
    const service = await buildService();
    const inProgressTrip = makeTrip({ status: TripStatus.in_progress, startedAt: new Date(Date.now() - 30 * 60000) });
    mockPrisma.trip.findUnique.mockResolvedValue(inProgressTrip);
    mockPrisma.trip.update.mockResolvedValue({ ...inProgressTrip, status: TripStatus.completed });
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1', userId: 'u-rider-1', totalTrips: 5 });
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1', userId: 'u-driver-1' });
    mockRedis.del.mockResolvedValue(1);
    mockFloor.enforce.mockResolvedValue({
      floorMet: true, floorAmount: 0, earnedAmount: 16, supplement: 0, totalDriverEarnings: 16,
    });

    await service.endTrip('trip-1', 'u-driver-1', { currentLat: 40.71, currentLng: -74.11 });

    // Allow the fire-and-forget promises to settle
    await new Promise(setImmediate);

    const trustCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && (url as string).includes('/internal/trust/recalculate'),
    );
    expect(trustCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Fraud hold enforcement ───────────────────────────────────────────────────

describe('TripsService — fraud hold: createTrip blocked', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ fare: 18 }) });
    mockPrisma.rider.findUnique.mockResolvedValue({ id: 'rider-1', totalTrips: 5 });
    mockPrisma.trustScore.findUnique.mockResolvedValue({ trustScore: 700 });
    mockPrisma.trip.create.mockResolvedValue(makeTrip({ status: TripStatus.searching }));
    mockRedis.setex.mockResolvedValue('OK');
  });

  const tripDto = {
    pickupAddress: 'A', pickupLat: 40.7, pickupLng: -74.1,
    dropoffAddress: 'B', dropoffLat: 40.71, dropoffLng: -74.11,
    rideType: 'standard' as any,
  };

  it('blocks a rider with a pending fraud hold from creating a trip', async () => {
    const service = await buildService();
    mockPrisma.fraudAlert.findFirst.mockResolvedValue({ id: 'alert-1' });

    await expect(service.createTrip('user-1', tripDto)).rejects.toThrow(ForbiddenException);
  });

  it('blocks a rider with an under_review fraud hold', async () => {
    const service = await buildService();
    mockPrisma.fraudAlert.findFirst.mockResolvedValue({ id: 'alert-2' });

    await expect(service.createTrip('user-1', tripDto)).rejects.toThrow(ForbiddenException);
  });

  it('blocks a rider with an escalated (hold still active) fraud alert', async () => {
    const service = await buildService();
    mockPrisma.fraudAlert.findFirst.mockResolvedValue({ id: 'alert-3' });

    await expect(service.createTrip('user-1', tripDto)).rejects.toThrow(ForbiddenException);
  });

  it('returns ACCOUNT_UNDER_REVIEW error code in the exception body', async () => {
    const service = await buildService();
    mockPrisma.fraudAlert.findFirst.mockResolvedValue({ id: 'alert-1' });

    await expect(service.createTrip('user-1', tripDto)).rejects.toMatchObject(
      expect.objectContaining({ response: expect.objectContaining({ code: 'ACCOUNT_UNDER_REVIEW' }) }),
    );
  });

  it('allows a rider whose fraud alert was cleared (holdReleasedAt set → findFirst returns null)', async () => {
    const service = await buildService();
    mockPrisma.fraudAlert.findFirst.mockResolvedValue(null);

    await expect(service.createTrip('user-1', tripDto)).resolves.toBeDefined();
  });

  it('allows a rider with no fraud alerts at all', async () => {
    const service = await buildService();
    mockPrisma.fraudAlert.findFirst.mockResolvedValue(null);

    await expect(service.createTrip('user-1', tripDto)).resolves.toBeDefined();
  });
});

describe('TripsService — fraud hold: acceptTrip blocked', () => {
  beforeEach(() => {
    mockRedis.set.mockResolvedValue('OK');
    mockPrisma.trip.update.mockResolvedValue(makeTrip({ status: TripStatus.accepted }));
    mockRedis.setex.mockResolvedValue('OK');
  });

  it('blocks a driver with an active fraud hold from accepting a trip', async () => {
    const service = await buildService();
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ status: TripStatus.searching, driverId: null }));
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1', status: 'approved', currentBadge: 'Verified' });
    mockPrisma.fraudAlert.findFirst.mockResolvedValue({ id: 'alert-1' });

    await expect(service.acceptTrip('trip-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('allows a driver with no active fraud hold to accept a trip', async () => {
    const service = await buildService();
    mockPrisma.trip.findUnique.mockResolvedValue(makeTrip({ status: TripStatus.searching, driverId: null }));
    mockPrisma.driver.findUnique
      .mockResolvedValueOnce({ id: 'driver-1', status: 'approved', currentBadge: 'Verified' })
      .mockResolvedValueOnce({
        id: 'driver-1',
        currentBadge: 'Verified',
        vehicles: [{ make: 'Toyota', model: 'Camry', color: 'White', licensePlate: 'NJA123' }],
        user: { firstName: 'Marcus', lastName: 'Williams' },
      });
    mockPrisma.fraudAlert.findFirst.mockResolvedValue(null);

    await expect(service.acceptTrip('trip-1', 'user-1')).resolves.toBeDefined();
  });
});
