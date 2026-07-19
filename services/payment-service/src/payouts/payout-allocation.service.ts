import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BidiRide durable payout allocation (payout integrity, Commit 2).
 *
 * Reserves whole, immutable driver-earning ledger entries against an idempotent
 * PayoutRequest, creating a durable ALLOCATED boundary between EARNED funds
 * (canonical FinancialLedger) and money set aside for a future external payout.
 *
 * This service is INTERNAL ONLY and has NO production caller: no controller,
 * endpoint, scheduler, cron, or queue. It sends no money, calls no Stripe API,
 * writes NO FinancialLedger debit at allocation, and never reads DriverWallet
 * for authorization. PAYOUTS_ENABLED continues to gate all real execution.
 *
 * ACCOUNTING MODEL — Account-Balance authorization (Option 1):
 *   available = Σ eligible driver-earning credits (past 2h hold)
 *             − Σ ALL canonical driver debits (payout, adjustment, reversal, ...)
 *             − Σ RESERVED (not-yet-debited) allocation amounts
 * A PAID allocation is NOT double-subtracted: once paid, its value is removed by
 * a canonical driver debit (written in a later milestone), so PAID is excluded
 * from the RESERVED set. A paid earning is still permanently excluded from
 * SELECTION (it is in the CONSUMED set + partial unique index), so it can never
 * be re-allocated.
 */

// The 2h earnings hold is an existing production rule (see
// RECENT_EARNINGS_HOLD_HOURS in payment.service.ts and HOLD_HOURS in
// wallet.service.ts). We apply the SAME hold; we do not invent a new policy.
export const EARNINGS_HOLD_HOURS = 2;

// Statuses that permanently/actively CONSUME an earning: used for selection
// exclusion and the partial unique index. A consumed earning (reserved OR paid)
// can never be re-allocated.
export const CONSUMED_ALLOCATION_STATUSES = ['ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PAID'];

// Statuses that RESERVE funds but are NOT yet settled by a canonical debit:
// subtracted from availability. PAID is intentionally excluded — a paid payout
// is accounted by its canonical driver debit, so counting PAID here too would
// double-subtract the same money.
export const RESERVED_ALLOCATION_STATUSES = ['ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED'];

const SUPPORTED_CURRENCIES = ['usd'];

const REQ = { CREATED: 'CREATED', ALLOCATED: 'ALLOCATED', RELEASED: 'RELEASED', CANCELED: 'CANCELED' } as const;
const ALLOC = { ALLOCATED: 'ALLOCATED', RELEASED: 'RELEASED', CANCELED: 'CANCELED' } as const;

/** Money is Prisma Decimal in the DB; compare in integer cents, never floats. */
function toCents(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new BadRequestException({ code: 'invalid_amount', message: 'Amount must be a finite number.' });
  }
  const cents = amount * 100;
  const rounded = Math.round(cents);
  if (Math.abs(cents - rounded) > 1e-6) {
    throw new BadRequestException({ code: 'sub_cent_amount', message: 'Amount must be whole cents.' });
  }
  return rounded;
}
const decToCents = (d: Prisma.Decimal | number | string | null): number => Math.round(Number(d ?? 0) * 100);
const centsToAmount = (c: number): number => Math.round(c) / 100;

type LedgerClient = Pick<PrismaService, 'financialLedger' | 'payoutAllocation'>;

export interface AllocateInput {
  driverId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  initiatorType: string;
  initiatorId?: string | null;
  reason: string;
}

export interface ReleaseInput {
  payoutRequestId: string;
  reason: string;
  initiatorType: string;
  initiatorId?: string | null;
}

