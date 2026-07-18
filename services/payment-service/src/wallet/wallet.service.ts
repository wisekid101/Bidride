import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

export const HOLD_HOURS = 2;

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  private async upsertWallet(driverId: string) {
    return this.prisma.driverWallet.upsert({
      where: { driverId },
      update: {},
      create: {
        driverId,
        pendingBalance: 0,
        availableBalance: 0,
        lifetimeEarnings: 0,
        lifetimePaid: 0,
      },
    });
  }

  /**
   * Idempotently credit a driver's trip earnings. Writes the canonical
   * double-entry ledger journal AND the derived wallet projection in ONE
   * transaction, keyed by a deterministic correlationId. Duplicate delivery for
   * the same trip with the same amount is a safe no-op; a duplicate with a
   * DIFFERENT amount or driver fails loudly. Concurrent callers resolve to
   * exactly one credit via the database unique constraints. DriverWallet is a
   * projection here, never the payout source of truth.
   */
  async creditDriverEarning(
    driverId: string,
    tripId: string,
    amount: number,
  ): Promise<'credited' | 'duplicate_ignored' | 'skipped_zero'> {
    if (amount <= 0) return 'skipped_zero';
    const correlationId = `trip:${tripId}:driver_earning`;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Canonical ledger journal (platform -> driver), guarded by
        // @@unique([correlationId, accountId, direction]).
        await this.ledger.createEntriesTx(tx, [
          {
            correlationId,
            entryType: 'driver_earning',
            accountType: 'platform',
            accountId: 'platform',
            direction: 'debit',
            amount,
            tripId,
            sourceEvent: 'trip:completed',
          },
          {
            correlationId,
            entryType: 'driver_earning',
            accountType: 'driver',
            accountId: driverId,
            direction: 'credit',
            amount,
            tripId,
            sourceEvent: 'trip:completed',
          },
        ]);

        // Wallet projection, guarded by wallet_transactions.correlation_id unique.
        const wallet = await tx.driverWallet.upsert({
          where: { driverId },
          update: {
            pendingBalance: { increment: amount },
            lifetimeEarnings: { increment: amount },
          },
          create: {
            driverId,
            pendingBalance: amount,
            availableBalance: 0,
            lifetimeEarnings: amount,
            lifetimePaid: 0,
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            driverId,
            type: 'earning',
            direction: 'credit',
            amount,
            balanceAfter: Number(wallet.availableBalance),
            tripId,
            correlationId,
            description: 'Trip earning (2h hold)',
          },
        });
      });
      return 'credited';
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // A journal for this trip already exists. Idempotent only if the prior
        // credit matches this driver + amount; otherwise surface the conflict.
        const existing = await this.prisma.financialLedger.findFirst({
          where: {
            correlationId,
            entryType: 'driver_earning',
            accountType: 'driver',
            direction: 'credit',
          },
        });
        const cents = (n: number) => Math.round(n * 100);
        if (
          existing &&
          existing.accountId === driverId &&
          cents(Number(existing.amount)) === cents(amount)
        ) {
          return 'duplicate_ignored';
        }
        throw new ConflictException({
          code: 'earning_conflict',
          message:
            'Driver earning already recorded with a different amount or driver for this trip.',
        });
      }
      throw e;
    }
  }

  async releaseHold(driverId: string, tripId: string, amount: number): Promise<void> {
    if (amount <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.driverWallet.update({
        where: { driverId },
        data: {
          pendingBalance: { decrement: amount },
          availableBalance: { increment: amount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          driverId,
          type: 'hold_release',
          direction: 'credit',
          amount,
          balanceAfter: Number(wallet.availableBalance),
          tripId,
          description: 'Earnings released from hold',
        },
      });
    });
  }

  async debitPayout(driverId: string, payoutId: string, amount: number): Promise<void> {
    const wallet = await this.upsertWallet(driverId);
    if (Number(wallet.availableBalance) < amount) {
      throw new BadRequestException('Insufficient available balance for payout.');
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driverWallet.update({
        where: { driverId },
        data: {
          availableBalance: { decrement: amount },
          lifetimePaid: { increment: amount },
          lastPayoutAt: new Date(),
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: updated.id,
          driverId,
          type: 'payout',
          direction: 'debit',
          amount,
          balanceAfter: Number(updated.availableBalance),
          payoutId,
          description: 'Driver payout disbursed',
        },
      });
    });
  }

  async applyAdjustment(opts: {
    driverId: string;
    amount: number;
    direction: 'credit' | 'debit';
    adminId: string;
    description: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.driverWallet.upsert({
        where: { driverId: opts.driverId },
        update:
          opts.direction === 'credit'
            ? { availableBalance: { increment: opts.amount } }
            : { availableBalance: { decrement: opts.amount } },
        create: {
          driverId: opts.driverId,
          pendingBalance: 0,
          availableBalance: opts.direction === 'credit' ? opts.amount : 0,
          lifetimeEarnings: 0,
          lifetimePaid: 0,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          driverId: opts.driverId,
          type: 'adjustment',
          direction: opts.direction,
          amount: opts.amount,
          balanceAfter: Number(wallet.availableBalance),
          description: `Admin adjustment: ${opts.description} (by ${opts.adminId})`,
        },
      });
    });
  }

  async getWallet(driverId: string) {
    const wallet = await this.upsertWallet(driverId);
    const holdCutoff = new Date(Date.now() - HOLD_HOURS * 3600 * 1000);

    // Auto-release any held earnings older than 2h (best-effort)
    const readyHold = await this.prisma.walletTransaction.findMany({
      where: {
        driverId,
        type: 'earning',
        createdAt: { lt: holdCutoff },
      },
      select: { id: true, amount: true, tripId: true },
    });

    for (const txn of readyHold) {
      const released = await this.prisma.walletTransaction.findFirst({
        where: { driverId, type: 'hold_release', tripId: txn.tripId ?? undefined },
      });
      if (!released && txn.tripId) {
        await this.releaseHold(driverId, txn.tripId, Number(txn.amount)).catch(() => {});
      }
    }

    const fresh = await this.upsertWallet(driverId);
    return {
      driverId,
      pendingBalance: Number(fresh.pendingBalance),
      availableBalance: Number(fresh.availableBalance),
      lifetimeEarnings: Number(fresh.lifetimeEarnings),
      lifetimePaid: Number(fresh.lifetimePaid),
      lastPayoutAt: fresh.lastPayoutAt,
      instantPayoutEligible:
        Number(fresh.availableBalance) >= 10 && Number(fresh.availableBalance) <= 500,
    };
  }

  async getTransactionHistory(driverId: string, page = 1, limit = 50) {
    const wallet = await this.prisma.driverWallet.findUnique({ where: { driverId } });
    if (!wallet) return { transactions: [], total: 0, page, pages: 0 };

    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return { transactions, total, page, pages: Math.ceil(total / limit) };
  }
}
