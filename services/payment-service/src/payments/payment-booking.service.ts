import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { paymentMetrics } from '../observability/payment-metrics';

/**
 * A Prisma delegate method as these helpers use it: called with a query
 * argument object and resolving to whatever that query returns. Explicitly
 * shaped rather than `Function`, which accepts any function-like value —
 * including class declarations that throw when called without `new` — and
 * gives no safety at the call site.
 */
type PrismaDelegateMethod = (args?: any) => Promise<any>;


/**
 * The one place an offer-trip capture becomes a booked payment (F3b-2a).
 *
 * Before this, three paths booked the same money three different ways: capture
 * did `updateMany`-then-`create` with a fire-and-forget ledger write, the
 * `payment_intent.succeeded` webhook updated the Payment row and wrote NO ledger
 * at all, and recovery could not book anything. Adding a fourth would have made
 * "how many rows should exist" a question nobody could answer from one file.
 *
 * Two properties this guarantees that the old code did not:
 *
 *  1. ATOMIC. The Payment row and both ledger entries commit in one database
 *     transaction. "Payment exists, ledger missing" is no longer reachable for
 *     a new booking — and where history already contains one, it is healed.
 *
 *  2. LOUD. Ledger errors are never swallowed. The previous
 *     `void ledger.recordRiderPayment(...).catch(() => {})` meant a failed
 *     financial write left no trace anywhere.
 *
 * Idempotency is enforced by the DATABASE, not by these checks: `Payment.tripId`
 * is unique and FinancialLedger is unique on
 * (correlationId, accountId, direction). The reads below decide which outcome to
 * report; the constraints decide what is actually possible. A P2002 is an
 * expected concurrency result, not a failure.
 */

/** Every offer-trip capture booking shares this correlation — see CORRELATION_NOTE. */
export const captureCorrelationId = (tripId: string) => `capture:${tripId}`;

/**
 * CORRELATION_NOTE
 *
 * The correlation id is `capture:${tripId}` for the normal capture, the webhook
 * and recovery alike. It MUST NOT be varied per source: the ledger's uniqueness
 * is (correlationId, accountId, direction), so a `recovery:${tripId}`
 * correlation would sail straight past the constraint and book a second debit
 * and credit for the same money. Source and recoveryId go in metadata.
 */

export type BookingOutcome = 'created' | 'already_booked' | 'healed_ledger';

export type BookingSource = 'capture' | 'webhook' | 'recovery';

export interface BookCapturedPaymentInput {
  tripId: string;
  riderId: string;
  paymentIntentId: string;
  /** Canonical amount in cents — validated by F5 before it reaches here. */
  amountCents: number;
  source: BookingSource;
  recoveryId?: string;
}

/**
 * The trip already has a payment against a DIFFERENT PaymentIntent.
 *
 * Fail closed: two intents for one trip means either a duplicate authorization
 * or a mis-routed capture, and both need a human. Nothing is written.
 */
export class PaymentIntentMismatchError extends Error {
  constructor(readonly tripId: string, readonly existing: string, readonly incoming: string) {
    super(`trip ${tripId} is already booked against ${existing}, not ${incoming}`);
    this.name = 'PaymentIntentMismatchError';
  }
}

/** Prisma's P2002 — a unique constraint decided this for us. */
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/**
 * Which constraint fired, as a BOUNDED dimension value.
 *
 * Prisma reports the target in `meta.target`; anything unrecognised collapses
 * to `other` rather than becoming a new metric series.
 */
function conflictTarget(e: unknown): string {
  const target = (e as { meta?: { target?: unknown } })?.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  if (text.includes('trip_id')) return 'payment_trip';
  if (text.includes('correlation_id')) return 'ledger_correlation';
  return 'other';
}

const PLATFORM_ACCOUNT = 'platform';
const COMMISSION_RATE = 0.20;

