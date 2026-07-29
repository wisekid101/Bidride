import { PaymentService } from './payment.service';
import { BadRequestException, HttpException, HttpStatus, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

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
  financialLedger: {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
  },
  captureRecovery: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  },
  // Interactive transactions run against the same mock, so assertions can be
  // written against mockPrisma regardless of which side of the boundary a
  // write happened on.
  $transaction: jest.fn().mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(mockPrisma) : Promise.all(arg as [])),
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

const mockLedger = { createEntriesTx: jest.fn().mockResolvedValue(undefined), createEntries: jest.fn().mockResolvedValue(undefined), recordRiderPayment: jest.fn().mockResolvedValue(undefined), recordDriverEarning: jest.fn().mockResolvedValue(undefined), recordTip: jest.fn().mockResolvedValue(undefined), recordRefund: jest.fn().mockResolvedValue(undefined), recordBonus: jest.fn().mockResolvedValue(undefined), recordPayout: jest.fn().mockResolvedValue(undefined), recordAdjustment: jest.fn().mockResolvedValue(undefined), getLedgerEntries: jest.fn().mockResolvedValue([]) } as any;
const mockWallet = { creditEarning: jest.fn().mockResolvedValue(undefined), creditDriverEarning: jest.fn().mockResolvedValue('credited'), releaseHold: jest.fn().mockResolvedValue(undefined), debitPayout: jest.fn().mockResolvedValue(undefined), applyAdjustment: jest.fn().mockResolvedValue(undefined), getWallet: jest.fn().mockResolvedValue({ balance: 0 }) } as any;
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
      const result = await service.createAuthorizationHold('cus_test', 'pm_test', 2000, 'attempt-1');
      expect(result).toEqual({ paymentIntentId: 'pi_test_123' });
    });

    it('throws BadRequestException when amountCents is below 100', async () => {
      await expect(
        service.createAuthorizationHold('cus_test', 'pm_test', 50, 'attempt-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });


// ─── F5 canonical capture fixtures ───────────────────────────────────────────
// Capture now validates the requested amount against the trip's canonical
// finalFare before Stripe is called, so these tests must supply a real trip.
const acceptedBidTrip = (finalFare: number, over: Record<string, unknown> = {}) => ({
  id: 'trip-bid',
  bidId: 'bid-1',
  finalFare,
  winnerBid: { status: 'accepted' },
  ...over,
});

  describe('captureAuthorizationHold', () => {
    it('calls stripe.capture with idempotency key and updates payment record', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.trip.findUnique.mockResolvedValue(acceptedBidTrip(20.00));

      const result = await service.captureAuthorizationHold('pi_test_123', 2000, 'trip-bid');

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
    beforeEach(() => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      mockPrisma.financialLedger.findMany.mockResolvedValue([]);
    });
    it('books the capture as the trip payment record when tripId/riderId present', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.payment.create.mockResolvedValue({});
      mockPrisma.trip.findUnique.mockResolvedValue(acceptedBidTrip(20.16));

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
      // Booking now runs through the shared atomic path (F3b-2a): the ledger
      // pair is written inside the same transaction, under the correlation the
      // webhook and recovery also use.
      const [, entries] = mockLedger.createEntriesTx.mock.calls[0];
      expect(entries).toHaveLength(2);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          correlationId: 'capture:trip-bid', tripId: 'trip-bid',
          amount: 20.16, direction: 'debit', accountId: 'rider-1',
        }),
        expect.objectContaining({
          correlationId: 'capture:trip-bid', tripId: 'trip-bid',
          amount: 20.16, direction: 'credit', accountId: 'platform',
        }),
      ]));
    });

    it('keeps legacy behavior (updateMany only) without attribution', async () => {
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.trip.findUnique.mockResolvedValue(acceptedBidTrip(5.00));

      await service.captureAuthorizationHold('pi_hold_2', 500, 'trip-bid');

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
    it('delegates to wallet.creditDriverEarning with correct params', async () => {
      await service.creditDriverWallet('driver-1', 'trip-1', 15.50);

      expect(mockWallet.creditDriverEarning).toHaveBeenCalledWith('driver-1', 'trip-1', 15.50);
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

// ─── F5: canonical capture validation ────────────────────────────────────────
//
// Offer trips settle through capture rather than chargeTrip, so none of
// chargeTrip's fare-integrity guards applied here: any amount up to the
// authorized standard fare could be captured. Every check below must run
// BEFORE Stripe, so a rejected capture moves no money.

describe('PaymentService — canonical capture validation (F5)', () => {
  const PI = 'pi_capture_guard';
  const TRIP = 'trip-bid';
  const canonical = (finalFare: number, over: Record<string, unknown> = {}) => ({
    id: TRIP, bidId: 'bid-1', finalFare, winnerBid: { status: 'accepted' }, ...over,
  });

  // The stripe mock builds a fresh object per constructor call, so assert
  // against the instance the service actually holds.
  const stripeOf = () =>
    (service as unknown as { stripe: { paymentIntents: { capture: jest.Mock } } }).stripe;

  const expectRejected = async (p: Promise<unknown>) => {
    let caught: unknown;
    try { await p; } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'FARE_INTEGRITY_ERROR' });
  };

  /** Nothing may reach Stripe, the payment table or the ledger on rejection. */
  const expectNoMoneyMoved = () => {
    expect(stripeOf().paymentIntents.capture).not.toHaveBeenCalled();
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    expect(mockLedger.recordRiderPayment).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.tripEvent.create.mockResolvedValue({});
  });

  it('captures the exact canonical amount', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64));

    await expect(service.captureAuthorizationHold(PI, 2364, TRIP)).resolves.toEqual({ status: 'succeeded' });

    expect(stripeOf().paymentIntents.capture).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing capture idempotency key', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64));

    await service.captureAuthorizationHold(PI, 2364, TRIP);

    expect(stripeOf().paymentIntents.capture).toHaveBeenCalledWith(
      PI, { amount_to_capture: 2364 }, { idempotencyKey: `capture_${PI}` },
    );
  });

  it('rejects one cent above the canonical fare', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64));
    await expectRejected(service.captureAuthorizationHold(PI, 2365, TRIP));
    expectNoMoneyMoved();
  });

  it('rejects one cent below the canonical fare', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64));
    await expectRejected(service.captureAuthorizationHold(PI, 2363, TRIP));
    expectNoMoneyMoved();
  });

  it('rejects a capture for a trip that does not exist', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(null);
    await expectRejected(service.captureAuthorizationHold(PI, 2364, TRIP));
    expectNoMoneyMoved();
    // No relational Trip row, so no tripEvent is forced against a missing FK.
    expect(mockPrisma.tripEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a non-bid trip — standard rides settle via charge-trip', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64, { bidId: null, winnerBid: null }));
    await expectRejected(service.captureAuthorizationHold(PI, 2364, TRIP));
    expectNoMoneyMoved();
  });

  it.each([['pending'], ['countered'], ['declined'], ['expired'], ['withdrawn']])(
    'rejects capture while the bid is %s', async (status) => {
      mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64, { winnerBid: { status } }));
      await expectRejected(service.captureAuthorizationHold(PI, 2364, TRIP));
      expectNoMoneyMoved();
    },
  );

  it('rejects when finalFare is null', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(null as unknown as number));
    await expectRejected(service.captureAuthorizationHold(PI, 2364, TRIP));
    expectNoMoneyMoved();
  });

  it('rejects when the canonical fare cannot be safely converted to cents', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(Number.NaN));
    await expectRejected(service.captureAuthorizationHold(PI, 2364, TRIP));
    expectNoMoneyMoved();
  });

  it.each([
    ['zero', 0],
    ['negative', -2364],
    ['fractional', 2364.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['beyond safe-integer range', Number.MAX_SAFE_INTEGER + 2],
  ])('rejects a %s amount before any lookup or Stripe call', async (_label, amount) => {
    await expectRejected(service.captureAuthorizationHold(PI, amount as number, TRIP));
    expectNoMoneyMoved();
    // Malformed input is refused at the shape gate, before the trip is loaded.
    expect(mockPrisma.trip.findUnique).not.toHaveBeenCalled();
  });

  it.each([['missing', undefined], ['empty', ''], ['whitespace', '   ']])(
    'rejects a %s tripId at the request boundary', async (_label, tripId) => {
      await expectRejected(
        service.captureAuthorizationHold(PI, 2364, tripId as unknown as string),
      );
      expectNoMoneyMoved();
      expect(mockPrisma.trip.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty paymentIntentId', async () => {
    await expectRejected(service.captureAuthorizationHold('', 2364, TRIP));
    expectNoMoneyMoved();
  });

  it('records fare-integrity evidence with non-sensitive metadata', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(canonical(23.64));

    await expectRejected(service.captureAuthorizationHold(PI, 9999, TRIP));

    expect(mockPrisma.tripEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: TRIP,
        eventType: 'fare_integrity_error',
        metadata: expect.objectContaining({
          reason: expect.stringContaining('does not match canonical finalFare'),
          expectedAmountCents: 2364,
          requestedAmountCents: 9999,
          paymentIntentId: PI,
          bidId: 'bid-1',
        }),
      }),
    });

    // No vendor secrets or customer payment data in the evidence.
    const meta = JSON.stringify(mockPrisma.tripEvent.create.mock.calls[0][0].data.metadata);
    for (const forbidden of ['sk_', 'cus_', 'pm_', 'client_secret', 'authorization']) {
      expect(meta).not.toContain(forbidden);
    }
  });
});

