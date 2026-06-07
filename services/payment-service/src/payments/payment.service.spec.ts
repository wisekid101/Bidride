import { PaymentService } from './payment.service';
import { BadRequestException } from '@nestjs/common';

// Mock Stripe
jest.mock('stripe', () => {
  const mockConstructor = jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
      }),
    },
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test_123' }),
    },
    transfers: {
      create: jest.fn().mockResolvedValue({ id: 'tr_test_123' }),
    },
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're_test_123', status: 'succeeded' }),
    },
    accounts: {
      create: jest.fn().mockResolvedValue({ id: 'acct_test_123' }),
      update: jest.fn().mockResolvedValue({}),
    },
    paymentMethods: {
      attach: jest.fn().mockResolvedValue({}),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
  return { default: mockConstructor, __esModule: true };
});

const mockPrisma = {
  rider: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  driver: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  payment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  payout: {
    create: jest.fn(),
  },
  trip: {
    findMany: jest.fn(),
  },
} as any;

const mockConfig = {
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const values: Record<string, string> = {
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    };
    return values[key] ?? 'test-value';
  }),
  get: jest.fn().mockReturnValue('us-east-1'),
} as any;

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  incrby: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
} as any;

const service = new PaymentService(mockPrisma, mockConfig, mockRedis);

describe('PaymentService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('chargeTrip', () => {
    it('creates payment intent and records in DB', async () => {
      mockPrisma.rider.findUnique.mockResolvedValue({
        id: 'rider-1',
        stripeCustomerId: 'cus_test_123',
      });
      mockPrisma.payment.create.mockResolvedValue({});

      await service.chargeTrip('trip-1', 'rider-1', 18.50, 'pm_test_123');

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tripId: 'trip-1',
            amount: 18.50,
            status: 'succeeded',
          }),
        }),
      );
    });

    it('throws if rider has no Stripe customer ID', async () => {
      mockPrisma.rider.findUnique.mockResolvedValue({
        id: 'rider-1',
        stripeCustomerId: null,
      });

      await expect(
        service.chargeTrip('trip-1', 'rider-1', 18.50, 'pm_test_123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('instantPayout', () => {
    it('throws if bank not verified', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({
        id: 'driver-1',
        stripeAccountId: 'acct_test_123',
        payoutBankVerified: false,
      });

      await expect(service.instantPayout('driver-1')).rejects.toThrow(BadRequestException);
    });

    it('throws if balance below minimum', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({
        id: 'driver-1',
        stripeAccountId: 'acct_test_123',
        payoutBankVerified: true,
      });
      // Mock wallet returns $5 available (below $10 minimum)
      mockPrisma.trip.findMany.mockResolvedValue([]);

      await expect(service.instantPayout('driver-1')).rejects.toThrow(BadRequestException);
    });

    it('charges $0.99 fee on instant payout', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({
        id: 'driver-1',
        stripeAccountId: 'acct_test_123',
        payoutBankVerified: true,
      });
      // First findMany (held) = [], second (available) = $50
      mockPrisma.trip.findMany
        .mockResolvedValueOnce([]) // held
        .mockResolvedValueOnce([{ driverEarnings: 50.00 }]); // available

      mockPrisma.payout.create.mockResolvedValue({ id: 'payout-1' });

      const result = await service.instantPayout('driver-1');

      expect(result.fee).toBe(0.99);
      expect(result.amount).toBeCloseTo(49.01); // 50.00 - 0.99
    });
  });

  describe('issueRefund', () => {
    it('issues partial refund and updates payment record', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        tripId: 'trip-1',
        stripePaymentIntentId: 'pi_test_123',
        amount: 25.00,
        refundAmount: 0,
        status: 'succeeded',
      });
      mockPrisma.payment.update.mockResolvedValue({});

      const result = await service.issueRefund('trip-1', 10.00, 'safety');

      expect(result.amount).toBe(10.00);
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundAmount: 10.00,
            status: 'partially_refunded',
          }),
        }),
      );
    });

    it('issues full refund when "full" is passed', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        tripId: 'trip-1',
        stripePaymentIntentId: 'pi_test_123',
        amount: 25.00,
        refundAmount: 0,
        status: 'succeeded',
      });
      mockPrisma.payment.update.mockResolvedValue({});

      const result = await service.issueRefund('trip-1', 'full', 'safety');

      expect(result.amount).toBe(25.00);
    });

    it('throws if payment already fully refunded', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        tripId: 'trip-1',
        stripePaymentIntentId: 'pi_test_123',
        amount: 25.00,
        refundAmount: 25.00,
        status: 'refunded',
      });

      await expect(service.issueRefund('trip-1', 10.00, 'test')).rejects.toThrow(BadRequestException);
    });
  });
});
