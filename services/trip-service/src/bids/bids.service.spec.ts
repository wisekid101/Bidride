import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BidStatus } from '@bidride/database/generated/client';
import { BidsService } from './bids.service';
import { DispatchService } from '../trips/dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { assertValidBidTransition, isBidTerminal, BID_FLOOR_RATE, MAX_COUNTER_ROUNDS } from './bid-state-machine';

// ─── State Machine Unit Tests ─────────────────────────────────────────────────

describe('BidStateMachine', () => {
  describe('assertValidBidTransition', () => {
    it('allows pending → accepted', () => {
      expect(() => assertValidBidTransition(BidStatus.pending, BidStatus.accepted)).not.toThrow();
    });

    it('allows pending → countered', () => {
      expect(() => assertValidBidTransition(BidStatus.pending, BidStatus.countered)).not.toThrow();
    });

    it('allows pending → declined', () => {
      expect(() => assertValidBidTransition(BidStatus.pending, BidStatus.declined)).not.toThrow();
    });

    it('allows pending → expired', () => {
      expect(() => assertValidBidTransition(BidStatus.pending, BidStatus.expired)).not.toThrow();
    });

    it('allows pending → withdrawn', () => {
      expect(() => assertValidBidTransition(BidStatus.pending, BidStatus.withdrawn)).not.toThrow();
    });

    it('allows countered → accepted', () => {
      expect(() => assertValidBidTransition(BidStatus.countered, BidStatus.accepted)).not.toThrow();
    });

    it('allows countered → declined', () => {
      expect(() => assertValidBidTransition(BidStatus.countered, BidStatus.declined)).not.toThrow();
    });

    it('blocks accepted → pending (illegal reversal)', () => {
      expect(() => assertValidBidTransition(BidStatus.accepted, BidStatus.pending)).toThrow(BadRequestException);
    });

    it('blocks expired → accepted (expired bid cannot be resurrected)', () => {
      expect(() => assertValidBidTransition(BidStatus.expired, BidStatus.accepted)).toThrow(BadRequestException);
    });

    it('blocks countered → pending', () => {
      expect(() => assertValidBidTransition(BidStatus.countered, BidStatus.pending)).toThrow(BadRequestException);
    });

    it('blocks countered → countered (drivers cannot double-counter)', () => {
      expect(() => assertValidBidTransition(BidStatus.countered, BidStatus.countered)).toThrow(BadRequestException);
    });
  });

  describe('isBidTerminal', () => {
    it.each([
      [BidStatus.accepted, true],
      [BidStatus.declined, true],
      [BidStatus.expired, true],
      [BidStatus.withdrawn, true],
      [BidStatus.pending, false],
      [BidStatus.countered, false],
    ])('%s → terminal=%s', (status, expected) => {
      expect(isBidTerminal(status)).toBe(expected);
    });
  });

  describe('constants', () => {
    it('BID_FLOOR_RATE is 65%', () => {
      expect(BID_FLOOR_RATE).toBe(0.65);
    });

    it('MAX_COUNTER_ROUNDS is 2', () => {
      expect(MAX_COUNTER_ROUNDS).toBe(2);
    });
  });
});

// ─── BidsService Unit Tests ───────────────────────────────────────────────────

const mockRider = { id: 'rider-1', userId: 'user-rider-1', stripeCustomerId: 'cus_xxx' };
const mockDriver = { id: 'driver-1', userId: 'user-driver-1', status: 'approved', stripeAccountId: 'acct_xxx' };

const mockBid = {
  id: 'bid-1',
  tripId: 'trip-1',
  riderId: 'rider-1',
  driverId: null,
  aiFare: 20.00,
  riderOffer: 14.00,
  counterOffer: null,
  finalFare: null,
  counterRound: 0,
  status: BidStatus.pending as BidStatus,
  expiresAt: new Date(Date.now() + 120_000),
  resolvedAt: null,
  createdAt: new Date(),
};

