import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';

const MIN_PAYOUT = 10.00;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_HOURS = [1, 6, 24]; // hours per retry attempt

@Injectable()
export class PayoutBatchService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PayoutBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-04-10',
    });
  }

  async scheduleBatch(opts: { periodStart: Date; periodEnd: Date; batchType?: string }) {
    const eligibleWallets = await this.prisma.driverWallet.findMany({
      where: { availableBalance: { gte: MIN_PAYOUT } },
      include: { driver: { select: { id: true, stripeAccountId: true, payoutBankVerified: true } } },
    });

    const totalAmount = eligibleWallets.reduce(
      (s, w) => s + Number(w.availableBalance),
      0,
    );

    const batch = await this.prisma.payoutBatch.create({
      data: {
        batchType: opts.batchType ?? 'weekly',
        periodStart: opts.periodStart,
        periodEnd: opts.periodEnd,
        totalAmount,
        driverCount: eligibleWallets.length,
        status: 'pending',
      },
    });

    return { batchId: batch.id, driverCount: eligibleWallets.length, totalAmount };
  }

  async processBatch(batchId: string): Promise<void> {
    const batch = await this.prisma.payoutBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.status !== 'pending') return;

    await this.prisma.payoutBatch.update({
      where: { id: batchId },
      data: { status: 'processing' },
    });

    const eligibleWallets = await this.prisma.driverWallet.findMany({
      where: { availableBalance: { gte: MIN_PAYOUT } },
      include: { driver: { select: { id: true, stripeAccountId: true, payoutBankVerified: true } } },
    });

    let successCount = 0;
    let failCount = 0;

    for (const walletRow of eligibleWallets) {
      const driver = walletRow.driver;
      if (!driver.payoutBankVerified || !driver.stripeAccountId) {
        failCount++;
        continue;
      }

      const amount = Number(walletRow.availableBalance);
      await this.attemptPayout({ batchId, driverId: driver.id, stripeAccountId: driver.stripeAccountId, amount });
      successCount++;
    }

    await this.prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: failCount === eligibleWallets.length ? 'failed' : 'completed',
        processedAt: new Date(),
      },
    });

    this.logger.log(`Batch ${batchId}: ${successCount} succeeded, ${failCount} failed`);
  }

  private async attemptPayout(opts: {
    batchId: string;
    driverId: string;
    stripeAccountId: string;
    amount: number;
    attemptNumber?: number;
  }): Promise<void> {
    const attempt = await this.prisma.payoutAttempt.create({
      data: {
        batchId: opts.batchId,
        driverId: opts.driverId,
        amount: opts.amount,
        status: 'pending',
        attemptNumber: opts.attemptNumber ?? 1,
      },
    });

    try {
      const transfer = await this.stripe.transfers.create(
        {
          amount: Math.round(opts.amount * 100),
          currency: 'usd',
          destination: opts.stripeAccountId,
          metadata: { driver_id: opts.driverId, batch_id: opts.batchId, attempt_id: attempt.id },
        },
        { idempotencyKey: `batch_payout_${attempt.id}` },
      );

      await this.prisma.payoutAttempt.update({
        where: { id: attempt.id },
        data: { status: 'succeeded', stripeTransferId: transfer.id, succeededAt: new Date() },
      });

      await this.wallet.debitPayout(opts.driverId, attempt.id, opts.amount).catch(() => {});
      await this.ledger.recordPayout({
        driverId: opts.driverId,
        amount: opts.amount,
        payoutId: attempt.id,
        correlationId: `payout:${attempt.id}`,
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttemptNum = (opts.attemptNumber ?? 1) + 1;
      const backoffHours = RETRY_BACKOFF_HOURS[(opts.attemptNumber ?? 1) - 1] ?? 24;

      await this.prisma.payoutAttempt.update({
        where: { id: attempt.id },
        data: {
          status: nextAttemptNum <= MAX_RETRY_ATTEMPTS ? 'retrying' : 'failed',
          failureReason: message.slice(0, 200),
          nextRetryAt:
            nextAttemptNum <= MAX_RETRY_ATTEMPTS
              ? new Date(Date.now() + backoffHours * 3600 * 1000)
              : null,
        },
      });
    }
  }

  async retryFailedAttempts(): Promise<void> {
    const due = await this.prisma.payoutAttempt.findMany({
      where: {
        status: 'retrying',
        nextRetryAt: { lte: new Date() },
        attemptNumber: { lt: MAX_RETRY_ATTEMPTS },
      },
      include: { driver: { select: { stripeAccountId: true, payoutBankVerified: true } } },
    });

    for (const attempt of due) {
      if (!attempt.driver.payoutBankVerified || !attempt.driver.stripeAccountId) continue;

      await this.attemptPayout({
        batchId: attempt.batchId ?? '',
        driverId: attempt.driverId,
        stripeAccountId: attempt.driver.stripeAccountId,
        amount: Number(attempt.amount),
        attemptNumber: attempt.attemptNumber + 1,
      });
    }
  }

  async getDriverPayoutAttempts(driverId: string, limit = 20) {
    return this.prisma.payoutAttempt.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        amount: true,
        status: true,
        failureReason: true,
        attemptNumber: true,
        succeededAt: true,
        createdAt: true,
      },
    });
  }
}
