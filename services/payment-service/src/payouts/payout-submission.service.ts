import { Injectable, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

/**
 * Bidiride retry-safe payout submission & exactly-once settlement (Commit 3).
 *
 * Moves a durable PayoutRequest from ALLOCATED through an external Stripe
 * Transfer to PAID, writing the canonical FinancialLedger payout debit exactly
 * once. INTERNAL ONLY — no controller, endpoint, scheduler, or production
 * caller; invoked directly by tests until an approved rollout milestone.
 *
 * Hard rules honoured: no Stripe call inside a DB transaction; PAYOUTS_ENABLED
 * gates before TX1 and immediately before the Stripe call; DriverWallet is
 * never read or written; ambiguity never auto-releases; definitive pre-transfer
 * failure atomically RELEASES; the ledger debit is atomic with PAID.
 */

// A minimal Stripe transfers surface — the real Stripe client satisfies it; tests inject a mock.
export interface StripeTransfer {
  id: string;
  object?: string;
  amount: number;
  currency: string;
  destination: string | null;
  transfer_group: string | null;
  reversed?: boolean;
  amount_reversed?: number;
  livemode?: boolean;
  metadata?: Record<string, string>;
  lastResponse?: { requestId?: string };
}
export interface StripeTransfersLike {
  transfers: {
    create(params: Record<string, unknown>, opts: { idempotencyKey: string }): Promise<StripeTransfer>;
    list(params: Record<string, unknown>): Promise<{ data: StripeTransfer[]; has_more?: boolean }>;
  };
}

export type ProviderClass =
  | 'CONFIRMED_SUCCESS'
  | 'DEFINITIVE_FAILURE'
  | 'RETRYABLE_FAILURE'
  | 'AMBIGUOUS_OUTCOME'
  | 'CONFIGURATION_FAILURE'
  | 'INTEGRITY_CONFLICT';

const REQ = {
  ALLOCATED: 'ALLOCATED', SUBMISSION_PENDING: 'SUBMISSION_PENDING', PAID: 'PAID',
  RELEASED: 'RELEASED', RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  SUBMISSION_BLOCKED: 'SUBMISSION_BLOCKED',
} as const;
const ALLOC = { ALLOCATED: 'ALLOCATED', SUBMISSION_PENDING: 'SUBMISSION_PENDING', PAID: 'PAID', RELEASED: 'RELEASED' } as const;

const cents = (d: Prisma.Decimal | number | string | null): number => Math.round(Number(d ?? 0) * 100);

@Injectable()
export class PayoutSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly stripe: StripeTransfersLike,
    private readonly config: ConfigService,
  ) {}

  private payoutsEnabled(): boolean {
    return this.config.get('PAYOUTS_ENABLED') === 'true';
  }

  private ledgerCorrelation(id: string): string { return `payout:${id}:ledger`; }
  private transferKey(id: string): string { return `payout:${id}:transfer`; }
  private transferGroup(id: string): string { return `bidiride:payout:${id}`; }

  /** Allowlisted, non-PII, non-secret summary of a Stripe transfer for the audit row. */
  private summarizeTransfer(t: StripeTransfer): Prisma.InputJsonObject {
    return {
      id: t.id, object: t.object ?? 'transfer', amount: t.amount, currency: t.currency,
      destination: t.destination ?? null, transfer_group: t.transfer_group ?? null,
      reversed: !!t.reversed, amount_reversed: t.amount_reversed ?? 0, livemode: !!t.livemode,
    };
  }
  private classifyError(e: unknown): { cls: ProviderClass; code: string; message: string } {
    const err = e as { type?: string; code?: string; statusCode?: number; message?: string };
    const type = err?.type ?? '';
    const code = err?.code ?? err?.type ?? 'unknown';
    const message = (err?.message ?? 'stripe error').slice(0, 480); // redacted length cap
    if (type === 'StripeConnectionError' || /timeout|ETIMEDOUT|ECONNRESET|socket hang up|network/i.test(err?.message ?? '')) {
      return { cls: 'AMBIGUOUS_OUTCOME', code, message };
    }
    if (type === 'StripeAuthenticationError' || type === 'StripePermissionError') {
      return { cls: 'CONFIGURATION_FAILURE', code, message };
    }
    if (type === 'StripeIdempotencyError') return { cls: 'AMBIGUOUS_OUTCOME', code, message };
    if (type === 'StripeRateLimitError' || err?.statusCode === 429 || (err?.statusCode ?? 0) >= 500) {
      return { cls: 'RETRYABLE_FAILURE', code, message };
    }
    if (type === 'StripeInvalidRequestError') return { cls: 'DEFINITIVE_FAILURE', code, message };
    // Unknown error type -> ambiguous (never assume no transfer was created).
    return { cls: 'AMBIGUOUS_OUTCOME', code, message };
  }

  // ─── PUBLIC: submit ────────────────────────────────────────────────────────
  async submitPayoutRequest(payoutRequestId: string) {
    if (!this.payoutsEnabled()) {
      throw new ServiceUnavailableException({ code: 'payouts_disabled', message: 'Payouts are disabled.' });
    }

    // TX1 — CLAIM (no Stripe here).
    const claim = await this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
      if (!request) throw new NotFoundException({ code: 'payout_request_not_found', message: 'Payout request not found.' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;

      if (request.status !== REQ.ALLOCATED) {
        // Not claimable now; hand back current state for the caller/reconciler.
        return { alreadyClaimed: true, request } as const;
      }
      const allocs = request.allocations;
      if (allocs.length === 0 || allocs.some((a) => a.status !== ALLOC.ALLOCATED)) {
        throw new BadRequestException({ code: 'allocations_not_allocated', message: 'Allocations are not all ALLOCATED.' });
      }
      if (allocs.reduce((s, a) => s + cents(a.amount), 0) !== cents(request.amount)) {
        throw new ConflictException({ code: 'allocation_total_mismatch', message: 'Allocation total does not match request amount.' });
      }
      const driver = await tx.driver.findUnique({ where: { id: request.driverId }, select: { stripeAccountId: true } });
      if (!driver?.stripeAccountId) {
        throw new BadRequestException({ code: 'no_destination_account', message: 'Driver has no Stripe destination account.' });
      }
      const now = new Date();
      const attemptNumber = request.attemptCount + 1;
      const idempotencyKey = this.transferKey(request.id);
      const transferGroup = this.transferGroup(request.id);

      // Atomic guarded claim: only ONE submitter may flip ALLOCATED ->
      // SUBMISSION_PENDING (defense-in-depth beyond the advisory lock and the
      // Stripe idempotency key; mirrors resumeBlockedPayoutRequest's flip).
      const claimed = await tx.payoutRequest.updateMany({
        where: { id: request.id, status: REQ.ALLOCATED },
        data: {
          status: REQ.SUBMISSION_PENDING, transferIdempotencyKey: idempotencyKey, transferGroup,
          destinationAccountId: driver.stripeAccountId, submissionStartedAt: now, attemptCount: attemptNumber,
        },
      });
      if (claimed.count !== 1) return { alreadyClaimed: true, request } as const; // lost a concurrent claim

      const attempt = await tx.payoutSubmissionAttempt.create({
        data: {
          payoutRequestId: request.id, attemptNumber, status: 'CLAIMED',
          idempotencyKey, transferGroup, amount: request.amount, currency: request.currency,
          destinationAccountId: driver.stripeAccountId, startedAt: now,
        },
      });
      for (const a of allocs) {
        const changed = await tx.payoutAllocation.updateMany({ where: { id: a.id, status: ALLOC.ALLOCATED }, data: { status: ALLOC.SUBMISSION_PENDING } });
        if (changed.count === 1) {
          await tx.payoutAllocationTransition.create({
            data: {
              payoutAllocationId: a.id, payoutRequestId: request.id, driverId: request.driverId,
              fromStatus: ALLOC.ALLOCATED, toStatus: ALLOC.SUBMISSION_PENDING, reason: 'submission_claimed',
              initiatorType: 'system', correlationId: `payout:${request.id}:claim:${a.earningLedgerId}`,
            },
          });
        }
      }
      return {
        alreadyClaimed: false, request, attemptId: attempt.id,
        params: {
          amount: cents(request.amount), currency: request.currency,
          destination: driver.stripeAccountId, transferGroup, idempotencyKey,
          driverId: request.driverId,
        },
      } as const;
    });

    if (claim.alreadyClaimed) return claim.request;
    return this.performExternalAndSettle(payoutRequestId, claim.attemptId!, claim.params);
  }

  /**
   * External Stripe call (OUTSIDE any DB transaction) + settlement/failure
   * routing. Shared by submit and resume. Rechecks PAYOUTS_ENABLED immediately
   * before the call: if disabled, this is an INTERNAL stop (no provider request
   * was sent) -> SUBMISSION_BLOCKED, kept distinct from provider ambiguity.
   */
  private async performExternalAndSettle(
    payoutRequestId: string,
    attemptId: string,
    p: { amount: number; currency: string; destination: string; transferGroup: string; idempotencyKey: string; driverId: string },
  ) {
    if (!this.payoutsEnabled()) {
      await this.finalizeBlocked(payoutRequestId, attemptId);
      return this.prisma.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
    }
    let transfer: StripeTransfer;
    try {
      transfer = await this.stripe.transfers.create(
        {
          amount: p.amount, currency: p.currency, destination: p.destination,
          transfer_group: p.transferGroup,
          metadata: { payout_request_id: payoutRequestId, driver_id: p.driverId },
        },
        { idempotencyKey: p.idempotencyKey },
      );
    } catch (e) {
      const { cls, code, message } = this.classifyError(e);
      if (cls === 'DEFINITIVE_FAILURE') {
        await this.settleFailureRelease(payoutRequestId, attemptId, code, message);
      } else if (cls === 'RETRYABLE_FAILURE') {
        await this.finalizeRetryable(payoutRequestId, attemptId, code, message);
      } else {
        // AMBIGUOUS_OUTCOME | CONFIGURATION_FAILURE -> reconciliation-required, funds reserved.
        await this.finalizeAmbiguous(payoutRequestId, attemptId, cls, code, message);
      }
      return this.prisma.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
    }
    return this.settle(payoutRequestId, attemptId, transfer);
  }

  /**
   * INTERNAL stop before any Stripe request (feature flag disabled after TX1).
   * Request SUBMISSION_PENDING -> SUBMISSION_BLOCKED; allocations stay
   * SUBMISSION_PENDING (reserved); NO Stripe call, NO ledger debit, NO release,
   * and NO provider identifiers. Distinct from RECONCILIATION_REQUIRED.
   */
  private async finalizeBlocked(payoutRequestId: string, attemptId: string) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, select: { driverId: true } });
      if (!request) return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;
      const now = new Date();
      await tx.payoutSubmissionAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'BLOCKED_BY_FEATURE_FLAG', errorCode: 'payouts_disabled',
          errorMessage: 'Submission stopped by an internal control before any Stripe request.', completedAt: now,
        },
      });
      await tx.payoutRequest.updateMany({
        where: { id: payoutRequestId, status: REQ.SUBMISSION_PENDING },
        data: { status: REQ.SUBMISSION_BLOCKED, lastErrorCode: 'payouts_disabled', lastErrorMessage: 'Blocked before submission (feature flag).' },
      });
    });
  }

  /**
   * Resume a SUBMISSION_BLOCKED request once payouts are re-enabled. Reuses the
   * persisted snapshot (amount/currency/destination/idempotencyKey/transferGroup);
   * never re-reads Driver.stripeAccountId. Atomic guarded flip prevents a
   * double-resume race. Internal-only; no controller/scheduler/caller.
   */
  async resumeBlockedPayoutRequest(payoutRequestId: string) {
    if (!this.payoutsEnabled()) {
      throw new ServiceUnavailableException({ code: 'payouts_disabled', message: 'Payouts are disabled.' });
    }
    const resume = await this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
      if (!request) throw new NotFoundException({ code: 'payout_request_not_found', message: 'Payout request not found.' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;
      if (request.status !== REQ.SUBMISSION_BLOCKED) return { resumed: false, request } as const;
      if (!request.transferIdempotencyKey || !request.transferGroup || !request.destinationAccountId) {
        throw new ConflictException({ code: 'incomplete_snapshot', message: 'Blocked request is missing its submission snapshot.' });
      }
      if (request.allocations.some((a) => a.status !== ALLOC.SUBMISSION_PENDING)) {
        throw new ConflictException({ code: 'allocations_not_pending', message: 'Allocations are not SUBMISSION_PENDING.' });
      }
      const attemptNumber = request.attemptCount + 1;
      const flipped = await tx.payoutRequest.updateMany({
        where: { id: payoutRequestId, status: REQ.SUBMISSION_BLOCKED },
        data: { status: REQ.SUBMISSION_PENDING, submissionStartedAt: new Date(), attemptCount: attemptNumber },
      });
      if (flipped.count !== 1) return { resumed: false, request } as const; // lost a concurrent resume race
      const attempt = await tx.payoutSubmissionAttempt.create({
        data: {
          payoutRequestId, attemptNumber, status: 'RESUMED',
          idempotencyKey: request.transferIdempotencyKey, transferGroup: request.transferGroup,
          amount: request.amount, currency: request.currency, destinationAccountId: request.destinationAccountId,
          startedAt: new Date(),
        },
      });
      return {
        resumed: true, attemptId: attempt.id,
        params: {
          amount: cents(request.amount), currency: request.currency, destination: request.destinationAccountId,
          transferGroup: request.transferGroup, idempotencyKey: request.transferIdempotencyKey, driverId: request.driverId,
        },
      } as const;
    });
    if (!resume.resumed) return this.prisma.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
    return this.performExternalAndSettle(payoutRequestId, resume.attemptId!, resume.params);
  }

  // ─── PUBLIC: reconcile (manual, internal-only) ─────────────────────────────
  async reconcilePayoutRequest(payoutRequestId: string) {
    if (!this.payoutsEnabled()) {
      throw new ServiceUnavailableException({ code: 'payouts_disabled', message: 'Payouts are disabled.' });
    }
    const request = await this.prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
    if (!request) throw new NotFoundException({ code: 'payout_request_not_found', message: 'Payout request not found.' });
    if (request.status === REQ.SUBMISSION_BLOCKED) {
      // Internal stop: no Stripe request was ever sent -> never list/retrieve/create.
      return { result: 'not_reconcilable', status: request.status };
    }
    if (request.status !== REQ.RECONCILIATION_REQUIRED && request.status !== REQ.SUBMISSION_PENDING) {
      return { result: 'not_reconcilable', status: request.status };
    }
    if (!request.transferGroup || !request.destinationAccountId) {
      return { result: 'missing_snapshot' };
    }

    // Stripe lookup (outside any DB tx). List by transfer_group + destination; paginate.
    const candidates: StripeTransfer[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.stripe.transfers.list({
        transfer_group: request.transferGroup, destination: request.destinationAccountId,
        limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      candidates.push(...res.data);
      if (!res.has_more || res.data.length === 0) break;
      startingAfter = res.data[res.data.length - 1].id;
    }

    // Validate candidates against snapshotted params.
    const valid = candidates.filter((t) =>
      t.transfer_group === request.transferGroup &&
      t.destination === request.destinationAccountId &&
      t.amount === cents(request.amount) &&
      t.currency === request.currency &&
      t.metadata?.payout_request_id === payoutRequestId,
    );
    if (valid.length === 0) {
      await this.appendAttempt(payoutRequestId, 'RECONCILIATION_NO_MATCH', undefined, undefined);
      return { result: 'no_match' }; // never auto-release, never auto-create
    }
    if (valid.length > 1) {
      await this.appendAttempt(payoutRequestId, 'RECONCILIATION_CONFLICT', undefined, undefined);
      return { result: 'conflict' }; // remains RECONCILIATION_REQUIRED
    }
    const transfer = valid[0];
    if (transfer.reversed || (transfer.amount_reversed ?? 0) > 0) {
      await this.appendAttempt(payoutRequestId, 'RECONCILIATION_REVERSED', transfer.id, undefined);
      return { result: 'reversed_candidate' }; // not settled as ordinary PAID; later reversal handling
    }
    // Settle idempotently through the same settlement path.
    const attempt = await this.appendAttempt(payoutRequestId, 'RECONCILIATION_RESOLVED', transfer.id, undefined);
    return this.settle(payoutRequestId, attempt.id, transfer);
  }

  // ─── settlement (TX2) — exactly-once ledger debit atomic with PAID ─────────
  private async settle(payoutRequestId: string, attemptId: string, transfer: StripeTransfer) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
      if (!request) throw new NotFoundException({ code: 'payout_request_not_found', message: 'Payout request not found.' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;

      // Provider result must match the request snapshot.
      if (transfer.amount !== cents(request.amount) || transfer.currency !== request.currency ||
          transfer.destination !== request.destinationAccountId || transfer.transfer_group !== request.transferGroup) {
        throw new ConflictException({ code: 'provider_result_mismatch', message: 'Stripe transfer does not match the payout request snapshot.' });
      }
      // Guard against a different already-stored transfer id.
      if (request.stripeTransferId && request.stripeTransferId !== transfer.id) {
        throw new ConflictException({ code: 'transfer_id_conflict', message: 'A different transfer id is already recorded.' });
      }

      const correlationId = this.ledgerCorrelation(payoutRequestId);
      const existing = await tx.financialLedger.findFirst({
        where: { correlationId, accountType: 'driver', direction: 'debit', entryType: 'payout' },
      });
      if (existing) {
        // Idempotent: validate the existing canonical entry before returning.
        if (existing.accountId !== request.driverId || cents(existing.amount) !== cents(request.amount)) {
          throw new ConflictException({ code: 'ledger_integrity_conflict', message: 'Existing payout ledger entry conflicts with this settlement.' });
        }
        // ensure PAID (idempotent no-op if already)
        if (request.status !== REQ.PAID) {
          await this.markPaid(tx, request, transfer, attemptId);
        }
        return tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
      }

      // Write the canonical payout journal EXACTLY ONCE (guarded by the ledger unique).
      await this.ledger.createEntriesTx(tx, [
        { correlationId, entryType: 'payout', accountType: 'driver', accountId: request.driverId, direction: 'debit', amount: Number(request.amount), payoutId: payoutRequestId, sourceEvent: 'payment:payout' },
        { correlationId, entryType: 'payout', accountType: 'platform', accountId: 'platform', direction: 'credit', amount: Number(request.amount), payoutId: payoutRequestId, sourceEvent: 'payment:payout' },
      ]);
      await this.markPaid(tx, request, transfer, attemptId);
      return tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
    });
  }

  private async markPaid(tx: Prisma.TransactionClient, request: { id: string; driverId: string; allocations: { id: string; status: string; earningLedgerId: string }[] }, transfer: StripeTransfer, attemptId: string) {
    const now = new Date();
    await tx.payoutRequest.update({
      where: { id: request.id },
      data: { status: REQ.PAID, stripeTransferId: transfer.id, lastProviderRequestId: transfer.lastResponse?.requestId ?? null, paidAt: now },
    });
    for (const a of request.allocations) {
      const changed = await tx.payoutAllocation.updateMany({ where: { id: a.id, status: ALLOC.SUBMISSION_PENDING }, data: { status: ALLOC.PAID } });
      if (changed.count === 1) {
        await tx.payoutAllocationTransition.create({
          data: {
            payoutAllocationId: a.id, payoutRequestId: request.id, driverId: request.driverId,
            fromStatus: ALLOC.SUBMISSION_PENDING, toStatus: ALLOC.PAID, reason: 'payout_paid',
            initiatorType: 'system', correlationId: `payout:${request.id}:paid:${a.earningLedgerId}`,
          },
        });
      }
    }
    await tx.payoutSubmissionAttempt.update({
      where: { id: attemptId },
      data: { status: 'CONFIRMED_SUCCESS', stripeTransferId: transfer.id, providerRequestId: transfer.lastResponse?.requestId ?? null, providerResponse: this.summarizeTransfer(transfer), completedAt: now },
    });
  }

  // ─── definitive failure -> atomic RELEASE ──────────────────────────────────
  private async settleFailureRelease(payoutRequestId: string, attemptId: string, code: string, message: string) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
      if (!request) return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;
      if (request.status !== REQ.SUBMISSION_PENDING) return;
      const now = new Date();
      await tx.payoutSubmissionAttempt.update({ where: { id: attemptId }, data: { status: 'DEFINITIVE_FAILURE', errorCode: code, errorMessage: message, completedAt: now } });
      for (const a of request.allocations) {
        const changed = await tx.payoutAllocation.updateMany({ where: { id: a.id, status: ALLOC.SUBMISSION_PENDING }, data: { status: ALLOC.RELEASED, releasedAt: now, releaseReason: 'release_after_definitive_failure' } });
        if (changed.count === 1) {
          await tx.payoutAllocationTransition.create({
            data: {
              payoutAllocationId: a.id, payoutRequestId: request.id, driverId: request.driverId,
              fromStatus: ALLOC.SUBMISSION_PENDING, toStatus: ALLOC.RELEASED, reason: 'release_after_definitive_failure',
              initiatorType: 'system', correlationId: `payout:${request.id}:release:${a.earningLedgerId}`,
            },
          });
        }
      }
      await tx.payoutRequest.update({ where: { id: payoutRequestId }, data: { status: REQ.RELEASED, releasedAt: now, lastErrorCode: code, lastErrorMessage: message } });
    });
  }

  private async finalizeRetryable(payoutRequestId: string, attemptId: string, code: string, message: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${(await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, select: { driverId: true } }))?.driverId ?? ''}))`;
      await tx.payoutSubmissionAttempt.update({ where: { id: attemptId }, data: { status: 'RETRYABLE_FAILURE', errorCode: code, errorMessage: message, completedAt: new Date() } });
      await tx.payoutRequest.update({ where: { id: payoutRequestId }, data: { lastErrorCode: code, lastErrorMessage: message } });
      // request + allocations remain SUBMISSION_PENDING (reserved). No release.
    });
  }

  private async finalizeAmbiguous(payoutRequestId: string, attemptId: string, cls: ProviderClass, code: string, message: string) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, select: { driverId: true, status: true } });
      if (!request) return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;
      const now = new Date();
      await tx.payoutSubmissionAttempt.update({ where: { id: attemptId }, data: { status: cls, errorCode: code, errorMessage: message, completedAt: now } });
      // Request -> RECONCILIATION_REQUIRED; allocations STAY SUBMISSION_PENDING (reserved, Commit-2 invariant unchanged).
      if (request.status === REQ.SUBMISSION_PENDING) {
        await tx.payoutRequest.update({ where: { id: payoutRequestId }, data: { status: REQ.RECONCILIATION_REQUIRED, reconciliationRequiredAt: now, lastErrorCode: code, lastErrorMessage: message } });
      }
    });
  }

  private async appendAttempt(payoutRequestId: string, status: string, stripeTransferId?: string, errorCode?: string) {
    const req = await this.prisma.payoutRequest.findUnique({ where: { id: payoutRequestId }, select: { amount: true, currency: true, transferGroup: true, destinationAccountId: true, attemptCount: true } });
    return this.prisma.payoutSubmissionAttempt.create({
      data: {
        payoutRequestId, attemptNumber: (req?.attemptCount ?? 0) + 1, status,
        idempotencyKey: this.transferKey(payoutRequestId), transferGroup: req?.transferGroup ?? this.transferGroup(payoutRequestId),
        amount: req?.amount ?? 0, currency: req?.currency ?? 'usd', destinationAccountId: req?.destinationAccountId ?? null,
        stripeTransferId: stripeTransferId ?? null, errorCode: errorCode ?? null, startedAt: new Date(), completedAt: new Date(),
      },
    });
  }
}
