import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  Inject,
  Logger,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import Stripe from 'stripe';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { BidStatus } from '@bidride/database/generated/client';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { CaptureRecoveryService } from '../recovery/capture-recovery.service';
import { PaymentBookingService } from './payment-booking.service';
import { assertCanonicalCaptureAmount, recordFareIntegrityError } from './capture-validation';
import { paymentMetrics, stripeErrorType } from '../observability/payment-metrics';
import { BidRideLogger } from '@bidride/observability';

/** Raw webhook bodies are never logged — only the verified id and type. */
const webhookLogger = new BidRideLogger('stripe-webhook');

/** The eight types the switch below actually handles; anything else is `unhandled`. */
const HANDLED_WEBHOOK_TYPES = new Set([
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled',
  'charge.refunded', 'charge.dispute.created', 'account.updated',
  'payout.paid', 'payout.failed',
]);

/**
 * Capture-failure audit event types (F3a).
 *
 * Two types, not one flag inside metadata: operations must be able to tell a
 * definitive refusal from an uncertain outcome by the event type alone, without
 * parsing JSON. Money did not move for the first; it may have for the second.
 */
export const CAPTURE_OUTCOME_FAILED = 'payment_capture_failed';
export const CAPTURE_OUTCOME_UNKNOWN = 'payment_capture_outcome_unknown';

/** Stripe accepted the call but returned a PaymentIntent that has not settled. */
export class UnexpectedCaptureStatus extends Error {
  constructor(readonly piStatus: string) {
    super(`capture returned unexpected PaymentIntent status "${piStatus}"`);
    this.name = 'UnexpectedCaptureStatus';
  }
}

/**
 * Did Stripe definitively refuse, or is the outcome unknown?
 *
 * DEFINITIVE means the request was rejected and no funds moved — a declined
 * card, a malformed request, a rejected idempotent replay, an auth or rate-limit
 * refusal. UNKNOWN means the request may have reached Stripe and been acted on:
 * a dropped connection, an API-side error, an unexpected PaymentIntent status,
 * or anything unrecognised. Unrecognised errors are UNKNOWN by default — the
 * fail-closed direction, since assuming "no money moved" is the assumption that
 * can quietly cost a rider.
 */
function classifyCaptureError(error: unknown): {
  outcome: typeof CAPTURE_OUTCOME_FAILED | typeof CAPTURE_OUTCOME_UNKNOWN;
  stripeErrorType: string | null;
  stripeCode: string | null;
  declineCode: string | null;
  detail: string | null;
} {
  const e = (error ?? {}) as {
    type?: unknown; code?: unknown; decline_code?: unknown; name?: unknown; piStatus?: unknown;
  };
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

  if (error instanceof UnexpectedCaptureStatus) {
    return {
      outcome: CAPTURE_OUTCOME_UNKNOWN,
      stripeErrorType: null,
      stripeCode: null,
      declineCode: null,
      detail: `unexpected PaymentIntent status: ${error.piStatus}`,
    };
  }

  const type = str(e.type) ?? str(e.name);
  const definitive = new Set([
    'StripeCardError',           // declined — Stripe refused, no funds moved
    'StripeInvalidRequestError', // malformed or unusable request
    'StripeIdempotencyError',    // replayed key with different params; rejected
    'StripeAuthenticationError',
    'StripePermissionError',
    'StripeRateLimitError',      // throttled before processing
  ]);

  return {
    outcome: type && definitive.has(type) ? CAPTURE_OUTCOME_FAILED : CAPTURE_OUTCOME_UNKNOWN,
    stripeErrorType: type,
    stripeCode: str(e.code),
    declineCode: str(e.decline_code),
    detail: null,
  };
}