// ─── F4: bid authorization idempotency ───────────────────────────────────────
//
// The hold was created with no idempotency key, so a retry after a timeout or
// an uncertain response produced a SECOND live hold. Only one payment-intent id
// reaches Redis, so the extra hold was unreachable and never voided.

describe('PaymentService — bid authorization idempotency (F4)', () => {
  const ATTEMPT = 'e5b1e0e2-0000-4000-8000-000000000001';
  const stripeOf = () =>
    (service as unknown as { stripe: { paymentIntents: { create: jest.Mock } } }).stripe;

  beforeEach(() => jest.clearAllMocks());

  it('passes bid_hold_${bidAttemptId} as the Stripe idempotency key', async () => {
    await service.createAuthorizationHold('cus_x', 'pm_x', 2000, ATTEMPT);

    expect(stripeOf().paymentIntents.create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: `bid_hold_${ATTEMPT}` },
    );
  });

  it('the same attempt id always yields the same key', async () => {
    await service.createAuthorizationHold('cus_x', 'pm_x', 2000, ATTEMPT);
    await service.createAuthorizationHold('cus_x', 'pm_x', 2000, ATTEMPT);

    const keys = stripeOf().paymentIntents.create.mock.calls.map((c) => c[1]?.idempotencyKey);
    expect(keys).toEqual([`bid_hold_${ATTEMPT}`, `bid_hold_${ATTEMPT}`]);
  });

  it('different attempts yield different keys', async () => {
    await service.createAuthorizationHold('cus_x', 'pm_x', 2000, ATTEMPT);
    await service.createAuthorizationHold('cus_x', 'pm_x', 2000, 'e5b1e0e2-0000-4000-8000-000000000002');

    const keys = stripeOf().paymentIntents.create.mock.calls.map((c) => c[1]?.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it.each([['missing', undefined], ['empty', ''], ['whitespace', '   ']])(
    'rejects a %s bidAttemptId before Stripe', async (_label, attempt) => {
      await expect(
        service.createAuthorizationHold('cus_x', 'pm_x', 2000, attempt as unknown as string),
      ).rejects.toThrow(BadRequestException);

      expect(stripeOf().paymentIntents.create).not.toHaveBeenCalled();
    },
  );

  it('leaves the payment-intent payload untouched — only the key is added', async () => {
    await service.createAuthorizationHold('cus_x', 'pm_x', 2000, ATTEMPT);

    expect(stripeOf().paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2000,
        currency: 'usd',
        customer: 'cus_x',
        payment_method: 'pm_x',
        capture_method: 'manual',
        confirm: true,
        metadata: { type: 'bid_hold' },
      }),
      expect.any(Object),
    );
  });

  it('AMOUNT_TOO_LOW still rejects, and still before Stripe', async () => {
    await expect(
      service.createAuthorizationHold('cus_x', 'pm_x', 50, ATTEMPT),
    ).rejects.toThrow(BadRequestException);

    expect(stripeOf().paymentIntents.create).not.toHaveBeenCalled();
  });

  it('an idempotency conflict is a hard failure — no second hold is created', async () => {
    stripeOf().paymentIntents.create.mockRejectedValueOnce(
      Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), {
        type: 'StripeIdempotencyError',
      }),
    );

    let caught: unknown;
    try {
      await service.createAuthorizationHold('cus_x', 'pm_x', 2000, ATTEMPT);
    } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'AUTHORIZATION_IDEMPOTENCY_CONFLICT' });
    // Exactly one attempt — never retried under a different key.
    expect(stripeOf().paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it('capture and charge idempotency keys are unchanged', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue({
      id: 'trip-bid', bidId: 'bid-1', finalFare: 20.00, winnerBid: { status: 'accepted' },
    });
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

    await service.captureAuthorizationHold('pi_k', 2000, 'trip-bid');

    expect(
      (service as unknown as { stripe: { paymentIntents: { capture: jest.Mock } } })
        .stripe.paymentIntents.capture,
    ).toHaveBeenCalledWith('pi_k', expect.any(Object), { idempotencyKey: 'capture_pi_k' });
  });
});