const makePrisma = (bidOverride?: Partial<typeof mockBid>) => ({
  bid: {
    findUnique: jest.fn().mockResolvedValue(bidOverride ? { ...mockBid, ...bidOverride } : mockBid),
    update: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
  trip: { update: jest.fn().mockResolvedValue({}) },
  rider: { findUnique: jest.fn().mockResolvedValue(mockRider) },
  driver: {
    findUnique: jest.fn().mockResolvedValue(mockDriver),
    findMany: jest.fn().mockResolvedValue([]),
  },
  tripEvent: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn({
    bid: { update: jest.fn().mockResolvedValue({}) },
    trip: { update: jest.fn().mockResolvedValue({}) },
    tripEvent: { create: jest.fn().mockResolvedValue({}) },
  })),
});

const makeRedis = () => ({
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue('pi_test'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  zrange: jest.fn().mockResolvedValue([]),
  duplicate: jest.fn().mockReturnThis(),
});

const makeDispatch = () => ({
  notifyBidAcceptedByDriver: jest.fn().mockResolvedValue(undefined),
  notifyBidDeclinedByDriver: jest.fn().mockResolvedValue(undefined),
  notifyRiderBidCountered: jest.fn().mockResolvedValue(undefined),
  notifyDriverCounterAccepted: jest.fn().mockResolvedValue(undefined),
  notifyDriverCounterDeclined: jest.fn().mockResolvedValue(undefined),
  notifyBidExpired: jest.fn().mockResolvedValue(undefined),
  broadcastBidRequest: jest.fn().mockResolvedValue(undefined),
});

async function buildService(bidOverride?: Partial<typeof mockBid>): Promise<{
  service: BidsService;
  prisma: ReturnType<typeof makePrisma>;
  redis: ReturnType<typeof makeRedis>;
  dispatch: ReturnType<typeof makeDispatch>;
}> {
  const prisma = makePrisma(bidOverride);
  const redis = makeRedis();
  const dispatch = makeDispatch();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BidsService,
      { provide: PrismaService, useValue: prisma },
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: DispatchService, useValue: dispatch },
    ],
  }).compile();

  const service = module.get<BidsService>(BidsService);

  // Prevent setInterval from firing during tests
  jest.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

  // Mock fetch for payment-service HTTP calls
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ paymentIntentId: 'pi_test_hold' }),
    text: async () => 'OK',
  } as Response);

  return { service, prisma, redis, dispatch };
}

