import { BidOutcomeService } from './bid-outcome.service';

const mockPrisma = {
  aiInferenceLog: {
    findFirst: jest.fn(),
  },
  driverBidExposure: {
    count: jest.fn(),
  },
  bidOutcome: {
    create: jest.fn(),
  },
} as any;

const service = new BidOutcomeService(mockPrisma);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.aiInferenceLog.findFirst.mockResolvedValue(null);
  mockPrisma.bidOutcome.create.mockResolvedValue({});
});

describe('BidOutcomeService — driversViewed from driver_bid_exposures', () => {
  it('queries driver_bid_exposures count when bidId is provided', async () => {
    mockPrisma.driverBidExposure.count.mockResolvedValue(4);

    await service.recordOutcome({
      tripId: 'trip-1',
      bidId: 'bid-1',
      wasAccepted: true,
    });

    expect(mockPrisma.driverBidExposure.count).toHaveBeenCalledWith({
      where: { bidId: 'bid-1' },
    });
    expect(mockPrisma.bidOutcome.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driversViewed: 4 }),
      }),
    );
  });

  it('uses dto.driversViewed when no bidId is provided', async () => {
    await service.recordOutcome({
      tripId: 'trip-2',
      wasAccepted: false,
      driversViewed: 5,
    });

    expect(mockPrisma.driverBidExposure.count).not.toHaveBeenCalled();
    expect(mockPrisma.bidOutcome.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driversViewed: 5 }),
      }),
    );
  });

  it('computes driversIgnored as viewed minus declined minus countered minus accepted', async () => {
    mockPrisma.driverBidExposure.count.mockResolvedValue(6);

    await service.recordOutcome({
      tripId: 'trip-3',
      bidId: 'bid-3',
      wasAccepted: true,
      driversDeclined: 2,
      driversCountered: 1,
    });

    // driversIgnored = 6 - 2 - 1 - 1 (accepted) = 2
    expect(mockPrisma.bidOutcome.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          driversViewed: 6,
          driversIgnored: 2,
          driversDeclined: 2,
          driversCountered: 1,
        }),
      }),
    );
  });

  it('clamps driversIgnored to 0 when counts exceed viewed', async () => {
    mockPrisma.driverBidExposure.count.mockResolvedValue(1);

    await service.recordOutcome({
      tripId: 'trip-4',
      bidId: 'bid-4',
      wasAccepted: false,
      driversDeclined: 3,
    });

    expect(mockPrisma.bidOutcome.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driversIgnored: 0 }),
      }),
    );
  });
});