const INSTANT_PAYOUT_FEE = 0.99;
const MIN_PAYOUT_BALANCE = 10.00;
const INSTANT_PAYOUT_DAILY_CAP = 500.00;
const RECENT_EARNINGS_HOLD_HOURS = 2;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly reconciliation: ReconciliationService,
    @Optional() private readonly recovery?: CaptureRecoveryService,
    @Optional() private readonly bookingService?: PaymentBookingService,
  ) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-04-10',
    });
    // Booking is not optional behaviour — it is how a capture becomes money on
    // the books. When it is not injected (direct construction), build one from
    // the same prisma and ledger this service already holds.
    this.booking = bookingService ?? new PaymentBookingService(prisma, ledger);
  }

  private readonly booking: PaymentBookingService;

  // ─── Rider Payment Methods ────────────────────────────────────────────────

  async addPaymentMethod(riderId: string, paymentMethodId: string) {
    const rider = await this.prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new NotFoundException('Rider not found.');

    let customerId = rider.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        metadata: { rider_id: riderId },
      });
      customerId = customer.id;
      await this.prisma.rider.update({
        where: { id: riderId },
        data: { stripeCustomerId: customerId },
      });
    }

    await this.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

    return { paymentMethodId, attached: true };
  }

  async chargeTrip(tripId: string, riderId: string, amount: number, paymentMethodId: string) {
    // ── PAYMENT INTEGRITY GUARD ─────────────────────────────────────────────
    // The trip's canonical fare is authoritative. Never adjust an amount,
    // never fall back to a different fare, never charge twice — refuse and
    // preserve the audit trail instead.
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { bidId: true, finalFare: true },
    });
    if (!trip) throw new NotFoundException('Trip not found.');

    if (trip.bidId != null) {
      // Offer trips are settled on Stripe by capturing the authorization
      // hold at the accepted fare. A direct charge here is by definition a
      // double charge.
      await this.recordFareIntegrityError(tripId, {
        reason: 'direct charge attempted on bid trip',
        attemptedAmount: amount,
        tripFinalFare: trip.finalFare === null ? null : Number(trip.finalFare),
        bidId: trip.bidId,
      });
      throw new UnprocessableEntityException({
        code: 'FARE_INTEGRITY_ERROR',
        message: 'Bid trips are settled by hold capture — direct charge refused.',
      });
    }

    if (trip.finalFare != null && Math.abs(amount - Number(trip.finalFare)) > 0.005) {
      await this.recordFareIntegrityError(tripId, {
        reason: 'charge amount does not match canonical finalFare',
        attemptedAmount: amount,
        tripFinalFare: Number(trip.finalFare),
      });
      throw new UnprocessableEntityException({
        code: 'FARE_INTEGRITY_ERROR',
        message: 'Charge amount does not match the trip canonical fare — payment blocked.',
      });
    }

    // Double-charge protection beyond Stripe's idempotency key: a trip with
    // a succeeded payment is settled, full stop.
    const existing = await this.prisma.payment.findFirst({
      where: { tripId, status: 'succeeded' },
    });
    if (existing) {
      this.logger.warn(`chargeTrip: trip ${tripId} already settled (${existing.stripePaymentIntentId}) — returning existing payment`);
      return { paymentIntentId: existing.stripePaymentIntentId, status: 'succeeded' as const };
    }

    const rider = await this.prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider?.stripeCustomerId) throw new BadRequestException('No payment method on file.');

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency: 'usd',
      customer: rider.stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { trip_id: tripId, rider_id: riderId },
    }, { idempotencyKey: `charge_${tripId}` });

    await this.prisma.payment.create({
      data: {
        tripId,
        riderId,
        stripePaymentIntentId: paymentIntent.id,
        amount,
        status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
      },
    });

    // Fire-and-forget: write ledger entries + reconcile
    void this.ledger?.recordRiderPayment({
      tripId,
      riderId,
      amount,
      commission: Math.round(amount * 0.20 * 100) / 100,
      correlationId: `charge:${tripId}`,
    }).catch(() => {});
    void this.reconciliation?.reconcilePaymentIntent({
      stripeId: paymentIntent.id,
      stripeAmountCents: Math.round(amount * 100),
      stripeStatus: paymentIntent.status,
    }).catch(() => {});

    return { paymentIntentId: paymentIntent.id, status: paymentIntent.status };
  }

  async chargeTripByDefault(tripId: string, riderId: string, amount: number) {
    const rider = await this.prisma.rider.findUnique({
      where: { id: riderId },
      select: { stripeCustomerId: true, defaultPaymentMethodId: true },
    });
    if (!rider?.stripeCustomerId || !rider.defaultPaymentMethodId) {
      throw new BadRequestException({
        code: 'NO_PAYMENT_METHOD',
        message: 'Rider has no default payment method on file.',
      });
    }
    return this.chargeTrip(tripId, riderId, amount, rider.defaultPaymentMethodId);
  }

  // ─── Driver Payouts ───────────────────────────────────────────────────────

  async linkBankAccount(driverId: string, token: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found.');

    let accountId = driver.stripeAccountId;
    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'express',
        country: 'US',
        capabilities: { transfers: { requested: true } },
        metadata: { driver_id: driverId },
      });
      accountId = account.id;
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { stripeAccountId: accountId },
      });
    }

    await this.stripe.accounts.update(accountId, {
      external_account: token,
    });

    // Stripe micro-deposit verification flow triggers automatically
    await this.prisma.driver.update({
      where: { id: driverId },
      data: { payoutBankVerified: false }, // true only after micro-deposit confirm
    });

    return { accountId, message: 'Bank linked. Micro-deposit verification initiated.' };
  }

  async creditDriverWallet(driverId: string, tripId: string, amount: number): Promise<void> {
    await this.wallet.creditDriverEarning(driverId, tripId, amount);
  }

  async getDriverWallet(driverId: string) {
    const now = new Date();
    const holdCutoff = new Date(now.getTime() - RECENT_EARNINGS_HOLD_HOURS * 3600 * 1000);

    const recentTrips = await this.prisma.trip.findMany({
      where: {
        driverId,
        status: 'completed',
        completedAt: { gte: holdCutoff },
      },
      select: { driverEarnings: true, earningsSupplement: true },
    });

    const heldBalance = recentTrips.reduce(
      (sum, t) => sum + Number(t.driverEarnings ?? 0),
      0,
    );

    const readyTrips = await this.prisma.trip.findMany({
      where: {
        driverId,
        status: 'completed',
        completedAt: { lt: holdCutoff },
        // Exclude already paid out
      },
      select: { driverEarnings: true },
    });

    const availableBalance = readyTrips.reduce(
      (sum, t) => sum + Number(t.driverEarnings ?? 0),
      0,
    );

    return {
      availableBalance: Math.round(availableBalance * 100) / 100,
      heldBalance: Math.round(heldBalance * 100) / 100,
      holdHours: RECENT_EARNINGS_HOLD_HOURS,
      minimumInstantPayout: MIN_PAYOUT_BALANCE,
      instantPayoutFee: INSTANT_PAYOUT_FEE,
    };
  }

  async createConnectOnboardingLink(driverId: string): Promise<{ url: string }> {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found.');

    let accountId = driver.stripeAccountId;
    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'express',
        country: 'US',
        capabilities: { transfers: { requested: true } },
        metadata: { driver_id: driverId },
      });
      accountId = account.id;
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { stripeAccountId: accountId },
      });
    }

    const returnUrl = this.config.get<string>('APP_RETURN_URL') ?? 'bidiride://wallet';
    const refreshUrl = this.config.get<string>('APP_REFRESH_URL') ?? 'bidiride://wallet/connect';

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return { url: link.url };
  }

  async instantPayout(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver?.stripeAccountId) throw new BadRequestException('No bank account on file.');
    if (!driver.payoutBankVerified) throw new BadRequestException('Bank account not yet verified.');

    const wallet = await this.getDriverWallet(driverId);

    if (wallet.availableBalance < MIN_PAYOUT_BALANCE) {
      throw new BadRequestException({
        code: 'PAYOUT_INSUFFICIENT_BALANCE',
        message: `Minimum balance for instant payout is $${MIN_PAYOUT_BALANCE}.`,
      });
    }

    // Check daily cap
    const dailyCapKey = `instant_payout:daily:${driverId}:${new Date().toDateString()}`;
    const todayTotal = Number(await this.redis.get(dailyCapKey) ?? '0');

    if (todayTotal + wallet.availableBalance > INSTANT_PAYOUT_DAILY_CAP) {
      throw new BadRequestException({
        code: 'PAYOUT_DAILY_CAP_EXCEEDED',
        message: `Daily instant payout cap is $${INSTANT_PAYOUT_DAILY_CAP}.`,
      });
    }

    const payoutAmount = wallet.availableBalance - INSTANT_PAYOUT_FEE;

    const transfer = await this.stripe.transfers.create({
      amount: Math.round(payoutAmount * 100),
      currency: 'usd',
      destination: driver.stripeAccountId,
      metadata: { driver_id: driverId, type: 'instant' },
    }, {
      idempotencyKey: `instant_payout_${driverId}_${new Date().toISOString().slice(0, 10)}`,
    });

    await this.redis.incrby(dailyCapKey, Math.round(wallet.availableBalance * 100));
    await this.redis.expire(dailyCapKey, 86400);

    const payout = await this.prisma.payout.create({
      data: {
        driverId,
        periodStart: new Date(),
        periodEnd: new Date(),
        tripEarnings: wallet.availableBalance,
        instantFees: INSTANT_PAYOUT_FEE,
        totalPayout: payoutAmount,
        stripeTransferId: transfer.id,
        status: 'paid',
        paidAt: new Date(),
      },
    });

    // Fire-and-forget: wallet debit + ledger
    void this.wallet?.debitPayout(driverId, payout.id, payoutAmount).catch(() => {});
    void this.ledger?.recordPayout({
      driverId,
      amount: payoutAmount,
      payoutId: payout.id,
      correlationId: `instant_payout:${payout.id}`,
    }).catch(() => {});

    return {
      payoutId: payout.id,
      amount: payoutAmount,
      fee: INSTANT_PAYOUT_FEE,
      transferId: transfer.id,
    };
  }

  // ─── Refunds ──────────────────────────────────────────────────────────────

  async issueRefund(tripId: string, amount: number | 'full', reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { tripId } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status === 'refunded') throw new BadRequestException('Payment already fully refunded.');

    const refundAmount =
      amount === 'full'
        ? Number(payment.amount) - Number(payment.refundAmount)
        : amount;

    const refund = await this.stripe.refunds.create({
      payment_intent: payment.stripePaymentIntentId,
      amount: Math.round(refundAmount * 100),
      reason: 'requested_by_customer',
      metadata: { trip_id: tripId, reason },
    });

    const newRefundTotal = Number(payment.refundAmount) + refundAmount;
    const isFullRefund = newRefundTotal >= Number(payment.amount);

    await this.prisma.payment.update({
      where: { tripId },
      data: {
        refundAmount: newRefundTotal,
        status: isFullRefund ? 'refunded' : 'partially_refunded',
      },
    });

    return { refundId: refund.id, amount: refundAmount, status: refund.status };
  }

  // ─── Bid Authorization Holds (internal — called by trip-service) ─────────

  /**
   * Create a manual-capture hold for a bid attempt.
   *
   * `bidAttemptId` identifies one business authorization attempt and becomes
   * the Stripe idempotency key. Without it, a retry after a timeout or an
   * uncertain response created a SECOND live hold on the rider's card — and
   * because only one payment-intent id reaches Redis, the extra hold was
   * unreachable and never voided.
   *
   * It cannot be derived from bidId or tripId: both are created after this call.
   */
  async createAuthorizationHold(
    stripeCustomerId: string,
    paymentMethodId: string,
    amountCents: number,
    bidAttemptId: string,
  ): Promise<{ paymentIntentId: string }> {
    if (typeof bidAttemptId !== 'string' || bidAttemptId.trim() === '') {
      throw new BadRequestException({
        code: 'BID_ATTEMPT_ID_REQUIRED',
        message: 'A bid attempt id is required to authorize a hold.',
      });
    }
    if (amountCents < 100) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_LOW', message: 'Amount must be at least $1.00.' });
    }

    try {
      const pi = await this.stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        capture_method: 'manual',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { type: 'bid_hold' },
      }, { idempotencyKey: `bid_hold_${bidAttemptId}` });

      return { paymentIntentId: pi.id };
    } catch (e: unknown) {
      paymentMetrics.stripeErrorTotal.inc({
        operation: 'authorize', error_type: stripeErrorType(e),
      });
      // Same attempt id replayed with a DIFFERENT body. That is an integrity
      // failure, not a transient error: retrying under a fresh key would create
      // exactly the duplicate hold this guard exists to prevent.
      if ((e as { type?: string }).type === 'StripeIdempotencyError') {
        this.logger.error(
          `Idempotency conflict authorizing bid attempt ${bidAttemptId} — request differs from the original; refusing to create a second hold`,
        );
        throw new UnprocessableEntityException({
          code: 'AUTHORIZATION_IDEMPOTENCY_CONFLICT',
          message: 'This bid attempt was already authorized with different details.',
        });
      }
      throw e;
    }
  }

  /**
   * Capture an offer-trip authorization hold.
   *
   * The caller-supplied amount is NOT trusted. Offer trips settle through this
   * path rather than chargeTrip, which meant the fare-integrity guards that
   * protect standard rides did not apply here at all: any amount up to the
   * authorized standard fare could be captured. Every validation below runs
   * BEFORE Stripe is called, so a rejected capture moves no money.
   *
   * The authorized amount remains the standard fare and the captured amount
   * remains the accepted canonical fare — that partial capture is intentional
   * and unchanged.
   */
  async captureAuthorizationHold(
    paymentIntentId: string,
    amountCents: number,
    tripId: string,
    riderId?: string,
  ): Promise<{ status: string }> {
    // ── 1-3. Canonical validation (F5) ──────────────────────────────────────
    // Extracted so recovery reuses the identical rule rather than growing a
    // second implementation of how much may move. Behaviour is unchanged.
    if (typeof paymentIntentId !== 'string' || paymentIntentId.trim() === '') {
      throw new UnprocessableEntityException({
        code: 'FARE_INTEGRITY_ERROR',
        message: 'A payment intent id is required to capture an authorization hold.',
      });
    }
    await assertCanonicalCaptureAmount(this.validationDeps, tripId, amountCents, paymentIntentId);

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { bidId: true },
    });

    // ── 4. Only now may money move ──────────────────────────────────────────
    // Everything above rejects before Stripe is called (F5). From here on the
    // request has left the building, so a failure is either DEFINITIVE — Stripe
    // refused and no money moved — or UNKNOWN, where funds may well have been
    // taken and we simply cannot tell. The two are recorded as different events
    // and never conflated: calling an unknown outcome a failure would invent a
    // fact about the rider's money.
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.stripe.paymentIntents.capture(paymentIntentId, {
        amount_to_capture: amountCents,
      }, { idempotencyKey: `capture_${paymentIntentId}` });
    } catch (e: unknown) {
      paymentMetrics.stripeErrorTotal.inc({
        operation: 'capture', error_type: stripeErrorType(e),
      });
      throw await this.recordCaptureOutcome(tripId, e, {
        paymentIntentId,
        bidId: trip.bidId,
        requestedAmountCents: amountCents,
      });
    }

    // A capture that returns something other than `succeeded` has not settled
    // and must not be booked as though it had. Stripe accepted the call, so we
    // cannot claim definitive failure either — this is an unknown outcome.
    if (pi.status !== 'succeeded') {
      throw await this.recordCaptureOutcome(tripId, new UnexpectedCaptureStatus(pi.status), {
        paymentIntentId,
        bidId: trip.bidId,
        requestedAmountCents: amountCents,
      });
    }

    const amount = Math.round(amountCents) / 100;

    // The outcome is now authoritative: Stripe returned and the status is
    // `succeeded`. The failure arms of this metric live in recordCaptureOutcome,
    // the only other place a capture outcome becomes known.
    paymentMetrics.captureTotal.inc({ outcome: 'succeeded' });

    if (riderId) {
      // One shared, atomic booking path for capture, webhook and recovery. The
      // Payment row and both ledger entries commit together, and ledger errors
      // are no longer swallowed.
      const { outcome } = await this.booking.bookCapturedPayment(null, {
        tripId,
        riderId,
        paymentIntentId,
        amountCents,
        source: 'capture',
      });

      // Reconcile only on a first booking: a replay has already been reconciled.
      if (outcome === 'created') {
        void this.reconciliation?.reconcilePaymentIntent({
          stripeId: paymentIntentId,
          stripeAmountCents: Math.round(amountCents),
          stripeStatus: pi.status,
        }).catch(() => {});
      }
    } else {
      // Legacy path: no attribution supplied, so there is nothing to book
      // against a rider. Mark the intent settled and leave it there.
      await this.prisma.payment.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: { status: 'succeeded' },
      });
    }

    return { status: pi.status };
  }

  /**
   * Classify a capture failure and record it durably, returning the exception
   * the caller should throw.
   *
   * DETECTION ONLY — nothing here retries, repairs or reconciles. It makes the
   * failure visible and auditable, and hands back a stable code.
   */
  private async recordCaptureOutcome(
    tripId: string,
    error: unknown,
    context: { paymentIntentId: string; bidId: string | null; requestedAmountCents: number },
  ): Promise<Error> {
    const { outcome, stripeErrorType, stripeCode, declineCode, detail } = classifyCaptureError(error);
    const definitive = outcome === CAPTURE_OUTCOME_FAILED;

    // Only scalar, non-sensitive fields — never the raw Stripe error object,
    // which can carry customer ids, payment-method fingerprints and last-4.
    const metadata = {
      outcome: definitive ? 'failed' : 'unknown',
      code: definitive ? 'CAPTURE_FAILED' : 'CAPTURE_OUTCOME_UNKNOWN',
      stripeErrorType,
      stripeCode,
      declineCode,
      detail,
      paymentIntentId: context.paymentIntentId,
      bidId: context.bidId,
      requestedAmountCents: context.requestedAmountCents,
      attemptedAt: new Date().toISOString(),
      source: 'payment-service',
    };

    // OUTCOME metric, not a state transition: emitted as soon as the
    // classification is known, deliberately NOT gated on the audit write below.
    // Gating it would lose the signal exactly when the database is unhealthy —
    // the moment it matters most.
    const outcomeValue = definitive ? 'failed' : 'unknown';
    paymentMetrics.captureTotal.inc({ outcome: outcomeValue });
    paymentMetrics.captureFailureTotal.inc({
      outcome: outcomeValue,
      stripe_error_type: stripeErrorType ?? 'unknown',
    });

    this.logger.error(
      `${definitive ? 'CAPTURE FAILED' : 'CAPTURE OUTCOME UNKNOWN'} trip=${tripId}: ${JSON.stringify(metadata)}`,
    );

    // Best-effort, like recordFareIntegrityError: losing the audit row must not
    // mask the payment failure the caller is about to be told about.
    //
    // The immutable event and the mutable work item are written in ONE
    // transaction: an uncertainty that is recorded but never queued would be
    // invisible to recovery, and a queued item with no evidence would have no
    // audit trail.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.tripEvent.create({
          data: { tripId, eventType: outcome, metadata: metadata as object },
        });
        // Only uncertain outcomes need reconciling. A definitive refusal is
        // already a known fact — there is nothing for a worker to discover.
        if (!definitive && this.recovery) {
          await this.recovery.enqueue(tx as never, {
            tripId,
            paymentIntentId: context.paymentIntentId,
            bidId: context.bidId,
            expectedAmountCents: context.requestedAmountCents,
          });
        }
      });
    } catch (e) {
      this.logger.error(`Failed to persist ${outcome} for trip ${tripId}`, e as Error);
    }

    return definitive
      ? new UnprocessableEntityException({
          code: 'CAPTURE_FAILED',
          message: 'Stripe refused the capture — no funds were moved.',
        })
      // 502, not 500: this says "upstream outcome uncertain", which operations
      // must be able to separate from an ordinary server fault.
      : new HttpException(
          {
            code: 'CAPTURE_OUTCOME_UNKNOWN',
            message: 'The capture outcome could not be determined — funds may or may not have moved.',
          },
          HttpStatus.BAD_GATEWAY,
        );
  }

  // Fare integrity violations block money movement but must never lose the
  // evidence: persist a trip event with the amounts involved.
  private get validationDeps() {
    return { prisma: this.prisma as never, logger: this.logger };
  }

  // Delegates to the extracted implementation so capture, charge and recovery
  // all record fare-integrity evidence identically.
  private async recordFareIntegrityError(
    tripId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await recordFareIntegrityError(this.validationDeps, tripId, metadata);
  }

  async voidAuthorizationHold(paymentIntentId: string): Promise<{ status: string }> {
    const pi = await this.stripe.paymentIntents.cancel(paymentIntentId);

    await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: paymentIntentId },
      data: { status: 'failed' },
    });

    return { status: pi.status };
  }

  // ─── Stripe Webhooks ──────────────────────────────────────────────────────

  constructWebhookEvent(body: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      body,
      signature,
      this.config.getOrThrow('STRIPE_WEBHOOK_SECRET'),
    );
  }

  /**
   * Book a webhook-confirmed capture through the shared path.
   *
   * Only offer trips are booked here: the trip must carry a bid and the amount
   * must pass F5 against the canonical fare. A standard ride settles through
   * chargeTrip and already has its own Payment row. Best-effort by design — a
   * webhook must not fail on our bookkeeping — but nothing is swallowed
   * silently: every branch logs.
   */
  private async bookFromWebhook(pi: Stripe.PaymentIntent): Promise<void> {
    const tripId = typeof pi.metadata?.trip_id === 'string' ? pi.metadata.trip_id : null;
    const received = typeof pi.amount_received === 'number' ? pi.amount_received : null;
    if (!tripId || !received) return;

    try {
      const trip = await this.prisma.trip.findUnique({
        where: { id: tripId },
        select: { bidId: true, riderId: true },
      });
      if (!trip?.bidId) return; // standard ride — chargeTrip owns its booking

      // F5 decides the amount, exactly as it does for a direct capture.
      await assertCanonicalCaptureAmount(this.validationDeps, tripId, received, pi.id);

      const { outcome } = await this.booking.bookCapturedPayment(null, {
        tripId,
        riderId: trip.riderId,
        paymentIntentId: pi.id,
        amountCents: received,
        source: 'webhook',
      });
      this.logger.log(`webhook booking for trip ${tripId} (${pi.id}): ${outcome}`);
    } catch (e) {
      this.logger.error(`Webhook booking failed for ${pi.id} (trip ${tripId})`, e as Error);
    }
  }

  /** Best-effort webhook resolution — a webhook must never fail on our bookkeeping. */
  private async resolveRecoveryFromWebhook(pi: Stripe.PaymentIntent): Promise<void> {
    if (!this.recovery || !pi?.id || typeof pi.status !== 'string') return;
    try {
      await this.recovery.resolveFromWebhook(
        pi.id, pi.status,
        typeof pi.amount_received === 'number' ? pi.amount_received : undefined,
      );
    } catch (e) {
      this.logger.error(`Recovery webhook resolution failed for ${pi.id}`, e as Error);
    }
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    // Idempotency: each Stripe event ID is processed at most once within 24 hours
    const claimed = await this.redis.set(`stripe:event:${event.id}`, '1', 'EX', 86400, 'NX');
    if (!claimed) {
      // Stripe redelivery is normal, not an error — but a spike in it is worth
      // seeing, so it is an outcome value rather than a dropped event. The
      // event ID is context for the log line, NEVER a metric dimension: Stripe
      // has hundreds of event types and unbounded ids.
      paymentMetrics.webhookTotal.inc({ event_type: event.type, outcome: 'duplicate' });
      webhookLogger.info('webhook_duplicate', { eventId: event.id, eventType: event.type });
      return;
    }

    let outcome: 'processed' | 'unhandled' | 'failed' = 'processed';
    try {
      await this.dispatchWebhookEvent(event);
      outcome = HANDLED_WEBHOOK_TYPES.has(event.type) ? 'processed' : 'unhandled';
    } catch (e) {
      outcome = 'failed';
      webhookLogger.error('webhook_failed', e, { eventId: event.id, eventType: event.type });
      throw e;
    } finally {
      paymentMetrics.webhookTotal.inc({ event_type: event.type, outcome });
    }
  }

  /** The original switch, unchanged — extracted so the metric wraps it once. */
  private async dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'succeeded' },
        });
        // The webhook used to update the Payment row and write NO ledger entry
        // at all, so a capture confirmed only by webhook never reached the
        // books. It now goes through the same atomic booking path as capture
        // and recovery, and is replay-safe against all three.
        await this.bookFromWebhook(pi);
        // Fast path (F3b-1): the webhook carries authoritative Stripe state, so
        // an open recovery item for this intent can be resolved now instead of
        // waiting for the next poll. Never issues a capture.
        await this.resolveRecoveryFromWebhook(pi);
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'failed' },
        });
        // Fast path (F3b-1): the webhook carries authoritative Stripe state, so
        // an open recovery item for this intent can be resolved now instead of
        // waiting for the next poll. Never issues a capture.
        await this.resolveRecoveryFromWebhook(pi);
        break;
      }
      case 'payment_intent.canceled': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'failed' },
        });
        // Fast path (F3b-1): the webhook carries authoritative Stripe state, so
        // an open recovery item for this intent can be resolved now instead of
        // waiting for the next poll. Never issues a capture.
        await this.resolveRecoveryFromWebhook(pi);
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : (charge.payment_intent as Stripe.PaymentIntent | null)?.id;
        if (!piId) break;

        const refundDollars = charge.amount_refunded / 100;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: piId },
          data: {
            refundAmount: refundDollars,
            status: charge.refunded ? 'refunded' : 'partially_refunded',
          },
        });
        break;
      }
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        if (account.payouts_enabled) {
          await this.prisma.driver.updateMany({
            where: { stripeAccountId: account.id },
            data: { payoutBankVerified: true, payoutBankVerifiedAt: new Date() },
          });
        }
        break;
      }
      case 'payout.paid': {
        if (event.account) {
          const driver = await this.prisma.driver.findFirst({
            where: { stripeAccountId: event.account },
            select: { id: true },
          });
          if (driver) {
            await this.prisma.payout.updateMany({
              where: { driverId: driver.id, status: 'pending' },
              data: { status: 'paid', paidAt: new Date() },
            });
          }
        }
        break;
      }
      case 'payout.failed': {
        if (event.account) {
          const driver = await this.prisma.driver.findFirst({
            where: { stripeAccountId: event.account },
            select: { id: true },
          });
          if (driver) {
            await this.prisma.payout.updateMany({
              where: { driverId: driver.id, status: 'pending' },
              data: { status: 'failed' },
            });
          }
        }
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const piId = typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : (dispute.payment_intent as Stripe.PaymentIntent | null)?.id;
        if (piId) {
          void this.reconciliation?.recordDispute({
            stripeDisputeId: dispute.id,
            stripeAmountCents: dispute.amount,
            paymentIntentId: piId,
          }).catch(() => {});
        }
        break;
      }
    }
  }
}
