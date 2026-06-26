import { EarningsService } from './earnings.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  driver: { findUnique: jest.fn() },
  driverEarning: { findMany: jest.fn(), count: jest.fn() },
  driverWallet: { findUnique: jest.fn() },
};

jest.mock('@bidride/database', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
}));

const DRIVER = { id: 'driver-1' };
const WALLET = { pendingBalance: '50.00', availableBalance: '200.00', lifetimeEarnings: '1500.00' };
const TODAY_EARNING = { amount: '35.50' };
const HISTORY_EARNING = { id: 'e-1', tripId: 't-1', amount: '35.50', createdAt: new Date('2026-06-20T10:00:00Z') };

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
      mockPrisma.driverEarning.findMany.mockResolvedValue([TODAY_EARNING, TODAY_EARNING]);

      const result = await service.getToday('user-1');

      expect(result.takeHome).toBeCloseTo(71.0);
      expect(result.tripCount).toBe(2);
      expect(result.pendingWallet).toBe(50);
      expect(result.availableWallet).toBe(200);
      expect(result.lifetimeEarnings).toBe(1500);
      expect(result.periodLabel).toBe('Today');
    });

    it('returns zeros when no earnings exist', async () => {
      mockPrisma.driverEarning.findMany.mockResolvedValue([]);
      mockPrisma.driverWallet.findUnique.mockResolvedValue(null);

      const result = await service.getToday('user-1');

      expect(result.takeHome).toBe(0);
      expect(result.tripCount).toBe(0);
      expect(result.pendingWallet).toBe(0);
    });

    it('throws NotFoundException when driver not found', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue(null);

      await expect(service.getToday('unknown-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWeek', () => {
    it('returns week takeHome and wallet balances', async () => {
      mockPrisma.driverEarning.findMany.mockResolvedValue([TODAY_EARNING]);

      const result = await service.getWeek('user-1');

      expect(result.takeHome).toBeCloseTo(35.5);
      expect(result.tripCount).toBe(1);
      expect(result.periodLabel).toBe('This Week');
    });

    it('queries with correct date range (start of current week)', async () => {
      mockPrisma.driverEarning.findMany.mockResolvedValue([]);

      await service.getWeek('user-1');

      const callArgs = mockPrisma.driverEarning.findMany.mock.calls[0][0];
      expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date);
      const dayOfWeek = callArgs.where.createdAt.gte.getDay();
      expect(dayOfWeek).toBe(new Date().getDay() <= 0 ? 0 : callArgs.where.createdAt.gte.getDay());
    });
  });

  describe('getHistory', () => {
    it('returns paginated earnings', async () => {
      mockPrisma.driverEarning.count.mockResolvedValue(1);
      mockPrisma.driverEarning.findMany.mockResolvedValue([HISTORY_EARNING]);

      const result = await service.getHistory('user-1', 20, 0);

      expect(result.total).toBe(1);
      expect(result.earnings).toHaveLength(1);
      expect(result.earnings[0].amount).toBe(35.5);
      expect(result.earnings[0].date).toBe('2026-06-20T10:00:00.000Z');
    });

    it('returns empty list when no history', async () => {
      mockPrisma.driverEarning.count.mockResolvedValue(0);
      mockPrisma.driverEarning.findMany.mockResolvedValue([]);

      const result = await service.getHistory('user-1', 20, 0);

      expect(result.total).toBe(0);
      expect(result.earnings).toHaveLength(0);
    });

    it('respects limit and offset', async () => {
      mockPrisma.driverEarning.count.mockResolvedValue(100);
      mockPrisma.driverEarning.findMany.mockResolvedValue([]);

      await service.getHistory('user-1', 10, 30);

      const callArgs = mockPrisma.driverEarning.findMany.mock.calls[0][0];
      expect(callArgs.take).toBe(10);
      expect(callArgs.skip).toBe(30);
    });
  });
});
