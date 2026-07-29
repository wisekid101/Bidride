import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCorrelationId } from '@bidride/observability';

// Mirrors the event types payment-service and trip-service write (F3a). Two
// types rather than one flag so operations can separate "money did not move"
// from "we cannot tell" without parsing metadata.
const CAPTURE_FAILED_EVENT = 'payment_capture_failed';
const CAPTURE_UNKNOWN_EVENT = 'payment_capture_outcome_unknown';
const CAPTURE_EVENT_TYPES = [CAPTURE_FAILED_EVENT, CAPTURE_UNKNOWN_EVENT];

// Terminal transitions written by the recovery worker (F3b-1).
const RECOVERY_EVENT_TYPES = ['payment_capture_recovered', 'payment_capture_recovery_failed'];

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

  /**
   * Captures that did not land (F3a) — detection surface, not a repair tool.
   *
   * `payment.status = 'failed'` cannot answer this: a capture that fails writes
   * no Payment row at all, so `getFailedPayments` is structurally blind to it.
   * The durable record is the trip event.
   *
   * `outcome` is derived from the event TYPE, never from metadata, so a
   * definitive refusal ('failed' — no money moved) can never be confused with an
   * uncertain outcome ('unknown' — funds may have moved and need checking
   * against Stripe).
   */
  async getCaptureFailures(limit = 50, outcome?: 'failed' | 'unknown') {
    const byOutcome = {
      failed: CAPTURE_FAILED_EVENT,
      unknown: CAPTURE_UNKNOWN_EVENT,
    };
    const eventTypes = outcome ? [byOutcome[outcome]] : [CAPTURE_FAILED_EVENT, CAPTURE_UNKNOWN_EVENT];

    const events = await this.prisma.tripEvent.findMany({
      where: { eventType: { in: eventTypes } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        tripId: true,
        eventType: true,
        metadata: true,
        createdAt: true,
        trip: {
          select: {
            id: true, status: true, riderId: true, driverId: true,
            finalFare: true, bidId: true, completedAt: true,
          },
        },
      },
    });

    return events.map((e) => ({
      id: e.id,
      tripId: e.tripId,
      outcome: e.eventType === CAPTURE_FAILED_EVENT ? 'failed' : 'unknown',
      eventType: e.eventType,
      occurredAt: e.createdAt,
      detail: e.metadata,
      trip: e.trip,
    }));
  }

  // ─── F3b-1: capture recovery worklist ────────────────────────────────────
  //
  // The mutable counterpart to the capture-failure events. Operations inspects
  // and triages here; only Stripe's reported state ever decides a payment
  // outcome, so nothing on this surface can force success or failure.

  async getCaptureRecovery(filters: {
    status?: string;
    resolution?: string;
    tripId?: string;
    paymentIntentId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}) {
    const { status, resolution, tripId, paymentIntentId, from, to, limit = 50 } = filters;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (resolution) where.resolution = resolution;
    if (tripId) where.tripId = tripId;
    if (paymentIntentId) where.paymentIntentId = paymentIntentId;
    if (from || to) {
      where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    return this.prisma.captureRecovery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** One work item with the full audit trail behind it. */
  async getCaptureRecoveryItem(id: string) {
    const item = await this.prisma.captureRecovery.findUnique({ where: { id } });
    if (!item) return null;

    const [trip, events] = await Promise.all([
      this.prisma.trip.findUnique({
        where: { id: item.tripId },
        select: {
          id: true, status: true, riderId: true, driverId: true,
          finalFare: true, bidId: true, completedAt: true,
        },
      }),
      this.prisma.tripEvent.findMany({
        where: {
          tripId: item.tripId,
          eventType: { in: [...CAPTURE_EVENT_TYPES, ...RECOVERY_EVENT_TYPES] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, eventType: true, metadata: true, createdAt: true },
      }),
    ]);

    return { item, trip, history: events };
  }

  /**
   * Worklist health. No alerting yet — these are the numbers a dashboard or an
   * alert rule would read.
   */
  async getCaptureRecoveryMetrics() {
    const [byStatus, oldest, resolvedSample] = await Promise.all([
      this.prisma.captureRecovery.groupBy({ by: ['status'], _count: true }),
      this.prisma.captureRecovery.findFirst({
        where: { status: 'unresolved' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.captureRecovery.findMany({
        where: { resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        orderBy: { resolvedAt: 'desc' },
        take: 500,
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    const durations = resolvedSample
      .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 1000)
      .filter((s) => s >= 0);

    return {
      unresolvedCount: counts.unresolved ?? 0,
      needsAdminCount: counts.needs_admin ?? 0,
      oldestUnresolvedAgeSeconds: oldest
        ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000)
        : null,
      averageResolutionSeconds: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      terminalOutcomeCounts: {
        resolved_captured: counts.resolved_captured ?? 0,
        resolved_not_captured: counts.resolved_not_captured ?? 0,
        needs_admin: counts.needs_admin ?? 0,
        closed: counts.closed ?? 0,
      },
      sampleSize: durations.length,
    };
  }

  /**
   * Re-check delegates to payment-service, which owns the Stripe client. The
   * call is READ-ONLY at the far end: it retrieves the PaymentIntent and
   * records what Stripe reports. No capture, no booking, no ledger.
   */
  async recheckCaptureRecovery(id: string) {
    const base = process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007';
    const res = await fetch(`${base}/payments/internal/capture-recovery/${id}/recheck`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
        // PO-1B: carry the admin request's correlation into payment-service so
        // a manual re-check is traceable across both services.
        ...(getCorrelationId() ? { 'x-correlation-id': getCorrelationId()! } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new BadGatewayException({
        code: 'RECOVERY_RECHECK_FAILED',
        message: `payment-service responded ${res.status} to the re-check request.`,
      });
    }
    return res.json();
  }

  /**
   * Stop tracking a work item, with a reason.
   *
   * An admin may close an item; an admin may NOT declare that a payment
   * succeeded or failed. `closed` is the only status reachable here — every
   * payment outcome comes from Stripe's own reported state.
   */
  async closeCaptureRecovery(id: string, adminId: string, note: string) {
    const item = await this.prisma.captureRecovery.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`No capture recovery item ${id}`);
    if (!note?.trim()) {
      throw new BadRequestException({
        code: 'RESOLUTION_NOTE_REQUIRED',
        message: 'A reason is required to close a capture recovery item.',
      });
    }

    const updated = await this.prisma.captureRecovery.update({
      where: { id },
      data: {
        status: 'closed',
        resolution: 'closed_by_admin',
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
        nextAttemptAt: null,
        lastError: note.slice(0, 200),
      },
    });

    // Append-only audit alongside the mutable work item.
    await this.prisma.tripEvent.create({
      data: {
        tripId: item.tripId,
        eventType: 'payment_capture_recovery_failed',
        metadata: {
          recoveryId: id,
          status: 'closed',
          resolution: 'closed_by_admin',
          detail: note.slice(0, 200),
          adminId,
          previousStatus: item.status,
          resolvedAt: new Date().toISOString(),
          source: 'admin',
        } as object,
      },
    });

    return updated;
  }

  async resolveReconciliation(id: string, adminId: string) {
    return this.prisma.paymentReconciliation.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedByAdminId: adminId },
    });
  }
}
