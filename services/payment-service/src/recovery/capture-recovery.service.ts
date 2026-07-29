import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * F3b-1 — capture recovery, READ-ONLY with respect to Stripe.
 *
 * F3a made an uncertain capture visible. This turns each uncertainty into a
 * known fact by asking Stripe what actually happened, and records the answer.
 *
 * It NEVER calls paymentIntents.capture, never books a Payment row, never
 * touches the ledger and never moves money. Acting on the answer is F3b-2. That
 * boundary is deliberate: this checkpoint can be deployed and observed in
 * production without a single new line that can charge a rider.
 *
 * Nothing here invents an outcome either. `resolved_captured` is written only
 * when Stripe reports `succeeded`; `resolved_not_captured` only when Stripe
 * reports the hold is gone. Every ambiguous branch lands in `needs_admin`.
 */

export const RECOVERY_STATUS = {
  unresolved: 'unresolved',
  resolvedCaptured: 'resolved_captured',
  resolvedNotCaptured: 'resolved_not_captured',
  needsAdmin: 'needs_admin',
  closed: 'closed',
} as const;

export type RecoveryStatus = (typeof RECOVERY_STATUS)[keyof typeof RECOVERY_STATUS];

/** Audit events for terminal transitions. TripEvent stays append-only evidence. */
export const RECOVERY_EVENT_RESOLVED = 'payment_capture_recovered';
export const RECOVERY_EVENT_UNRESOLVED = 'payment_capture_recovery_failed';

/** Long enough for an in-flight capture to settle before we ask about it. */
export const FIRST_ATTEMPT_DELAY_MS = 30_000;

/** 1m, 5m, 15m, 1h, 6h. Index 0 is used after the first attempt. */
export const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];

export const MAX_ATTEMPTS = 6;

/** Stripe auto-cancels an uncaptured hold after ~7 days; stop a little short. */
export const HOLD_LIFETIME_MS = 7 * 24 * 3600 * 1000;
export const HOLD_SAFETY_MARGIN_MS = 6 * 3600 * 1000;

/** A single Stripe read may not hold up the whole tick. */
export const RETRIEVE_TIMEOUT_MS = 10_000;

export interface RecoveryRow {
  id: string;
  tripId: string;
  paymentIntentId: string | null;
  bidId: string | null;
  expectedAmountCents: number;
  status: string;
  attemptNumber: number;
  holdExpiresAt: Date | null;
}

export interface ResolveResult {
  id: string;
  tripId: string;
  status: RecoveryStatus;
  resolution: string;
  /** True when the row stays on the worklist for a later attempt. */
  retryScheduled: boolean;
}

@Injectable()
export class CaptureRecoveryService {
  private readonly logger = new Logger(CaptureRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: Stripe,
  ) {}

  // ─── Worklist entry ───────────────────────────────────────────────────────

  /**
   * Put a trip on the worklist. Called from the same transaction that writes
   * the F3a event, so evidence and work item cannot diverge.
   *
   * `tripId` is unique, so a trip already under recovery is left alone rather
   * than duplicated — a second failed attempt on the same trip is the same
   * piece of work.
   */
  async enqueue(
    tx: { captureRecovery: { findUnique: Function; create: Function; update: Function } },
    input: {
      tripId: string;
      paymentIntentId: string | null;
      bidId: string | null;
      expectedAmountCents: number;
      authorizedAt?: Date;
    },
  ): Promise<void> {
    const existing = await tx.captureRecovery.findUnique({ where: { tripId: input.tripId } });
    const nextAttemptAt = new Date(Date.now() + FIRST_ATTEMPT_DELAY_MS);

    if (existing) {
      // Only re-open work that is still open. A closed or resolved row is
      // history and must not be silently revived.
      if (existing.status !== RECOVERY_STATUS.unresolved) return;
      await tx.captureRecovery.update({
        where: { tripId: input.tripId },
        data: {
          nextAttemptAt,
          ...(input.paymentIntentId ? { paymentIntentId: input.paymentIntentId } : {}),
        },
      });
      return;
    }

    await tx.captureRecovery.create({
      data: {
        tripId: input.tripId,
        paymentIntentId: input.paymentIntentId,
        bidId: input.bidId,
        expectedAmountCents: input.expectedAmountCents,
        status: RECOVERY_STATUS.unresolved,
        attemptNumber: 0,
        nextAttemptAt,
        holdExpiresAt: new Date(
          (input.authorizedAt?.getTime() ?? Date.now()) + HOLD_LIFETIME_MS - HOLD_SAFETY_MARGIN_MS,
        ),
      },
    });
  }

  // ─── Resolution ───────────────────────────────────────────────────────────

