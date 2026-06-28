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
    findFirst: jest.fn(),
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
    updateMany: jest.fn(),
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
  set: jest.fn().mockResolvedValue('OK'), // NX returns 'OK' on first write, null if already set
  incrby: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
} as any;

const mockLedger = { createEntries: jest.fn().mockResolvedValue(undefined), recordRiderPayment: jest.fn().mockResolvedValue(undefined), recordDriverEarning: jest.fn().mockResolvedValue(undefined), recordTip: jest.fn().mockResolvedValue(undefined), recordRefund: jest.fn().mockResolvedValue(undefined), recordBonus: jest.fn().mockResolvedValue(undefined), recordPayout: jest.fn().mockResolvedValue(undefined), recordAdjustment: jest.fn().mockResolvedValue(undefined), getLedgerEntries: jest.fn().mockResolvedValue([]) } as any;
const mockWallet = { creditEarning: jest.fn().mockResolvedValue(undefined), releaseHold: jest.fn().mockResolvedValue(undefined), debitPayout: jest.fn().mockResolvedValue(undefined), applyAdjustment: jest.fn().mockResolvedValue(undefined), getWallet: jest.fn().mockResolvedValue({ balance: 0 }) } as any;
const mockReconciliation = { reconcilePaymentIntent: jest.fn().mockResolvedValue(undefined), reconcileRefund: jest.fn().mockResolvedValue(undefined), recordDispute: jest.fn().mockResolvedValue(undefined), listMismatches: jest.fn().mockResolvedValue([]), resolveEntry: jest.fn().mockResolvedValue(undefined) } as any;

const service = new PaymentService(mockPrisma, mockConfig, mockRedis, mockLedger, mockWallet, mockReconciliation);

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

  // ── handleWebhookEvent ───────────────────────────────────────────────────

  describe('handleWebhookEvent', () => {
    function makeEvent(type: string, object: object, extra: Partial<{ id: string; account: string }> = {}): any {
      return { id: extra.id ?? 'evt_test_123', type, data: { object }, account: extra.account };
    }

    beforeEach(() => {
      // Default: NX succeeds (event not yet processed)
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.driver.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.driver.findFirst.mockResolvedValue({ id: 'driver-1' });
      mockPrisma.payout.updateMany.mockResolvedValue({ count: 1 });
    });

    it('skips processing when event was already handled (idempotency)', async () => {
      mockRedis.set.mockResolvedValue(null); // NX fails — already exists

      await service.handleWebhookEvent(
        makeEvent('payment_intent.succeeded', { id: 'pi_dup' }),
      );

      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('processes the same event ID only once across duplicate deliveries', async () => {
      mockRedis.set
        .mockResolvedValueOnce('OK')  // first delivery — claimed
        .mockResolvedValueOnce(null); // second delivery — already set

      const event = makeEvent('payment_intent.succeeded', { id: 'pi_123' });

      await service.handleWebhookEvent(event);
      await service.handleWebhookEvent(event);

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledTimes(1);
    });

    it('payment_intent.succeeded → sets payment status to succeeded', async () => {
      await service.handleWebhookEvent(
        makeEvent('payment_intent.succeeded', { id: 'pi_abc' }),
      );

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_abc' },
        data: { status: 'succeeded' },
      });
    });

    it('payment_intent.payment_failed → sets payment status to failed', async () => {
      await service.handleWebhookEvent(
        makeEvent('payment_intent.payment_failed', { id: 'pi_fail' }),
      );

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_fail' },
        data: { status: 'failed' },
      });
    });

    it('payment_intent.canceled → sets payment status to failed', async () => {
      await service.handleWebhookEvent(
        makeEvent('payment_intent.canceled', { id: 'pi_cancel' }),
      );

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_cancel' },
        data: { status: 'failed' },
      });
    });

    it('charge.refunded (partial) → sets partially_refunded with correct amount', async () => {
      await service.handleWebhookEvent(
        makeEvent('charge.refunded', {
          payment_intent: 'pi_charge_123',
          amount_refunded: 1000, // $10.00 in cents
          refunded: false,       // not fully refunded
        }),
      );

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_charge_123' },
        data: { refundAmount: 10.00, status: 'partially_refunded' },
      });
    });

    it('charge.refunded (full) → sets refunded status', async () => {
      await service.handleWebhookEvent(
        makeEvent('charge.refunded', {
          payment_intent: 'pi_charge_456',
          amount_refunded: 2500, // $25.00
          refunded: true,
        }),
      );

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_charge_456' },
        data: { refundAmount: 25.00, status: 'refunded' },
      });
    });

    it('account.updated → marks driver bank verified when payouts_enabled', async () => {
      await service.handleWebhookEvent(
        makeEvent('account.updated', { id: 'acct_test_123', payouts_enabled: true }),
      );

      expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith({
        where: { stripeAccountId: 'acct_test_123' },
        data: expect.objectContaining({ payoutBankVerified: true }),
      });
    });

    it('account.updated → does not update when payouts_enabled is false', async () => {
      await service.handleWebhookEvent(
        makeEvent('account.updated', { id: 'acct_test_123', payouts_enabled: false }),
      );

      expect(mockPrisma.driver.updateMany).not.toHaveBeenCalled();
    });

    it('payout.paid → marks pending payouts as paid for the connected account driver', async () => {
      await service.handleWebhookEvent(
        makeEvent('payout.paid', { id: 'po_123' }, { account: 'acct_connected_123' }),
      );

      expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith({
        where: { stripeAccountId: 'acct_connected_123' },
        select: { id: true },
      });
      expect(mockPrisma.payout.updateMany).toHaveBeenCalledWith({
        where: { driverId: 'driver-1', status: 'pending' },
        data: expect.objectContaining({ status: 'paid' }),
      });
    });

    it('payout.failed → marks pending payouts as failed', async () => {
      await service.handleWebhookEvent(
        makeEvent('payout.failed', { id: 'po_fail_123' }, { account: 'acct_connected_123' }),
      );

      expect(mockPrisma.payout.updateMany).toHaveBeenCalledWith({
        where: { driverId: 'driver-1', status: 'pending' },
        data: { status: 'failed' },
      });
    });
  });
});
