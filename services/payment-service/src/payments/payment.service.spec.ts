import { PaymentService } from './payment.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// Mock Stripe
jest.mock('stripe', () => {
  const mockConstructor = jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
      }),
      capture: jest.fn().mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' }),
      cancel: jest.fn().mockResolvedValue({ id: 'pi_test_123', status: 'canceled' }),
    },
    accountLinks: {
      create: jest.fn().mockResolvedValue({ url: 'https://connect.stripe.com/setup/test' }),
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
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  payout: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  trip: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  tripEvent: { create: jest.fn().mockResolvedValue({}) },
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
      // Integrity guard context: a standard (non-bid) trip with no prior payment
      mockPrisma.trip.findUnique.mockResolvedValue({ bidId: null, finalFare: null });
      mockPrisma.payment.findFirst.mockResolvedValue(null);
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
      mockPrisma.trip.findUnique.mockResolvedValue({ bidId: null, finalFare: null });
      mockPrisma.payment.findFirst.mockResolvedValue(null);
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

  describe('createAuthorizationHold', () => {
    it('creates a manual-capture PaymentIntent and returns paymentIntentId', async () => {
      const result = await service.createAuthorizationHold('cus_test', 'pm_test', 2000);
      expect(result).toEqual({ paymentIntentId: 'pi_test_123' });
    });

    it('throws BadRequestException when amountCents is below 100', async () => {
      await expect(
        service.createAuthorizationHold('cus_test', 'pm_test', 50),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('captureAuthorizationHold', () => {
    it('calls stripe.capture with idempotency key and updates payment record', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.captureAuthorizationHold('pi_test_123', 2000);

      expect(result).toEqual({ status: 'succeeded' });
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_test_123' },
        data: { status: 'succeeded' },
      });
    });
  });

  describe('voidAuthorizationHold', () => {
    it('calls stripe.cancel and updates payment record to failed', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.voidAuthorizationHold('pi_test_123');

      expect(result).toEqual({ status: 'canceled' });
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_test_123' },
        data: { status: 'failed' },
      });
    });
  });

  // ─── Offer Fare Integrity Hotfix ────────────────────────────────────────
  describe('chargeTrip payment integrity guard', () => {
    it('refuses a direct charge on a bid trip and records fare_integrity_error', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ bidId: 'bid-1', finalFare: 20.16 });

      await expect(
        service.chargeTrip('trip-bid', 'rider-1', 24.66, 'pm_test_123'),
      ).rejects.toMatchObject({ response: { code: 'FARE_INTEGRITY_ERROR' } });

      expect(mockPrisma.tripEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'fare_integrity_error' }),
        }),
      );
      // The blocked charge never reaches Stripe or the payments table.
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('refuses a charge that does not match the canonical finalFare', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ bidId: null, finalFare: 11.36 });

      await expect(
        service.chargeTrip('trip-std', 'rider-1', 12.00, 'pm_test_123'),
      ).rejects.toMatchObject({ response: { code: 'FARE_INTEGRITY_ERROR' } });

      expect(mockPrisma.tripEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'fare_integrity_error',
            metadata: expect.objectContaining({ attemptedAmount: 12.00, tripFinalFare: 11.36 }),
          }),
        }),
      );
    });

    it('returns the existing succeeded payment instead of charging twice', async () => {
      mockPrisma.trip.findUnique.mockResolvedValue({ bidId: null, finalFare: null });
      mockPrisma.payment.findFirst.mockResolvedValue({
        stripePaymentIntentId: 'pi_existing_1',
        status: 'succeeded',
      });

      const res = await service.chargeTrip('trip-paid', 'rider-1', 18.5, 'pm_test_123');

      expect(res).toEqual({ paymentIntentId: 'pi_existing_1', status: 'succeeded' });
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('captureAuthorizationHold with trip attribution', () => {
    it('books the capture as the trip payment record when tripId/riderId present', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.payment.create.mockResolvedValue({});

      await service.captureAuthorizationHold('pi_hold_1', 2016, 'trip-bid', 'rider-1');

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tripId: 'trip-bid',
            riderId: 'rider-1',
            stripePaymentIntentId: 'pi_hold_1',
            amount: 20.16,
            status: 'succeeded',
          }),
        }),
      );
      expect(mockLedger.recordRiderPayment).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: 'trip-bid', amount: 20.16, correlationId: 'capture:trip-bid' }),
      );
    });

    it('keeps legacy behavior (updateMany only) without attribution', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.captureAuthorizationHold('pi_hold_2', 500);

      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.payment.updateMany).toHaveBeenCalled();
    });
  });

  describe('chargeTripByDefault', () => {
    it('looks up default payment method and delegates to chargeTrip', async () => {
      // Integrity guard context for the delegated chargeTrip call
      mockPrisma.trip.findUnique.mockResolvedValue({ bidId: null, finalFare: null });
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.rider.findUnique
        .mockResolvedValueOnce({
          id: 'rider-1',
          stripeCustomerId: 'cus_test_123',
          defaultPaymentMethodId: 'pm_default_123',
        })
        .mockResolvedValueOnce({
          id: 'rider-1',
          stripeCustomerId: 'cus_test_123',
        });
      mockPrisma.payment.create.mockResolvedValue({});

      await service.chargeTripByDefault('trip-1', 'rider-1', 20.00);

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tripId: 'trip-1', amount: 20.00 }),
        }),
      );
    });

    it('throws NO_PAYMENT_METHOD when rider has no default payment method', async () => {
      mockPrisma.rider.findUnique.mockResolvedValue({
        id: 'rider-1',
        stripeCustomerId: 'cus_test_123',
        defaultPaymentMethodId: null,
      });

      await expect(
        service.chargeTripByDefault('trip-1', 'rider-1', 20.00),
      ).rejects.toMatchObject(
        expect.objectContaining({ response: expect.objectContaining({ code: 'NO_PAYMENT_METHOD' }) }),
      );
    });

    it('throws NO_PAYMENT_METHOD when rider has no Stripe customer', async () => {
      mockPrisma.rider.findUnique.mockResolvedValue({
        id: 'rider-1',
        stripeCustomerId: null,
        defaultPaymentMethodId: null,
      });

      await expect(
        service.chargeTripByDefault('trip-1', 'rider-1', 20.00),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('creditDriverWallet', () => {
    it('delegates to wallet.creditEarning with correct params', async () => {
      await service.creditDriverWallet('driver-1', 'trip-1', 15.50);

      expect(mockWallet.creditEarning).toHaveBeenCalledWith('driver-1', 'trip-1', 15.50);
    });
  });

  describe('createConnectOnboardingLink', () => {
    it('creates Express account when driver has none and returns onboarding URL', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({
        id: 'driver-1',
        stripeAccountId: null,
      });
      mockPrisma.driver.update.mockResolvedValue({});

      const result = await service.createConnectOnboardingLink('driver-1');

      expect(result).toEqual({ url: 'https://connect.stripe.com/setup/test' });
      expect(mockPrisma.driver.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripeAccountId: 'acct_test_123' }) }),
      );
    });

    it('reuses existing stripeAccountId without creating a new account', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({
        id: 'driver-1',
        stripeAccountId: 'acct_existing_123',
      });

      const result = await service.createConnectOnboardingLink('driver-1');

      expect(result).toEqual({ url: 'https://connect.stripe.com/setup/test' });
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when driver does not exist', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue(null);

      await expect(
        service.createConnectOnboardingLink('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