@Injectable()
export class PaymentBookingService {
  private readonly logger = new Logger(PaymentBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Book a capture that Stripe has confirmed. Safe to call repeatedly.
   *
   * `tx` lets a caller compose this into a larger transaction; pass null and
   * one is opened here.
   */
  async bookCapturedPayment(
    tx: unknown | null,
    input: BookCapturedPaymentInput,
  ): Promise<{ outcome: BookingOutcome }> {
    const run = (client: unknown) => this.bookInTransaction(client, input);

    // PO-1B: the booking metric is emitted HERE, not inside bookInTransaction.
    // The P2002 path runs that method twice, so emitting there would count every
    // concurrent booking twice — a financial metric that overstates itself.
    // Emitted only after the transaction commits, so a rollback records nothing.
    try {
      const result = tx ? await run(tx) : await this.prisma.$transaction((t) => run(t));
      paymentMetrics.bookingTotal.inc({ outcome: result.outcome, source: input.source });
      return result;
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e;
      // Another writer won between our read and our write. The constraint did
      // its job; re-read and report what is now true rather than failing.
      paymentMetrics.bookingConflictTotal.inc({ constraint: conflictTarget(e) });
      this.logger.warn(
        `bookCapturedPayment: concurrent booking for trip ${input.tripId} — re-reading final state`,
      );
      const result = tx ? await run(tx) : await this.prisma.$transaction((t) => run(t));
      paymentMetrics.bookingTotal.inc({ outcome: result.outcome, source: input.source });
      return result;
    }
  }

  private async bookInTransaction(
    tx: unknown,
    input: BookCapturedPaymentInput,
  ): Promise<{ outcome: BookingOutcome }> {
    const client = tx as {
      payment: { findUnique: PrismaDelegateMethod; create: PrismaDelegateMethod };
      financialLedger: { findMany: PrismaDelegateMethod; create: PrismaDelegateMethod };
    };

    const amount = Math.round(input.amountCents) / 100;
    const correlationId = captureCorrelationId(input.tripId);

    const existing = await client.payment.findUnique({ where: { tripId: input.tripId } });

    if (existing && existing.stripePaymentIntentId !== input.paymentIntentId) {
      throw new PaymentIntentMismatchError(
        input.tripId, existing.stripePaymentIntentId, input.paymentIntentId,
      );
    }

    if (!existing) {
      await client.payment.create({
        data: {
          tripId: input.tripId,
          riderId: input.riderId,
          stripePaymentIntentId: input.paymentIntentId,
          amount,
          status: 'succeeded',
        },
      });
      await this.writeMissingLedgerEntries(client, input, amount, correlationId, []);
      return { outcome: 'created' };
    }

    // The payment is already booked against this intent. The ledger may or may
    // not have kept up — before F3b-2a the ledger write was fire-and-forget
    // outside the transaction, so a Payment row with no entries is a real
    // historical state and healing it is the point of this branch.
    const present = await client.financialLedger.findMany({
      where: { correlationId, entryType: 'rider_payment' },
      select: { accountId: true, direction: true },
    });

    if (present.length >= 2) return { outcome: 'already_booked' };

    await this.writeMissingLedgerEntries(client, input, amount, correlationId, present);
    return { outcome: 'healed_ledger' };
  }

  /**
   * Write whichever half of the double entry is absent.
   *
   * When both are missing this goes through LedgerService.createEntriesTx so the
   * balance assertion runs. Completing a half-written pair cannot satisfy that
   * assertion in isolation — the pair only balances once the existing row is
   * counted — so that single entry is written directly, with the mirror row
   * already in the database.
   */
  private async writeMissingLedgerEntries(
    client: { financialLedger: { create: PrismaDelegateMethod } },
    input: BookCapturedPaymentInput,
    amount: number,
    correlationId: string,
    present: Array<{ accountId: string; direction: string }>,
  ): Promise<void> {
    const has = (accountId: string, direction: string) =>
      present.some((p) => p.accountId === accountId && p.direction === direction);

    const metadata = {
      source: input.source,
      paymentIntentId: input.paymentIntentId,
      ...(input.recoveryId ? { recoveryId: input.recoveryId } : {}),
    };

    const debit = {
      correlationId,
      entryType: 'rider_payment',
      accountType: 'rider',
      accountId: input.riderId,
      direction: 'debit',
      amount,
      tripId: input.tripId,
      sourceEvent: 'payment:capture',
      metadata,
    };
    const credit = {
      correlationId,
      entryType: 'rider_payment',
      accountType: 'platform',
      accountId: PLATFORM_ACCOUNT,
      direction: 'credit',
      amount,
      tripId: input.tripId,
      sourceEvent: 'payment:capture',
      metadata: {
        ...metadata,
        commission: Math.round(amount * COMMISSION_RATE * 100) / 100,
      },
    };

    const needDebit = !has(input.riderId, 'debit');
    const needCredit = !has(PLATFORM_ACCOUNT, 'credit');

    if (needDebit && needCredit) {
      await this.ledger.createEntriesTx(client as never, [debit, credit] as never);
      return;
    }
    if (needDebit) await client.financialLedger.create({ data: debit });
    if (needCredit) await client.financialLedger.create({ data: credit });
  }
}
