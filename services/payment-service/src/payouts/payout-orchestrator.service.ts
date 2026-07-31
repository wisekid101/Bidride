import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutAllocationService } from './payout-allocation.service';
import { PayoutSubmissionService } from './payout-submission.service';

/**
 * Instant-payout orchestration.
 *
 * This is the ONLY approved path from a driver payout request to money movement.
 * It deliberately owns no money logic of its own — it connects two components
 * that already own theirs:
 *
 *   PayoutAllocationService  — eligibility (ledger credits past the 2h hold,
 *                              minus debits, minus active reservations),
 *                              PayoutRequest creation, and the reservation of
 *                              whole earning rows. A per-driver advisory lock
 *                              serialises concurrent flows, and the partial
 *                              unique index `payout_allocations_active_earning_key`
 *                              is the AUTHORITATIVE double-payment protection:
 *                              one earning may hold at most one active allocation.
 *   PayoutSubmissionService  — the Stripe transfer under a PayoutRequest-scoped
 *                              idempotency key, submission-attempt evidence, and
 *                              the blocked/resume/reconcile states.
 *
 * WHY NOT the legacy path: PaymentService.instantPayout summed lifetime Trip
 * rows with no durable record of which earnings a payout covered, so "exclude
 * already paid" was unimplementable. This service never reads Trip and never
 * calls getDriverWallet; its constructor takes no PaymentService, which makes
 * that unreachable by construction rather than by convention.
 */

/** Minimum ledger-available balance before an instant payout may be requested. */
export const INSTANT_PAYOUT_MIN_BALANCE = 10.0;

/** Maximum total instant payout a driver may request per calendar day. */
export const INSTANT_PAYOUT_DAILY_CAP = 500.0;

const PAYOUT_CURRENCY = 'usd';

/**
 * Requests that consumed (or may still consume) money today. RELEASED and
 * CANCELED requests returned their earnings to the available pool, so they must
 * not count against the cap. Derived from the durable PayoutRequest table rather
 * than the legacy Redis counter, which was mutated only AFTER the transfer and
 * reset on eviction.
 */
const COUNTS_TOWARD_DAILY_CAP = [
  'ALLOCATED',
  'SUBMISSION_PENDING',
  'SUBMITTED',
  'PAID',
  'SUBMISSION_BLOCKED',
  'RECONCILIATION_REQUIRED',
];

export interface InstantPayoutResult {
  payoutRequestId: string;
  status: string;
  /** True ONLY when the durable request reached PAID. Never infer success from
   *  the absence of an exception — a blocked submission resolves normally. */
  paid: boolean;
  amount: number;
  currency: string;
  allocationCount: number;
}

@Injectable()
export class PayoutOrchestratorService {
  private readonly logger = new Logger(PayoutOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocation: PayoutAllocationService,
    private readonly submission: PayoutSubmissionService,
  ) {}

  /** Total already committed today, from durable rows (not Redis). */
  private async committedTodayDollars(driverId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const agg = await this.prisma.payoutRequest.aggregate({
      _sum: { amount: true },
      where: {
        driverId,
        currency: PAYOUT_CURRENCY,
        createdAt: { gte: startOfDay },
        status: { in: COUNTS_TOWARD_DAILY_CAP },
      },
    });
    return Number(agg._sum.amount ?? 0);
  }

  /**
   * Allocate the driver's eligible unpaid earnings and submit them.
   *
   * Callers must already have passed the PAYOUTS_ENABLED gate; the submission
   * service re-checks it independently, so a misconfigured caller still cannot
   * move money.
   */
  async requestInstantPayout(
    driverId: string,
    opts: { idempotencyKey?: string } = {},
  ): Promise<InstantPayoutResult> {
    // 1. Eligibility comes from the ledger, never from Trip sums.
    const available = await this.allocation.getAvailableBalance(driverId, PAYOUT_CURRENCY);

    if (available < INSTANT_PAYOUT_MIN_BALANCE) {
      throw new BadRequestException({
        code: 'PAYOUT_INSUFFICIENT_BALANCE',
        message: `Minimum balance for instant payout is $${INSTANT_PAYOUT_MIN_BALANCE}.`,
      });
    }

    const committedToday = await this.committedTodayDollars(driverId);
    if (committedToday + available > INSTANT_PAYOUT_DAILY_CAP) {
      throw new BadRequestException({
        code: 'PAYOUT_DAILY_CAP_EXCEEDED',
        message: `Daily instant payout cap is $${INSTANT_PAYOUT_DAILY_CAP}.`,
      });
    }

    // 2. Reserve the exact earning rows. A distinct key per attempt keeps each
    //    attempt durable and traceable; double-payment is prevented by the DB
    //    invariant, not by this key.
    const idempotencyKey = opts.idempotencyKey ?? `instant:${driverId}:${randomUUID()}`;

    const request = await this.allocation.allocate({
      driverId,
      amount: available,
      currency: PAYOUT_CURRENCY,
      idempotencyKey,
      initiatorType: 'driver',
      initiatorId: driverId,
      reason: 'instant_payout',
    });

    // 3. Submit. A THROW means no durable settlement occurred, so the
    //    reservation is released and the earnings return to the available pool.
    //    A RESOLVED non-PAID status (blocked / reconciliation-required) is a
    //    recoverable state that must KEEP its allocations and evidence for
    //    resumePayoutRequest / reconcilePayoutRequest — releasing there would
    //    destroy the audit trail and could double-spend a transfer already sent.
    let settled: { status?: string; amount?: unknown; allocations?: unknown[] } | null;
    try {
      settled = (await this.submission.submitPayoutRequest(request.id)) as typeof settled;
    } catch (err) {
      const reason = `submission_failed: ${err instanceof Error ? err.message : String(err)}`;
      try {
        await this.allocation.releasePayoutRequest({
          payoutRequestId: request.id,
          reason,
          initiatorType: 'system',
          initiatorId: null,
        });
      } catch (releaseErr) {
        // Surface the ORIGINAL failure; a failed release leaves the request
        // visible and recoverable rather than silently succeeding.
        this.logger.error(
          `payout ${request.id}: release after submission failure also failed: ${
            releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
          }`,
        );
      }
      throw err;
    }

    const status = settled?.status ?? 'UNKNOWN';
    return {
      payoutRequestId: request.id,
      status,
      paid: status === 'PAID',
      amount: available,
      currency: PAYOUT_CURRENCY,
      allocationCount: settled?.allocations?.length ?? 0,
    };
  }
}