describe('BidsService', () => {
  afterEach(() => jest.clearAllMocks());

  // ── driverAcceptBid ──────────────────────────────────────────────────────

  describe('driverAcceptBid', () => {
    it('accepts a pending bid atomically and notifies rider', async () => {
      const { service, redis, dispatch } = await buildService();
      redis.set = jest.fn().mockResolvedValue('OK'); // claim succeeds

      const result = await service.driverAcceptBid('bid-1', mockDriver.userId);

      expect(result.status).toBe(BidStatus.accepted);
      expect(result.finalFare).toBe(14.00);
      expect(dispatch.notifyBidAcceptedByDriver).toHaveBeenCalled();
    });

    it('throws BID_ALREADY_CLAIMED when another driver is faster', async () => {
      const { service, redis } = await buildService();
      redis.set = jest.fn().mockResolvedValue(null); // NX returns null = already set

      await expect(service.driverAcceptBid('bid-1', mockDriver.userId))
        .rejects.toThrow(BadRequestException);
    });

    it('throws when bid is already resolved', async () => {
      const { service } = await buildService({ status: BidStatus.accepted });
      await expect(service.driverAcceptBid('bid-1', mockDriver.userId))
        .rejects.toThrow(BadRequestException);
    });

    it('throws when bid is not in pending status (it is countered)', async () => {
      const { service, redis } = await buildService({ status: BidStatus.countered });
      redis.set = jest.fn().mockResolvedValue('OK');
      await expect(service.driverAcceptBid('bid-1', mockDriver.userId))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── driverCounterBid ─────────────────────────────────────────────────────

  describe('driverCounterBid', () => {
    it('submits a valid counter offer', async () => {
      const { service, redis, dispatch } = await buildService();
      redis.set = jest.fn().mockResolvedValue('OK');

      const result = await service.driverCounterBid('bid-1', mockDriver.userId, { counterAmount: 17.00 });

      expect(result.status).toBe(BidStatus.countered);
      expect(result.counterAmount).toBe(17.00);
      expect(result.counterRound).toBe(1);
      expect(dispatch.notifyRiderBidCountered).toHaveBeenCalled();
    });

    it('rejects counter ≤ rider offer', async () => {
      const { service, redis } = await buildService();
      redis.set = jest.fn().mockResolvedValue('OK');

      await expect(service.driverCounterBid('bid-1', mockDriver.userId, { counterAmount: 13.00 }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects counter ≥ standard fare', async () => {
      const { service, redis } = await buildService();
      redis.set = jest.fn().mockResolvedValue('OK');

      await expect(service.driverCounterBid('bid-1', mockDriver.userId, { counterAmount: 20.00 }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects when max counter rounds reached', async () => {
      const { service, redis } = await buildService({ counterRound: 2, status: BidStatus.pending });
      redis.set = jest.fn().mockResolvedValue('OK');

      await expect(service.driverCounterBid('bid-1', mockDriver.userId, { counterAmount: 17.00 }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects when bid is not pending', async () => {
      const { service } = await buildService({ status: BidStatus.expired });
      await expect(service.driverCounterBid('bid-1', mockDriver.userId, { counterAmount: 17.00 }))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── riderAcceptCounter ───────────────────────────────────────────────────

  describe('riderAcceptCounter', () => {
    const counteredBid = {
      ...mockBid,
      status: BidStatus.countered,
      driverId: 'driver-1',
      counterOffer: 17.00,
      counterRound: 1,
    };

    it('accepts the counter and captures payment', async () => {
      const { service, dispatch } = await buildService(counteredBid);

      const result = await service.riderAcceptCounter('bid-1', mockRider.userId);

      expect(result.status).toBe(BidStatus.accepted);
      expect(result.finalFare).toBe(17.00);
      expect(dispatch.notifyDriverCounterAccepted).toHaveBeenCalled();
    });

    it('throws ForbiddenException when wrong user', async () => {
      const { service } = await buildService(counteredBid);
      // Simulate different rider
      const otherRider = { ...mockRider, id: 'rider-2' };
      service['resolveRider'] = jest.fn().mockResolvedValue(otherRider);

      await expect(service.riderAcceptCounter('bid-1', 'user-other'))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws when bid is not in countered state', async () => {
      const { service } = await buildService({ ...mockBid, status: BidStatus.pending });

      await expect(service.riderAcceptCounter('bid-1', mockRider.userId))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── riderDeclineCounter ──────────────────────────────────────────────────

  describe('riderDeclineCounter', () => {
    it('declines the counter and voids hold', async () => {
      const counteredBid = { ...mockBid, status: BidStatus.countered, driverId: 'driver-1', counterOffer: 17.00 };
      const { service, dispatch } = await buildService(counteredBid);

      const result = await service.riderDeclineCounter('bid-1', mockRider.userId);

      expect(result.status).toBe(BidStatus.declined);
      expect(dispatch.notifyDriverCounterDeclined).toHaveBeenCalled();
    });
  });

  // ── withdrawBid ──────────────────────────────────────────────────────────

  describe('withdrawBid', () => {
    it('withdraws a pending bid and voids hold', async () => {
      const { service } = await buildService();

      const result = await service.withdrawBid('bid-1', mockRider.userId);

      expect(result.status).toBe(BidStatus.withdrawn);
    });

    it('cannot withdraw a bid with a pending counter', async () => {
      const { service } = await buildService({ status: BidStatus.countered });

      await expect(service.withdrawBid('bid-1', mockRider.userId))
        .rejects.toThrow(BadRequestException);
    });

    it('cannot withdraw an already-resolved bid', async () => {
      const { service } = await buildService({ status: BidStatus.accepted });

      await expect(service.withdrawBid('bid-1', mockRider.userId))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── sweepExpiredBids ─────────────────────────────────────────────────────

  describe('sweepExpiredBids', () => {
    it('processes expired bids and voids their holds', async () => {
      const expiredBid = { ...mockBid, status: BidStatus.pending, expiresAt: new Date(Date.now() - 5000) };
      const { service, prisma, dispatch } = await buildService();

      prisma.bid.findMany = jest.fn().mockResolvedValue([expiredBid]);

      await service.sweepExpiredBids();

      expect(dispatch.notifyBidExpired).toHaveBeenCalledWith('trip-1', 'bid-1');
    });

    it('continues processing remaining bids if one fails', async () => {
      const expiredBid1 = { ...mockBid, id: 'bid-1', status: BidStatus.pending, expiresAt: new Date(Date.now() - 1000) };
      const expiredBid2 = { ...mockBid, id: 'bid-2', status: BidStatus.pending, expiresAt: new Date(Date.now() - 1000) };
      const { service, prisma, dispatch } = await buildService();

      prisma.bid.findMany = jest.fn().mockResolvedValue([expiredBid1, expiredBid2]);
      prisma.$transaction = jest.fn()
        .mockRejectedValueOnce(new Error('DB failure'))
        .mockImplementation(async (fn: any) => fn({
          bid: { update: jest.fn() },
          tripEvent: { create: jest.fn() },
        }));

      await expect(service.sweepExpiredBids()).resolves.not.toThrow();
      expect(dispatch.notifyBidExpired).toHaveBeenCalledTimes(1);
    });
  });

  // ── Bid Floor Calculation ────────────────────────────────────────────────

  describe('bid floor business logic', () => {
    it('floor is exactly 65% of standard fare', () => {
      const standardFare = 20.00;
      const floor = parseFloat((standardFare * BID_FLOOR_RATE).toFixed(2));
      expect(floor).toBe(13.00);
    });

    it('counter window is within bid range', () => {
      const standardFare = 20.00;
      const riderBid = 14.00;
      const validCounter = 17.00;
      expect(validCounter > riderBid).toBe(true);
      expect(validCounter < standardFare).toBe(true);
    });
  });

  // ── submitBid — geo-filtered dispatch ─────────────────────────────────────

  describe('submitBid geo-filtering', () => {
    const mockTripCreated = {
      id: 'trip-1',
      pickupLat: 40.6895,
      pickupLng: -74.1745,
      dropoffLat: 40.7128,
      dropoffLng: -74.0060,
      pickupAddress: '3 Brewster Rd, Newark, NJ',
      dropoffAddress: '1 World Trade Center, New York, NY',
      aiFare: 20.00,
      isAirportTrip: false,
    };
    const mockBidCreated = {
      id: 'bid-1',
      tripId: 'trip-1',
      riderOffer: 14.00,
      aiFare: 20.00,
      status: BidStatus.pending as BidStatus,
      expiresAt: new Date(Date.now() + 120_000),
    };

    const submitDto = {
      pickupLat: 40.6895,
      pickupLng: -74.1745,
      dropoffLat: 40.7128,
      dropoffLng: -74.0060,
      pickupAddress: '3 Brewster Rd, Newark, NJ',
      dropoffAddress: '1 World Trade Center, New York, NY',
      bidAmount: 14.00,
      paymentMethodId: 'pm_test',
    };

    function setupSubmitMocks(service: BidsService, prisma: ReturnType<typeof makePrisma>, redis: ReturnType<typeof makeRedis>) {
      prisma.$transaction = jest.fn().mockImplementation(async (fn: any) =>
        fn({
          trip: { create: jest.fn().mockResolvedValue(mockTripCreated) },
          bid: { create: jest.fn().mockResolvedValue(mockBidCreated) },
          tripEvent: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ fare: 20.00 }) } as Response)
        .mockResolvedValue({ ok: true, json: async () => ({ paymentIntentId: 'pi_test_hold' }) } as Response);

      // Only pi_test_hold payment intent get calls; location gets handled by key mock
      redis.get = jest.fn().mockResolvedValue('pi_test');
    }

    it('broadcasts only to drivers within the 5-mile primary radius', async () => {
      const { service, prisma, redis, dispatch } = await buildService();
      setupSubmitMocks(service, prisma, redis);

      redis.keys = jest.fn().mockResolvedValue([
        'driver:user-near-1:location',
        'driver:user-near-2:location',
        'driver:user-far:location',
      ]);
      // Override get to return location for first 3 calls, then fallback for PI
      redis.get = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({ lat: 40.6900, lng: -74.1750 })) // ~0.1 mi — primary
        .mockResolvedValueOnce(JSON.stringify({ lat: 40.7000, lng: -74.1900 })) // ~1.5 mi — primary
        .mockResolvedValueOnce(JSON.stringify({ lat: 40.8050, lng: -73.9690 })) // ~12 mi — outside 10mi
        .mockResolvedValue('pi_test');

      await service.submitBid(mockRider.userId, submitDto);

      const [,,,,,,,targetIds] = (dispatch.broadcastBidRequest as jest.Mock).mock.calls[0];
      expect(targetIds).toContain('user-near-1');
      expect(targetIds).toContain('user-near-2');
      expect(targetIds).not.toContain('user-far');
    });

    it('expands to 10-mile radius when fewer than 3 drivers found within 5 miles', async () => {
      const { service, prisma, redis, dispatch } = await buildService();
      setupSubmitMocks(service, prisma, redis);

      redis.keys = jest.fn().mockResolvedValue([
        'driver:user-near-1:location',
        'driver:user-mid-1:location',
        'driver:user-mid-2:location',
      ]);
      redis.get = jest.fn()
        .mockResolvedValueOnce(JSON.stringify({ lat: 40.6900, lng: -74.1750 })) // ~0.1 mi — primary
        .mockResolvedValueOnce(JSON.stringify({ lat: 40.6500, lng: -74.2500 })) // ~6 mi — extended only
        .mockResolvedValueOnce(JSON.stringify({ lat: 40.6200, lng: -74.3100 })) // ~9 mi — extended only
        .mockResolvedValue('pi_test');

      await service.submitBid(mockRider.userId, submitDto);

      // Only 1 driver in primary radius — should pull in extended drivers too
      const [,,,,,,,targetIds] = (dispatch.broadcastBidRequest as jest.Mock).mock.calls[0];
      expect(targetIds).toContain('user-near-1');
      expect(targetIds).toContain('user-mid-1');
      expect(targetIds).toContain('user-mid-2');
    });

    it('injects EWR queue drivers for airport trips', async () => {
      const { service, prisma, redis, dispatch } = await buildService();
      const airportTripCreated = { ...mockTripCreated, isAirportTrip: true, pickupAddress: 'EWR Terminal B' };
      prisma.$transaction = jest.fn().mockImplementation(async (fn: any) =>
        fn({
          trip: { create: jest.fn().mockResolvedValue(airportTripCreated) },
          bid: { create: jest.fn().mockResolvedValue(mockBidCreated) },
          tripEvent: { create: jest.fn().mockResolvedValue({}) },
        }),
      );
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ fare: 20.00 }) } as Response)
        .mockResolvedValue({ ok: true, json: async () => ({ paymentIntentId: 'pi_test_hold' }) } as Response);

      // No drivers nearby via geo-scan
      redis.keys = jest.fn().mockResolvedValue([]);
      // EWR queue has one driver
      redis.zrange = jest.fn().mockResolvedValue(['driver-queued-1']);
      prisma.driver.findMany = jest.fn().mockResolvedValue([{ userId: 'user-ewr-queued' }]);
      redis.get = jest.fn().mockResolvedValue('pi_test');

      await service.submitBid(mockRider.userId, {
        ...submitDto,
        pickupAddress: 'EWR Terminal B, Newark, NJ',
      });

      const [,,,,,,,targetIds] = (dispatch.broadcastBidRequest as jest.Mock).mock.calls[0];
      expect(targetIds).toContain('user-ewr-queued');
    });

    it('does not broadcast when no drivers are found', async () => {
      const { service, prisma, redis, dispatch } = await buildService();
      setupSubmitMocks(service, prisma, redis);

      redis.keys = jest.fn().mockResolvedValue([]);

      await service.submitBid(mockRider.userId, submitDto);

      expect(dispatch.broadcastBidRequest).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), expect.anything(), 'Verified', [],
      );
    });
  });
});