// ─── F3a: capture failure detection ─────────────────────────────────────────
// Everything here is about VISIBILITY. Nothing retries, repairs or reconciles.
// The load-bearing distinction: a definitive refusal (money did NOT move) is a
// different EVENT TYPE from an uncertain outcome (money may have moved), so
// operations never has to parse metadata to tell them apart.

describe('PaymentService — capture failure detection (F3a)', () => {
  const PI = 'pi_f3a';
  const TRIP = 'trip-f3a';
  const canonical = { id: TRIP, bidId: 'bid-f3a', finalFare: 23.64, winnerBid: { status: 'accepted' } };
  const CENTS = 2364;

  const stripeOf = () =>
    (service as unknown as { stripe: { paymentIntents: { capture: jest.Mock } } }).stripe;

  /** A Stripe SDK error carries `type`; a bare socket error carries only `name`. */
  const stripeError = (type: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`simulated ${type}`), { type, ...extra });

  const capture = () => service.captureAuthorizationHold(PI, CENTS, TRIP, 'rider-f3a');

  const caught = async (p: Promise<unknown>): Promise<unknown> => {
    try { await p; } catch (e) { return e; }
    throw new Error('expected the capture to reject, but it resolved');
  };

  const eventOf = (): { eventType: string; metadata: Record<string, unknown> } =>
    mockPrisma.tripEvent.create.mock.calls[0][0].data;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.trip.findUnique.mockResolvedValue(canonical);
    mockPrisma.tripEvent.create.mockResolvedValue({});
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.payment.create.mockResolvedValue({});
    mockPrisma.payment.findUnique.mockResolvedValue(null);
    mockPrisma.financialLedger.findMany.mockResolvedValue([]);
  });

  // ── Definitive failure: Stripe refused, money did not move ────────────────

  it.each([
    ['StripeCardError'],
    ['StripeInvalidRequestError'],
    ['StripeIdempotencyError'],
    ['StripeAuthenticationError'],
    ['StripePermissionError'],
    ['StripeRateLimitError'],
  ])('%s is a definitive failure: payment_capture_failed + CAPTURE_FAILED', async (type) => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError(type));

    const err = await caught(capture());

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'CAPTURE_FAILED' });
    expect(eventOf().eventType).toBe('payment_capture_failed');
    expect(eventOf().metadata).toMatchObject({ outcome: 'failed', stripeErrorType: type });
  });

  it('a decline records the decline code without any card details', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(
      stripeError('StripeCardError', {
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        // Fields a raw Stripe error can carry that must never be persisted.
        payment_method: { id: 'pm_secret', card: { last4: '4242', fingerprint: 'fp_x' } },
        customer: 'cus_secret',
      }),
    );

    await caught(capture());

    const { metadata } = eventOf();
    expect(metadata).toMatchObject({ stripeCode: 'card_declined', declineCode: 'insufficient_funds' });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('pm_secret');
    expect(serialized).not.toContain('cus_secret');
    expect(serialized).not.toContain('4242');
    expect(serialized).not.toContain('fp_x');
  });

  // ── Unknown outcome: money may have moved ─────────────────────────────────

  it.each([
    ['StripeConnectionError'],
    ['StripeAPIError'],
  ])('%s is an unknown outcome: payment_capture_outcome_unknown + 502', async (type) => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError(type));

    const err = await caught(capture());

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'CAPTURE_OUTCOME_UNKNOWN' });
    expect(eventOf().eventType).toBe('payment_capture_outcome_unknown');
    expect(eventOf().metadata).toMatchObject({ outcome: 'unknown', stripeErrorType: type });
  });

  it('a socket timeout is unknown, never a failure', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(
      Object.assign(new Error('ETIMEDOUT'), { name: 'TimeoutError', code: 'ETIMEDOUT' }),
    );

    await caught(capture());

    expect(eventOf().eventType).toBe('payment_capture_outcome_unknown');
  });

  it('an unrecognised error defaults to unknown — the fail-closed direction', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(new Error('something nobody modelled'));

    await caught(capture());

    expect(eventOf().eventType).toBe('payment_capture_outcome_unknown');
    expect(eventOf().metadata).toMatchObject({ outcome: 'unknown' });
  });

  it.each([
    ['requires_payment_method'],
    ['requires_action'],
    ['processing'],
    ['canceled'],
  ])('a PaymentIntent returned as %s is unknown and is never booked', async (piStatus) => {
    stripeOf().paymentIntents.capture.mockResolvedValueOnce({ id: PI, status: piStatus });

    const err = await caught(capture());

    expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(eventOf().eventType).toBe('payment_capture_outcome_unknown');
    expect(eventOf().metadata.detail).toContain(piStatus);
    // Never recorded as settled money.
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    expect(mockLedger.recordRiderPayment).not.toHaveBeenCalled();
  });

  // ── Event contract ────────────────────────────────────────────────────────

  it('records the fields operations needs to act on', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeCardError'));

    await caught(capture());

    expect(eventOf().metadata).toMatchObject({
      code: 'CAPTURE_FAILED',
      paymentIntentId: PI,
      bidId: 'bid-f3a',
      requestedAmountCents: CENTS,
      source: 'payment-service',
    });
    expect(typeof eventOf().metadata.attemptedAt).toBe('string');
  });

  it('the trip event is attached to the trip that failed', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeAPIError'));

    await caught(capture());

    expect(mockPrisma.tripEvent.create.mock.calls[0][0].data.tripId).toBe(TRIP);
  });

  it('a failed audit write still surfaces the payment failure', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeCardError'));
    mockPrisma.tripEvent.create.mockRejectedValueOnce(new Error('db down'));

    const err = await caught(capture());

    expect((err as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  // ── Never invent an outcome ───────────────────────────────────────────────

  it('a failed capture books no payment, no ledger and no reconciliation', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeCardError'));

    await caught(capture());

    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    expect(mockLedger.recordRiderPayment).not.toHaveBeenCalled();
  });

  it('does not retry — exactly one Stripe call per capture', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeConnectionError'));

    await caught(capture());

    expect(stripeOf().paymentIntents.capture).toHaveBeenCalledTimes(1);
  });

  it('preserves the F5 idempotency key on the single attempt', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeCardError'));

    await caught(capture());

    expect(stripeOf().paymentIntents.capture)
      .toHaveBeenCalledWith(PI, expect.any(Object), { idempotencyKey: `capture_${PI}` });
  });

  it('a successful capture writes NO failure event', async () => {
    await expect(capture()).resolves.toEqual({ status: 'succeeded' });

    const types = mockPrisma.tripEvent.create.mock.calls.map((c) => c[0].data.eventType);
    expect(types).not.toContain('payment_capture_failed');
    expect(types).not.toContain('payment_capture_outcome_unknown');
  });

  it('an F5 rejection stays a fare-integrity error and never reaches Stripe', async () => {
    // Wrong amount: rejected by F5's gate, before any capture is attempted.
    const err = await caught(service.captureAuthorizationHold(PI, CENTS + 1, TRIP, 'rider-f3a'));

    expect((err as UnprocessableEntityException).getResponse())
      .toMatchObject({ code: 'FARE_INTEGRITY_ERROR' });
    expect(eventOf().eventType).toBe('fare_integrity_error');
    expect(stripeOf().paymentIntents.capture).not.toHaveBeenCalled();
  });
});

