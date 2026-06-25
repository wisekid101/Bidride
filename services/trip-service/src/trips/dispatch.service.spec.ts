import { DispatchService } from './dispatch.service';

const mockRedis = {
  publish: jest.fn().mockResolvedValue(1),
} as any;

const mockPrisma = {
  driverBidExposure: {
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
  },
} as any;

const service = new DispatchService(mockRedis, mockPrisma);

beforeEach(() => jest.clearAllMocks());

const baseTripArg = {
  id: 'trip-1',
  pickupLat: 40.7,
  pickupLng: -74.1,
  dropoffLat: 40.71,
  dropoffLng: -74.11,
  pickupAddress: '123 Main St',
  dropoffAddress: '456 Elm St',
  isAirportTrip: false,
};

const baseBidArg = { id: 'bid-1', riderOffer: 18 };

describe('DispatchService — broadcastBidRequest', () => {
  it('publishes bid:incoming to each target driver individually', async () => {
    await service.broadcastBidRequest(
      baseTripArg, baseBidArg, 20, 12, 3.5, 15, 'Verified', ['u-driver-1', 'u-driver-2'],
    );

    expect(mockRedis.publish).toHaveBeenCalledTimes(2);
    expect(mockRedis.publish).toHaveBeenCalledWith('user:u-driver-1:events', expect.stringContaining('"event":"bid:incoming"'));
    expect(mockRedis.publish).toHaveBeenCalledWith('user:u-driver-2:events', expect.stringContaining('"event":"bid:incoming"'));
  });

  it('logs a DriverBidExposure row for each driver that received the bid', async () => {
    await service.broadcastBidRequest(
      baseTripArg, baseBidArg, 20, 12, 3.5, 15, 'Verified', ['u-driver-1', 'u-driver-2'],
    );

    // Allow fire-and-forget to settle
    await new Promise(setImmediate);

    expect(mockPrisma.driverBidExposure.createMany).toHaveBeenCalledWith({
      data: [
        { bidId: 'bid-1', tripId: 'trip-1', driverUserId: 'u-driver-1' },
        { bidId: 'bid-1', tripId: 'trip-1', driverUserId: 'u-driver-2' },
      ],
    });
  });

  it('skips exposure logging when no drivers are targeted', async () => {
    await service.broadcastBidRequest(
      baseTripArg, baseBidArg, 20, 12, 3.5, 15, 'Verified', [],
    );

    await new Promise(setImmediate);

    expect(mockPrisma.driverBidExposure.createMany).not.toHaveBeenCalled();
  });
});
