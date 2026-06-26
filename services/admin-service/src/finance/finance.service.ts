import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getRevenueSummary(startDate: Date, endDate: Date) {
    const [payments, refunds, tips, commissions] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'succeeded', createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { refundAmount: { gt: 0 }, createdAt: { gte: startDate, lte: endDate } },
        _sum: { refundAmount: true },
        _count: true,
      }),
      this.prisma.financialLedger.aggregate({
        where: { entryType: 'tip', direction: 'credit', createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.financialLedger.aggregate({
        where: { entryType: 'commission', direction: 'credit', accountType: 'platform', createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
      }),
    ]);

    const grossRevenue = Number(payments._sum.amount ?? 0);
    const totalRefunds = Number(refunds._sum.refundAmount ?? 0);

    return {
      grossRevenue,
      totalRefunds,
      netRevenue: grossRevenue - totalRefunds,
      platformCommission: Number(commissions._sum.amount ?? 0),
      tipRevenue: Number(tips._sum.amount ?? 0),
      paymentCount: payments._count,
      refundCount: refunds._count,
    };
  }

  async getDriverPayoutSummary(startDate: Date, endDate: Date) {
    const [paid, pending, failed] = await Promise.all([
      this.prisma.payoutAttempt.aggregate({
        where: { status: 'succeeded', createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.driverWallet.aggregate({
        _sum: { availableBalance: true, pendingBalance: true },
      }),
      this.prisma.payoutAttempt.findMany({
        where: { status: 'failed', createdAt: { gte: startDate, lte: endDate } },
        select: { id: true, driverId: true, amount: true, failureReason: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      totalPaid: Number(paid._sum.amount ?? 0),
      payoutCount: paid._count,
      pendingAvailable: Number(pending._sum.availableBalance ?? 0),
      pendingHeld: Number(pending._sum.pendingBalance ?? 0),
      failedPayouts: failed,
    };
  }

  async getOutstandingLiabilities() {
    const wallets = await this.prisma.driverWallet.aggregate({
      _sum: { availableBalance: true, pendingBalance: true },
      _count: true,
    });

    const pendingRefunds = await this.prisma.payment.aggregate({
      where: { status: 'partially_refunded' },
      _sum: { amount: true, refundAmount: true },
    });

    return {
      totalAvailableWalletBalance: Number(wallets._sum.availableBalance ?? 0),
      totalPendingWalletBalance: Number(wallets._sum.pendingBalance ?? 0),
      totalOutstanding:
        Number(wallets._sum.availableBalance ?? 0) +
        Number(wallets._sum.pendingBalance ?? 0),
      driverCount: wallets._count,
      partialRefundOutstanding:
        Number(pendingRefunds._sum.amount ?? 0) - Number(pendingRefunds._sum.refundAmount ?? 0),
    };
  }

  async getRefundTotals(startDate: Date, endDate: Date) {
    const [totals, byReason] = await Promise.all([
      this.prisma.refund.aggregate({
        where: { createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.groupBy({
        by: ['reason'],
        where: { createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
      }),
    ]);

    return {
      totalAmount: Number(totals._sum.amount ?? 0),
      count: totals._count,
      byReason: byReason.map((r) => ({
        reason: r.reason,
        total: Number(r._sum.amount ?? 0),
        count: r._count,
      })),
    };
  }

  async getDailyReport(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const [revenue, payouts, refunds, failedPayments] = await Promise.all([
      this.getRevenueSummary(start, end),
      this.getDriverPayoutSummary(start, end),
      this.getRefundTotals(start, end),
      this.prisma.payment.count({ where: { status: 'failed', createdAt: { gte: start, lte: end } } }),
    ]);

    return {
      date: start.toISOString().split('T')[0],
      revenue,
      payouts,
      refunds,
      failedPayments,
    };
  }

  async getMonthlyReport(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const [revenue, payouts, refunds] = await Promise.all([
      this.getRevenueSummary(start, end),
      this.getDriverPayoutSummary(start, end),
      this.getRefundTotals(start, end),
    ]);

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      revenue,
      payouts,
      refunds,
    };
  }

  async getFailedPayments(limit = 50) {
    return this.prisma.payment.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        tripId: true,
        riderId: true,
        amount: true,
        stripePaymentIntentId: true,
        createdAt: true,
      },
    });
  }

  async getFailedPayouts(limit = 50) {
    return this.prisma.payoutAttempt.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        driverId: true,
        amount: true,
        failureReason: true,
        attemptNumber: true,
        createdAt: true,
      },
    });
  }

  async getReconciliationMismatches(limit = 50) {
    return this.prisma.paymentReconciliation.findMany({
      where: { status: { in: ['mismatch', 'orphan'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async resolveReconciliation(id: string, adminId: string) {
    return this.prisma.paymentReconciliation.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedByAdminId: adminId },
    });
  }
}
