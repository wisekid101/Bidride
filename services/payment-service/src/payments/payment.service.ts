import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  Inject,
  Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

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
  ) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-04-10',
    });
  }

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

  async createAuthorizationHold(
    stripeCustomerId: string,
    paymentMethodId: string,
    amountCents: number,
  ): Promise<{ paymentIntentId: string }> {
    if (amountCents < 100) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_LOW', message: 'Amount must be at least $1.00.' });
    }

    const pi = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { type: 'bid_hold' },
    });

    return { paymentIntentId: pi.id };
  }

  async captureAuthorizationHold(
    paymentIntentId: string,
    amountCents: number,
    tripId?: string,
    riderId?: string,
  ): Promise<{ status: string }> {
    const pi = await this.stripe.paymentIntents.capture(paymentIntentId, {
      amount_to_capture: amountCents,
    }, { idempotencyKey: `capture_${paymentIntentId}` });

    const amount = Math.round(amountCents) / 100;

    if (tripId && riderId) {
      // The capture IS the ride's charge for offer trips — book it so
      // receipts, refunds, and analytics can see the real Stripe movement.
      // (Holds are created without a payments row, so this is usually a
      // create; updateMany covers any legacy row keyed to the same intent.)
      const updated = await this.prisma.payment.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: { amount, status: 'succeeded' },
      });
      let firstBooking = updated.count === 0;
      if (firstBooking) {
        try {
          await this.prisma.payment.create({
            data: {
              tripId,
              riderId,
              stripePaymentIntentId: paymentIntentId,
              amount,
              status: 'succeeded',
            },
          });
        } catch (e: unknown) {
          // Unique violation (tripId / intent id): a concurrent or retried
          // capture already booked this — treat as settled, don't 500 and
          // don't double-book the ledger below.
          firstBooking = false;
          this.logger.warn(
            `captureAuthorizationHold: payment row for ${paymentIntentId} already booked — skipping duplicate booking`,
          );
        }
      }

      // Ledger + reconciliation ONLY on first booking: LedgerService has no
      // idempotency of its own, so a retried capture (Stripe capture itself
      // is idempotent) must not write a second debit/credit pair.
      if (firstBooking) {
        void this.ledger?.recordRiderPayment({
          tripId,
          riderId,
          amount,
          commission: Math.round(amount * 0.20 * 100) / 100,
          correlationId: `capture:${tripId}`,
        }).catch(() => {});
        void this.reconciliation?.reconcilePaymentIntent({
          stripeId: paymentIntentId,
          stripeAmountCents: Math.round(amountCents),
          stripeStatus: pi.status,
        }).catch(() => {});
      }
    } else {
      // Legacy path: no attribution supplied.
      await this.prisma.payment.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: { status: 'succeeded' },
      });
    }

    return { status: pi.status };
  }

  // Fare integrity violations block money movement but must never lose the
  // evidence: persist a trip event with the amounts involved.
  private async recordFareIntegrityError(
    tripId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.logger.error(`FARE INTEGRITY ERROR trip=${tripId}: ${JSON.stringify(metadata)}`);
    try {
      await this.prisma.tripEvent.create({
        data: { tripId, eventType: 'fare_integrity_error', metadata: metadata as object },
      });
    } catch (e) {
      this.logger.error(`Failed to persist fare_integrity_error for trip ${tripId}`, e as Error);
    }
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

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    // Idempotency: each Stripe event ID is processed at most once within 24 hours
    const claimed = await this.redis.set(`stripe:event:${event.id}`, '1', 'EX', 86400, 'NX');
    if (!claimed) return;

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'succeeded' },
        });
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'failed' },
        });
        break;
      }
      case 'payment_intent.canceled': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'failed' },
        });
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
