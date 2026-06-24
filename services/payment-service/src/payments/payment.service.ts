import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import Stripe from 'stripe';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const INSTANT_PAYOUT_FEE = 0.99;
const MIN_PAYOUT_BALANCE = 10.00;
const INSTANT_PAYOUT_DAILY_CAP = 500.00;
const RECENT_EARNINGS_HOLD_HOURS = 2;

@Injectable()
export class PaymentService {
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

    return { paymentIntentId: paymentIntent.id, status: paymentIntent.status };
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
      idempotencyKey: `instant_${driverId}_${Date.now()}`,
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
  ): Promise<{ status: string }> {
    const pi = await this.stripe.paymentIntents.capture(paymentIntentId, {
      amount_to_capture: amountCents,
    });

    await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: paymentIntentId },
      data: { status: 'succeeded' },
    });

    return { status: pi.status };
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
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const driverId = account.metadata?.driver_id;
        if (driverId && account.payouts_enabled) {
          await this.prisma.driver.updateMany({
            where: { stripeAccountId: account.id },
            data: { payoutBankVerified: true, payoutBankVerifiedAt: new Date() },
          });
        }
        break;
      }
    }
  }
}
