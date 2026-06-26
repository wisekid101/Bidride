import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const HOLD_HOURS = 2;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

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

  async creditEarning(driverId: string, tripId: string, amount: number): Promise<void> {
    if (amount <= 0) return;

    await this.prisma.$transaction(async (tx) => {
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
          description: `Trip earning (2h hold)`,
        },
      });
    });
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