@Injectable()
export class PayoutAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Canonical available balance (account-balance model). Reads ONLY the ledger
   * and active reservations — never DriverWallet. Safe to call on the base
   * client (read) or a transaction client (authoritative, under advisory lock).
   */
  private async computeAvailableCents(client: LedgerClient, driverId: string, currency: string): Promise<number> {
    const holdCutoff = new Date(Date.now() - EARNINGS_HOLD_HOURS * 3600 * 1000);
    const credits = await client.financialLedger.aggregate({
      _sum: { amount: true },
      where: {
        accountType: 'driver', accountId: driverId, direction: 'credit',
        entryType: 'driver_earning', currency, createdAt: { lt: holdCutoff },
      },
    });
    const debits = await client.financialLedger.aggregate({
      _sum: { amount: true },
      where: { accountType: 'driver', accountId: driverId, direction: 'debit', currency },
    });
    const reserved = await client.payoutAllocation.aggregate({
      _sum: { amount: true },
      where: { driverId, currency, status: { in: RESERVED_ALLOCATION_STATUSES } },
    });
    return decToCents(credits._sum.amount) - decToCents(debits._sum.amount) - decToCents(reserved._sum.amount);
  }

  /** Public read helper (dollars). No side effects; usable by future milestones/tests. */
  async getAvailableBalance(driverId: string, currency = 'usd'): Promise<number> {
    return centsToAmount(await this.computeAvailableCents(this.prisma, driverId, currency));
  }

  /**
   * Reserve eligible whole earnings totalling EXACTLY the requested amount.
   * Idempotent on idempotencyKey. Whole-earning only: an earning is either fully
   * allocated or not at all — never split. If the deterministic oldest-first
   * selection cannot form the exact requested amount from complete earnings, the
   * request is REJECTED rather than splitting an earning.
   */
  async allocate(input: AllocateInput) {
    const { driverId, currency, idempotencyKey, initiatorType, initiatorId = null, reason } = input;
    const requestedCents = toCents(input.amount);
    if (requestedCents <= 0) {
      throw new BadRequestException({ code: 'non_positive_amount', message: 'Amount must be greater than zero.' });
    }
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new BadRequestException({ code: 'unsupported_currency', message: `Unsupported currency: ${currency}` });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Per-driver serialization: only one allocation flow per driver at a time.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${driverId}))`;

        // Idempotency: an existing request with this key short-circuits.
        const existing = await tx.payoutRequest.findUnique({
          where: { idempotencyKey },
          include: { allocations: true },
        });
        if (existing) {
          if (
            existing.driverId !== driverId ||
            decToCents(existing.amount) !== requestedCents ||
            existing.currency !== currency
          ) {
            throw new ConflictException({
              code: 'idempotency_conflict',
              message: 'idempotencyKey reused with conflicting driver, amount, or currency.',
            });
          }
          return existing; // durable, idempotent result
        }

        // Account-balance authorization: credits − debits − reserved. FinancialLedger
        // is canonical; DriverWallet is never consulted.
        const availableCents = await this.computeAvailableCents(tx, driverId, currency);
        if (requestedCents > availableCents) {
          throw new BadRequestException({
            code: 'insufficient_available_balance',
            message: `Requested ${centsToAmount(requestedCents)} exceeds available ${centsToAmount(availableCents)}.`,
          });
        }

        // Selectable earnings: unconsumed (not in the CONSUMED set), past the hold.
        const holdCutoff = new Date(Date.now() - EARNINGS_HOLD_HOURS * 3600 * 1000);
        const selectable = await tx.financialLedger.findMany({
          where: {
            accountType: 'driver', accountId: driverId, direction: 'credit',
            entryType: 'driver_earning', currency, createdAt: { lt: holdCutoff },
            allocations: { none: { status: { in: CONSUMED_ALLOCATION_STATUSES } } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, amount: true },
        });

        // Whole-earning oldest-first selection to an EXACT total.
        const selected: { id: string; cents: number }[] = [];
        let acc = 0;
        for (const e of selectable) {
          if (acc === requestedCents) break;
          const c = decToCents(e.amount);
          if (acc + c > requestedCents) {
            throw new BadRequestException({
              code: 'amount_not_formable_from_whole_earnings',
              message: 'Requested amount cannot be formed from complete earnings without splitting one.',
            });
          }
          acc += c;
          selected.push({ id: e.id, cents: c });
        }
        if (acc !== requestedCents) {
          throw new BadRequestException({
            code: 'amount_not_formable_from_whole_earnings',
            message: 'Requested amount cannot be formed from complete eligible earnings.',
          });
        }

        const resultingCents = availableCents - requestedCents;
        const now = new Date();
        const request = await tx.payoutRequest.create({
          data: {
            driverId,
            amount: centsToAmount(requestedCents),
            currency,
            status: REQ.ALLOCATED,
            idempotencyKey,
            initiatorType,
            initiatorId,
            reason,
            sourceAvailableBalance: centsToAmount(availableCents),
            resultingAvailableBalance: centsToAmount(resultingCents),
            allocatedAt: now,
          },
        });

        for (const sel of selected) {
          const alloc = await tx.payoutAllocation.create({
            data: {
              payoutRequestId: request.id,
              driverId,
              earningLedgerId: sel.id,
              amount: centsToAmount(sel.cents),
              currency,
              status: ALLOC.ALLOCATED,
              allocatedAt: now,
            },
          });
          // Immutable, append-only transition written in the SAME transaction.
          await tx.payoutAllocationTransition.create({
            data: {
              payoutAllocationId: alloc.id,
              payoutRequestId: request.id,
              driverId,
              fromStatus: null,
              toStatus: ALLOC.ALLOCATED,
              reason,
              initiatorType,
              initiatorId,
              correlationId: `payout:${request.id}:allocate:${sel.id}`,
            },
          });
        }

        return tx.payoutRequest.findUnique({ where: { id: request.id }, include: { allocations: true } });
      });
    } catch (e) {
      // Second line of defence: unique-constraint races resolve to the durable
      // existing request (idempotencyKey) or a loud conflict (active earning).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const already = await this.prisma.payoutRequest.findUnique({
          where: { idempotencyKey },
          include: { allocations: true },
        });
        if (already) return already;
        throw new ConflictException({
          code: 'earning_already_allocated',
          message: 'One of the selected earnings is already actively allocated.',
        });
      }
      throw e;
    }
  }

  /**
   * Release an entire ALLOCATED request, returning its reserved earnings to
   * availability. Idempotent: a second release is a no-op returning the released
   * state. No ledger or wallet entry is written; no Stripe call is made. Commit 2
   * releases the whole request atomically (no partial release).
   */
  async releasePayoutRequest(input: ReleaseInput) {
    const { payoutRequestId, reason, initiatorType, initiatorId = null } = input;
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUnique({
        where: { id: payoutRequestId },
        include: { allocations: true },
      });
      if (!request) {
        throw new NotFoundException({ code: 'payout_request_not_found', message: 'Payout request not found.' });
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.driverId}))`;

      // Idempotent: already released -> return current state, no new transitions.
      if (request.status === REQ.RELEASED) {
        return tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
      }
      if (request.status !== REQ.ALLOCATED) {
        throw new BadRequestException({
          code: 'not_releasable',
          message: `Only ALLOCATED requests can be released (status=${request.status}).`,
        });
      }

      const now = new Date();
      for (const alloc of request.allocations) {
        if (alloc.status !== ALLOC.ALLOCATED) continue;
        const changed = await tx.payoutAllocation.updateMany({
          where: { id: alloc.id, status: ALLOC.ALLOCATED }, // atomic guard
          data: { status: ALLOC.RELEASED, releasedAt: now, releaseReason: reason },
        });
        if (changed.count === 1) {
          await tx.payoutAllocationTransition.create({
            data: {
              payoutAllocationId: alloc.id,
              payoutRequestId: request.id,
              driverId: request.driverId,
              fromStatus: ALLOC.ALLOCATED,
              toStatus: ALLOC.RELEASED,
              reason,
              initiatorType,
              initiatorId,
              correlationId: `payout:${request.id}:release:${alloc.earningLedgerId}`,
            },
          });
        }
      }

      await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: { status: REQ.RELEASED, releasedAt: now },
      });

      return tx.payoutRequest.findUnique({ where: { id: payoutRequestId }, include: { allocations: true } });
    });
  }
}
