import { EarningsFloorService } from './earnings-floor.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  platformConfig: {
    findUnique: jest.fn(),
  },
  earningsFloorLog: {
    create: jest.fn(),
  },
} as unknown as PrismaService;

const service = new EarningsFloorService(mockPrisma);

const defaultFormula = { per_mile: 1.10, per_min: 0.22, base: 2.50 };

const makePrisma = (formula = defaultFormula) => {
  (mockPrisma.platformConfig.findUnique as jest.Mock).mockResolvedValue({
    key: 'earnings_floor_formula',
    value: formula,
  });
  (mockPrisma.earningsFloorLog.create as jest.Mock).mockResolvedValue({});
};

describe('EarningsFloorService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('floor calculation', () => {
    it('calculates correct floor for a standard trip', async () => {
      makePrisma();
      // 5 miles, 20 min: (5 × 1.10) + (20 × 0.22) + 2.50 = 5.50 + 4.40 + 2.50 = 12.40
      const result = await service.enforce(
        { id: 'trip-1', driverId: 'driver-1', actualDistanceMiles: 5 },
        12.00,  // earned
        20,     // duration
      );

      expect(result.floorAmount).toBeCloseTo(12.40);
      expect(result.earnedAmount).toBe(12.00);
      expect(result.supplement).toBeCloseTo(0.40);
      expect(result.floorMet).toBe(false);
      expect(result.totalDriverEarnings).toBeCloseTo(12.40);
    });

    it('returns no supplement when earned exceeds floor', async () => {
      makePrisma();
      const result = await service.enforce(
        { id: 'trip-2', driverId: 'driver-1', actualDistanceMiles: 5 },
        15.00,  // earned (above floor of 12.40)
        20,
      );

      expect(result.supplement).toBe(0);
      expect(result.floorMet).toBe(true);
      expect(result.totalDriverEarnings).toBe(15.00);
    });

    it('correctly calculates base-only floor for a 0-mile 0-min trip', async () => {
      makePrisma();
      const result = await service.enforce(
        { id: 'trip-3', driverId: 'driver-1', actualDistanceMiles: 0 },
        0.00,
        0,
      );

      expect(result.floorAmount).toBeCloseTo(2.50); // just the base
      expect(result.supplement).toBeCloseTo(2.50);
    });

    it('logs supplement to DB when triggered', async () => {
      makePrisma();
      await service.enforce(
        { id: 'trip-4', driverId: 'driver-1', actualDistanceMiles: 3 },
        5.00,
        10,
      );

      expect(mockPrisma.earningsFloorLog.create).toHaveBeenCalledTimes(1);
      const call = (mockPrisma.earningsFloorLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.tripId).toBe('trip-4');
      expect(call.data.driverId).toBe('driver-1');
      expect(call.data.supplementAmount).toBeGreaterThan(0);
    });

    it('does NOT log to DB when floor is met', async () => {
      makePrisma();
      await service.enforce(
        { id: 'trip-5', driverId: 'driver-1', actualDistanceMiles: 5 },
        20.00,  // well above floor
        20,
      );

      expect(mockPrisma.earningsFloorLog.create).not.toHaveBeenCalled();
    });

    it('uses custom formula from platform_config', async () => {
      makePrisma({ per_mile: 1.50, per_min: 0.30, base: 3.00 });
      // 4 miles, 10 min: (4 × 1.50) + (10 × 0.30) + 3.00 = 6.00 + 3.00 + 3.00 = 12.00
      const result = await service.enforce(
        { id: 'trip-6', driverId: 'driver-1', actualDistanceMiles: 4 },
        10.00,
        10,
      );

      expect(result.floorAmount).toBeCloseTo(12.00);
      expect(result.supplement).toBeCloseTo(2.00);
    });

    it('handles null driverId gracefully (does not log)', async () => {
      makePrisma();
      await expect(
        service.enforce({ id: 'trip-7', driverId: null, actualDistanceMiles: 3 }, 5.00, 10),
      ).resolves.not.toThrow();

      expect(mockPrisma.earningsFloorLog.create).not.toHaveBeenCalled();
    });
  });
});
