import { EarningsService } from './earnings.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  driver: { findUnique: jest.fn() },
  trip: { findMany: jest.fn(), count: jest.fn() },
  driverWallet: { findUnique: jest.fn() },
};

jest.mock('@bidride/database', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

const DRIVER = { id: 'driver-1' };
const WALLET = { pendingBalance: '50.00', availableBalance: '200.00', lifetimeEarnings: '1500.00' };
const COMPLETED_TRIP = {
  driverEarnings: '30.00',
  earningsSupplement: '5.50',
  earningsFloorMet: false,
};
const COMPLETED_TRIP_NO_FLOOR = {
  driverEarnings: '35.00',
  earningsSupplement: '0.00',
  earningsFloorMet: true,
};
const HISTORY_TRIP = {
  id: 't-1',
  completedAt: new Date('2026-06-20T10:00:00Z'),
  pickupAddress: '123 Main St, Newark, NJ 07101',
  dropoffAddress: '456 Broad St, Newark, NJ 07102',
  driverEarnings: '30.00',
  earningsSupplement: '5.50',
  driverRatingRider: 4,
};

describe('EarningsService', () => {
  let service: EarningsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.findUnique.mockResolvedValue(DRIVER);
    mockPrisma.driverWallet.findUnique.mockResolvedValue(WALLET);
    service = new EarningsService();
  });

  describe('getToday', () => {
    it('returns today takeHome and wallet balances', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([COMPLETED_TRIP, COMPLETED_TRIP_NO_FLOOR]);

      const result = await service.getToday('user-1');

      expect(result.takeHome).toBeCloseTo(70.5); // (30+5.5) + (35+0)
      expect(result.trips).toBe(2);
      expect(result.floorTriggeredCount).toBe(1);
      expect(result.floorSupplements).toBeCloseTo(5.5);
      expect(result.hoursOnline).toBe(0);
      expect(result.rewardBonuses).toBe(0);
      expect(result.pendingWallet).toBe(50);
      expect(result.availableWallet).toBe(200);
      expect(result.lifetimeEarnings).toBe(1500);
      expect(result.periodLabel).toBe('Today');
    });

    it('returns zeros when no trips exist', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);
      mockPrisma.driverWallet.findUnique.mockResolvedValue(null);

      const result = await service.getToday('user-1');

      expect(result.takeHome).toBe(0);
      expect(result.trips).toBe(0);
      expect(result.pendingWallet).toBe(0);
    });

    it('throws NotFoundException when driver not found', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue(null);

      await expect(service.getToday('unknown-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWeek', () => {
    it('returns week takeHome and wallet balances', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([COMPLETED_TRIP]);

      const result = await service.getWeek('user-1');

      expect(result.takeHome).toBeCloseTo(35.5);
      expect(result.trips).toBe(1);
      expect(result.periodLabel).toBe('This Week');
    });

    it('queries with correct date range (start of current week)', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);

      await service.getWeek('user-1');

      const callArgs = mockPrisma.trip.findMany.mock.calls[0][0];
      expect(callArgs.where.completedAt.gte).toBeInstanceOf(Date);
      expect(callArgs.where.completedAt.gte.getDay()).toBe(0);
    });
  });

  describe('getHistory', () => {
    it('returns trip earning array directly', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([HISTORY_TRIP]);

      const result = await service.getHistory('user-1', 20, 0);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
      expect(result[0].completedAt).toBe('2026-06-20T10:00:00.000Z');
      expect(result[0].pickupArea).toBe('123 Main St');
      expect(result[0].dropoffArea).toBe('456 Broad St');
      expect(result[0].takeHome).toBeCloseTo(35.5);
      expect(result[0].floorSupplement).toBeCloseTo(5.5);
      expect(result[0].ratingGiven).toBe(4);
    });

    it('returns empty array when no history', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);

      const result = await service.getHistory('user-1', 20, 0);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('respects limit and offset', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([]);

      await service.getHistory('user-1', 10, 30);

      const callArgs = mockPrisma.trip.findMany.mock.calls[0][0];
      expect(callArgs.take).toBe(10);
      expect(callArgs.skip).toBe(30);
    });

    it('handles null driverRatingRider', async () => {
      mockPrisma.trip.findMany.mockResolvedValue([{ ...HISTORY_TRIP, driverRatingRider: null }]);

      const result = await service.getHistory('user-1', 20, 0);

      expect(result[0].ratingGiven).toBeNull();
    });
  });
});