  /**
   * Resolve one work item by asking Stripe what the PaymentIntent actually is.
   *
   * The caller is responsible for having claimed the row (see the scheduler's
   * conditional claim) — this method assumes it owns the row.
   */
  async resolveOne(row: RecoveryRow): Promise<ResolveResult> {
    const paymentIntentId = row.paymentIntentId ?? (await this.recoverHandle(row.tripId));

    if (!paymentIntentId) {
      // F3a records CAPTURE_HANDLE_MISSING with a null id, but the id is also
      // written durably at bid submission. If neither has it, no automated step
      // can identify the hold and a human must.
      return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'handle_unresolvable',
        'no payment-intent id on the work item, the failure event or the bid');
    }

    if (row.holdExpiresAt && row.holdExpiresAt.getTime() <= Date.now()) {
      return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'hold_expired',
        'the authorization hold lifetime elapsed before the outcome was resolved',
        paymentIntentId);
    }

    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.retrieveWithTimeout(paymentIntentId);
    } catch (e: unknown) {
      return this.afterLookupFailure(row, paymentIntentId, e);
    }

    return this.classify(row, pi);
  }

  /** Resolve straight from a Stripe webhook — the same classifier, no polling delay. */
  async resolveFromWebhook(paymentIntentId: string, stripeStatus: string): Promise<void> {
    const row = await this.prisma.captureRecovery.findFirst({
      where: { paymentIntentId, status: RECOVERY_STATUS.unresolved },
    });
    if (!row) return;

    // Webhooks carry the authoritative object, so no extra Stripe read is needed.
    await this.classify(row as RecoveryRow, {
      id: paymentIntentId,
      status: stripeStatus,
      amount_received: undefined,
    } as unknown as Stripe.PaymentIntent);
  }

  // ─── Stripe state → recovery state ────────────────────────────────────────

  private async classify(row: RecoveryRow, pi: Stripe.PaymentIntent): Promise<ResolveResult> {
    const observed = { stripeStatus: pi.status, paymentIntentId: pi.id ?? row.paymentIntentId };

    switch (pi.status) {
      case 'succeeded': {
        // Stripe says the money moved. That is a fact, not an assumption — but
        // BOOKING it (Payment row + ledger) is F3b-2. Here we only record it.
        const received = typeof pi.amount_received === 'number' ? pi.amount_received : null;
        if (received !== null && received > 0 && received !== row.expectedAmountCents) {
          return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'amount_mismatch',
            `captured ${received} cents against an expected ${row.expectedAmountCents}`,
            observed.paymentIntentId, { ...observed, amountReceivedCents: received });
        }
        return this.terminal(row, RECOVERY_STATUS.resolvedCaptured, 'stripe_reports_succeeded',
          'Stripe reports the capture succeeded; booking is deferred to F3b-2',
          observed.paymentIntentId, observed);
      }

      case 'requires_capture':
        // The hold is live and the capture never landed. Now KNOWN, but this
        // checkpoint may not capture, so a human decides.
        return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'awaiting_capture',
          'the hold is still capturable; capture is deferred to F3b-2',
          observed.paymentIntentId, observed);

      case 'canceled':
        return this.terminal(row, RECOVERY_STATUS.resolvedNotCaptured, 'stripe_reports_canceled',
          'the hold was cancelled or expired; no funds moved',
          observed.paymentIntentId, observed);

      case 'processing':
        // Genuinely still in flight. Wait rather than guess.
        return this.scheduleRetry(row, observed.paymentIntentId,
          'stripe reports the payment intent is still processing');

      default:
        // requires_payment_method, requires_action, requires_confirmation …
        return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'not_capturable',
          `the payment intent is ${pi.status} and cannot settle without intervention`,
          observed.paymentIntentId, observed);
    }
  }

  private async afterLookupFailure(
    row: RecoveryRow,
    paymentIntentId: string,
    error: unknown,
  ): Promise<ResolveResult> {
    const type = (error as { type?: string; name?: string })?.type
      ?? (error as { name?: string })?.name
      ?? null;

    // A rejected lookup means the id is wrong or the key is for another
    // account. Retrying cannot change that.
    if (type === 'StripeInvalidRequestError' || type === 'StripePermissionError'
      || type === 'StripeAuthenticationError') {
      return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'lookup_rejected',
        `Stripe rejected the lookup (${type})`, paymentIntentId);
    }

    if (row.attemptNumber >= MAX_ATTEMPTS) {
      return this.terminal(row, RECOVERY_STATUS.needsAdmin, 'attempts_exhausted',
        `could not reach Stripe in ${MAX_ATTEMPTS} attempts`, paymentIntentId);
    }

    return this.scheduleRetry(row, paymentIntentId,
      `Stripe lookup failed (${type ?? 'unknown error'})`);
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private async scheduleRetry(
    row: RecoveryRow,
    paymentIntentId: string | null,
    reason: string,
  ): Promise<ResolveResult> {
    const idx = Math.min(Math.max(row.attemptNumber - 1, 0), BACKOFF_MS.length - 1);
    await this.prisma.captureRecovery.update({
      where: { id: row.id },
      data: {
        nextAttemptAt: new Date(Date.now() + BACKOFF_MS[idx]),
        lastError: reason.slice(0, 200),
        ...(paymentIntentId ? { paymentIntentId } : {}),
      },
    });
    this.logger.warn(`capture recovery ${row.id} (trip ${row.tripId}) deferred: ${reason}`);
    return {
      id: row.id, tripId: row.tripId,
      status: RECOVERY_STATUS.unresolved, resolution: 'retry_scheduled', retryScheduled: true,
    };
  }

  private async terminal(
    row: RecoveryRow,
    status: RecoveryStatus,
    resolution: string,
    detail: string,
    paymentIntentId: string | null = row.paymentIntentId,
    extra: Record<string, unknown> = {},
  ): Promise<ResolveResult> {
    await this.prisma.captureRecovery.update({
      where: { id: row.id },
      data: {
        status, resolution, resolvedAt: new Date(),
        lastError: status === RECOVERY_STATUS.needsAdmin ? detail.slice(0, 200) : null,
        nextAttemptAt: null,
        ...(paymentIntentId ? { paymentIntentId } : {}),
      },
    });

    // Append-only audit, separate from the mutable work item.
    const eventType = status === RECOVERY_STATUS.resolvedCaptured
      ? RECOVERY_EVENT_RESOLVED
      : RECOVERY_EVENT_UNRESOLVED;
    try {
      await this.prisma.tripEvent.create({
        data: {
          tripId: row.tripId,
          eventType,
          metadata: {
            recoveryId: row.id,
            status,
            resolution,
            detail,
            paymentIntentId,
            expectedAmountCents: row.expectedAmountCents,
            attemptNumber: row.attemptNumber,
            resolvedAt: new Date().toISOString(),
            source: 'payment-service',
            ...extra,
          } as object,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to persist ${eventType} for trip ${row.tripId}`, e as Error);
    }

    this.logger.log(`capture recovery ${row.id} (trip ${row.tripId}) → ${status} (${resolution})`);
    return { id: row.id, tripId: row.tripId, status, resolution, retryScheduled: false };
  }

  // ─── Handle resolution ────────────────────────────────────────────────────

  /**
   * Find the PaymentIntent id when the work item has none.
   *
   * Redis holds it for 420s only, but it is written durably twice: into the F3a
   * failure event, and into `bid_submitted` inside the bid-creation transaction.
   * Redis was never the authority, which is why F3a could leave its lifecycle
   * alone.
   */
  private async recoverHandle(tripId: string): Promise<string | null> {
    const events = await this.prisma.tripEvent.findMany({
      where: {
        tripId,
        eventType: {
          in: [
            'payment_capture_outcome_unknown',
            'payment_capture_failed',
            'bid_submitted',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });

    for (const e of events) {
      const id = (e.metadata as { paymentIntentId?: unknown } | null)?.paymentIntentId;
      if (typeof id === 'string' && id !== '') return id;
    }
    return null;
  }

  private async retrieveWithTimeout(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.stripe.paymentIntents.retrieve(paymentIntentId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error('Stripe retrieve timed out'), { name: 'TimeoutError' })),
            RETRIEVE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ─── Admin operations ─────────────────────────────────────────────────────

  /** Re-run resolution now. Same implementation the scheduler uses. */
  async recheck(id: string): Promise<ResolveResult> {
    const row = await this.prisma.captureRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`No capture recovery item ${id}`);
    return this.resolveOne(row as RecoveryRow);
  }

  /**
   * Close a work item with a reason.
   *
   * An admin may stop tracking an item; an admin may NOT declare that a payment
   * succeeded or failed. Only Stripe's reported state produces those, which is
   * why the only status reachable here is `closed`.
   */
  async close(id: string, adminId: string, note: string): Promise<{ id: string; status: string }> {
    const row = await this.prisma.captureRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`No capture recovery item ${id}`);

    await this.prisma.captureRecovery.update({
      where: { id },
      data: {
        status: RECOVERY_STATUS.closed,
        resolution: 'closed_by_admin',
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
        nextAttemptAt: null,
        lastError: note.slice(0, 200),
      },
    });

    try {
      await this.prisma.tripEvent.create({
        data: {
          tripId: row.tripId,
          eventType: RECOVERY_EVENT_UNRESOLVED,
          metadata: {
            recoveryId: id,
            status: RECOVERY_STATUS.closed,
            resolution: 'closed_by_admin',
            detail: note.slice(0, 200),
            adminId,
            previousStatus: row.status,
            resolvedAt: new Date().toISOString(),
            source: 'admin',
          } as object,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to persist close audit for recovery ${id}`, e as Error);
    }

    return { id, status: RECOVERY_STATUS.closed };
  }
}
