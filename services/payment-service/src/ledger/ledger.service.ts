import { Injectable } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LedgerEntry {
  correlationId: string;
  entryType: string;
  accountType: string;
  accountId: string;
  direction: 'debit' | 'credit';
  amount: number;
  tripId?: string;
  refundId?: string;
  payoutId?: string;
  actorType?: string;
  actorId?: string;
  sourceEvent: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** A journal must balance (debits == credits) before any row is written. */
  private assertBalanced(entries: LedgerEntry[]): void {
    const debitTotal = entries.filter((e) => e.direction === 'debit').reduce((s, e) => s + e.amount, 0);
    const creditTotal = entries.filter((e) => e.direction === 'credit').reduce((s, e) => s + e.amount, 0);
    if (Math.abs(debitTotal - creditTotal) > 0.001) {
      throw new Error(`Ledger imbalance: debits=${debitTotal} credits=${creditTotal}`);
    }
  }

  /**
   * Write a balanced journal on an EXISTING transaction client, so a caller can
   * persist the canonical ledger and a projection (e.g. the driver wallet) in
   * one atomic transaction. The @@unique([correlationId, accountId, direction])
   * constraint makes a duplicate journal insert fail with P2002 — callers turn
   * that into idempotency. correlationId identifies a JOURNAL (2+ legs), never a
   * single row, so it is never unique on its own.
   */
  async createEntriesTx(tx: Prisma.TransactionClient, entries: LedgerEntry[]): Promise<void> {
    this.assertBalanced(entries);
    for (const e of entries) {
      await tx.financialLedger.create({
        data: {
          correlationId: e.correlationId,
          entryType: e.entryType,
          accountType: e.accountType,
          accountId: e.accountId,
          direction: e.direction,
          amount: e.amount,
          tripId: e.tripId,
          refundId: e.refundId,
          payoutId: e.payoutId,
          actorType: e.actorType ?? 'system',
          actorId: e.actorId,
          sourceEvent: e.sourceEvent,
          metadata: (e.metadata ?? {}) as Prisma.InputJsonObject,
        },
      });
    }
  }

  async createEntries(entries: LedgerEntry[]): Promise<void> {
    await this.prisma.$transaction((tx) => this.createEntriesTx(tx, entries));
  }

  async recordRiderPayment(opts: {
    tripId: string;
    riderId: string;
    amount: number;
    commission: number;
    correlationId: string;
  }): Promise<void> {
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'rider_payment',
        accountType: 'rider',
        accountId: opts.riderId,
        direction: 'debit',
        amount: opts.amount,
        tripId: opts.tripId,
        sourceEvent: 'payment:charge_trip',
      },
      {
        correlationId: opts.correlationId,
        entryType: 'rider_payment',
        accountType: 'platform',
        accountId: 'platform',
        direction: 'credit',
        amount: opts.amount,
        tripId: opts.tripId,
        sourceEvent: 'payment:charge_trip',
        metadata: { commission: opts.commission },
      },
    ]);
  }

  async recordDriverEarning(opts: {
    tripId: string;
    driverId: string;
    amount: number;
    correlationId: string;
  }): Promise<void> {
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'driver_earning',
        accountType: 'platform',
        accountId: 'platform',
        direction: 'debit',
        amount: opts.amount,
        tripId: opts.tripId,
        sourceEvent: 'trip:completed',
      },
      {
        correlationId: opts.correlationId,
        entryType: 'driver_earning',
        accountType: 'driver',
        accountId: opts.driverId,
        direction: 'credit',
        amount: opts.amount,
        tripId: opts.tripId,
        sourceEvent: 'trip:completed',
      },
    ]);
  }

  async recordTip(opts: {
    tripId: string;
    riderId: string;
    driverId: string;
    amount: number;
    correlationId: string;
  }): Promise<void> {
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'tip',
        accountType: 'rider',
        accountId: opts.riderId,
        direction: 'debit',
        amount: opts.amount,
        tripId: opts.tripId,
        sourceEvent: 'trip:tip',
      },
      {
        correlationId: opts.correlationId,
        entryType: 'tip',
        accountType: 'driver',
        accountId: opts.driverId,
        direction: 'credit',
        amount: opts.amount,
        tripId: opts.tripId,
        sourceEvent: 'trip:tip',
      },
    ]);
  }

  async recordRefund(opts: {
    tripId: string;
    riderId: string;
    amount: number;
    refundId: string;
    correlationId: string;
    adminId?: string;
    reason: string;
  }): Promise<void> {
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'refund',
        accountType: 'platform',
        accountId: 'platform',
        direction: 'debit',
        amount: opts.amount,
        tripId: opts.tripId,
        refundId: opts.refundId,
        actorType: opts.adminId ? 'admin' : 'system',
        actorId: opts.adminId,
        sourceEvent: 'payment:refund',
        metadata: { reason: opts.reason },
      },
      {
        correlationId: opts.correlationId,
        entryType: 'refund',
        accountType: 'rider',
        accountId: opts.riderId,
        direction: 'credit',
        amount: opts.amount,
        tripId: opts.tripId,
        refundId: opts.refundId,
        actorType: opts.adminId ? 'admin' : 'system',
        actorId: opts.adminId,
        sourceEvent: 'payment:refund',
        metadata: { reason: opts.reason },
      },
    ]);
  }

  async recordBonus(opts: {
    driverId: string;
    amount: number;
    correlationId: string;
    description: string;
    adminId?: string;
  }): Promise<void> {
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'incentive',
        accountType: 'platform',
        accountId: 'platform',
        direction: 'debit',
        amount: opts.amount,
        actorType: opts.adminId ? 'admin' : 'system',
        actorId: opts.adminId,
        sourceEvent: 'payment:bonus',
        metadata: { description: opts.description },
      },
      {
        correlationId: opts.correlationId,
        entryType: 'incentive',
        accountType: 'driver',
        accountId: opts.driverId,
        direction: 'credit',
        amount: opts.amount,
        actorType: opts.adminId ? 'admin' : 'system',
        actorId: opts.adminId,
        sourceEvent: 'payment:bonus',
        metadata: { description: opts.description },
      },
    ]);
  }

  async recordPayout(opts: {
    driverId: string;
    amount: number;
    payoutId: string;
    correlationId: string;
  }): Promise<void> {
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'payout',
        accountType: 'driver',
        accountId: opts.driverId,
        direction: 'debit',
        amount: opts.amount,
        payoutId: opts.payoutId,
        sourceEvent: 'payment:payout',
      },
      {
        correlationId: opts.correlationId,
        entryType: 'payout',
        accountType: 'platform',
        accountId: 'platform',
        direction: 'credit',
        amount: opts.amount,
        payoutId: opts.payoutId,
        sourceEvent: 'payment:payout',
      },
    ]);
  }

  async recordAdjustment(opts: {
    accountId: string;
    accountType: string;
    amount: number;
    direction: 'debit' | 'credit';
    correlationId: string;
    adminId: string;
    description: string;
  }): Promise<void> {
    const counterDirection: 'debit' | 'credit' = opts.direction === 'debit' ? 'credit' : 'debit';
    await this.createEntries([
      {
        correlationId: opts.correlationId,
        entryType: 'adjustment',
        accountType: opts.accountType,
        accountId: opts.accountId,
        direction: opts.direction,
        amount: opts.amount,
        actorType: 'admin',
        actorId: opts.adminId,
        sourceEvent: 'admin:adjustment',
        metadata: { description: opts.description },
      },
      {
        correlationId: opts.correlationId,
        entryType: 'adjustment',
        accountType: 'platform',
        accountId: 'platform',
        direction: counterDirection,
        amount: opts.amount,
        actorType: 'admin',
        actorId: opts.adminId,
        sourceEvent: 'admin:adjustment',
        metadata: { description: opts.description },
      },
    ]);
  }

  async getLedgerEntries(opts: {
    accountId?: string;
    tripId?: string;
    entryType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }) {
    return this.prisma.financialLedger.findMany({
      where: {
        ...(opts.accountId && { accountId: opts.accountId }),
        ...(opts.tripId && { tripId: opts.tripId }),
        ...(opts.entryType && { entryType: opts.entryType }),
        ...(opts.startDate || opts.endDate
          ? { createdAt: { gte: opts.startDate, lte: opts.endDate } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
    });
  }
}