// ─── F3b-1: worklist enqueue + webhook fast path ────────────────────────────
// PaymentService's only role in recovery is to put uncertain outcomes on the
// worklist, in the SAME transaction as the F3a audit event, and to hand
// authoritative webhook state to the resolver. It never resolves anything
// itself and it still never captures during recovery.

describe('PaymentService — recovery wiring (F3b-1)', () => {
  const TRIP = 'trip-f3b';
  const PI = 'pi_f3b';
  const canonical = { id: TRIP, bidId: 'bid-f3b', finalFare: 23.64, winnerBid: { status: 'accepted' } };

  let recovery: { enqueue: jest.Mock; resolveFromWebhook: jest.Mock };
  let svc: PaymentService;

  const stripeOf = () =>
    (svc as unknown as { stripe: { paymentIntents: { capture: jest.Mock } } }).stripe;

  const stripeError = (type: string) => Object.assign(new Error(type), { type });

  const captureAttempt = async () => {
    try {
      await svc.captureAuthorizationHold(PI, 2364, TRIP, 'rider-f3b');
    } catch { /* expected */ }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    recovery = { enqueue: jest.fn().mockResolvedValue(undefined), resolveFromWebhook: jest.fn().mockResolvedValue(undefined) };
    svc = new PaymentService(
      mockPrisma, mockConfig, mockRedis, mockLedger, mockWallet, mockReconciliation,
      recovery as never,
    );
    mockPrisma.trip.findUnique.mockResolvedValue(canonical);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.payment.findUnique.mockResolvedValue(null);
    mockPrisma.financialLedger.findMany.mockResolvedValue([]);
  });

  it('an UNKNOWN outcome is queued for recovery', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeConnectionError'));

    await captureAttempt();

    expect(recovery.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tripId: TRIP, paymentIntentId: PI, expectedAmountCents: 2364 }),
    );
  });

  it('a DEFINITIVE failure is not queued — there is nothing to discover', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeCardError'));

    await captureAttempt();

    expect(recovery.enqueue).not.toHaveBeenCalled();
  });

  it('the audit event and the work item are written in one transaction', async () => {
    stripeOf().paymentIntents.capture.mockRejectedValueOnce(stripeError('StripeAPIError'));

    await captureAttempt();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.tripEvent.create).toHaveBeenCalled();
    expect(recovery.enqueue).toHaveBeenCalled();
  });

  it('a successful capture queues nothing', async () => {
    await expect(svc.captureAuthorizationHold(PI, 2364, TRIP, 'rider-f3b'))
      .resolves.toEqual({ status: 'succeeded' });

    expect(recovery.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['payment_intent.succeeded', 'succeeded'],
    ['payment_intent.canceled', 'canceled'],
    ['payment_intent.payment_failed', 'requires_payment_method'],
  ])('%s hands authoritative state to the resolver', async (type, status) => {
    mockRedis.set.mockResolvedValueOnce('OK'); // event not yet processed
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await svc.handleWebhookEvent({
      id: `evt_${status}`, type,
      data: { object: { id: PI, status } },
    } as never);

    expect(recovery.resolveFromWebhook).toHaveBeenCalledWith(PI, status, undefined);
    expect(stripeOf().paymentIntents.capture).not.toHaveBeenCalled();
  });

  it('a resolver failure never breaks webhook handling', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    recovery.resolveFromWebhook.mockRejectedValueOnce(new Error('db down'));

    await expect(svc.handleWebhookEvent({
      id: 'evt_boom', type: 'payment_intent.succeeded',
      data: { object: { id: PI, status: 'succeeded' } },
    } as never)).resolves.toBeUndefined();
  });
});
