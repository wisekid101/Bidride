import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { BidStatus } from '@bidride/database/generated/client';
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
 * F5 — canonical capture validation, extracted verbatim from
 * PaymentService.captureAuthorizationHold so recovery can reuse it rather than
 * grow a second implementation of the rule that decides how much may move.
 *
 * Behaviour is unchanged: same checks, same order, same FARE_INTEGRITY_ERROR
 * response, same fare_integrity_error TripEvent, same cent-exact comparison.
 * The only thing that moved is where the code lives.
 *
 * The caller-supplied amount is never trusted and never adjusted. The trip's
 * persisted finalFare is the sole authority — not the authorization amount, and
 * emphatically not CaptureRecovery.expectedAmountCents, which is evidence of
 * what was once attempted and nothing more.
 */

/** The subset of PrismaService these helpers touch. */
export interface ValidationPrisma {
  trip: { findUnique: PrismaDelegateMethod };
  tripEvent: { create: PrismaDelegateMethod };
}

export interface ValidationDeps {
  prisma: ValidationPrisma;
  logger: Logger;
}

/**
 * Fare integrity violations block money movement but must never lose the
 * evidence: persist a trip event with the amounts involved.
 */
export async function recordFareIntegrityError(
  deps: ValidationDeps,
  tripId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  deps.logger.error(`FARE INTEGRITY ERROR trip=${tripId}: ${JSON.stringify(metadata)}`);
  try {
    await deps.prisma.tripEvent.create({
      data: { tripId, eventType: 'fare_integrity_error', metadata: metadata as object },
    });
  } catch (e) {
    deps.logger.error(`Failed to persist fare_integrity_error for trip ${tripId}`, e as Error);
  }
}

/**
 * Assert that `amountCents` is exactly the trip's canonical fare in cents.
 *
 * Throws UnprocessableEntityException({ code: 'FARE_INTEGRITY_ERROR' }) and
 * records the evidence otherwise. Returns the canonical amount so callers never
 * need to recompute it.
 *
 * `paymentIntentId` is carried only so the recorded evidence names the intent
 * involved; it is not validated here.
 */
export async function assertCanonicalCaptureAmount(
  deps: ValidationDeps,
  tripId: string,
  amountCents: number,
  paymentIntentId: string | null = null,
): Promise<{ canonicalAmountCents: number }> {
  // ── 1. Request shape ──────────────────────────────────────────────────────
  // Defensive: the DTO enforces this at the HTTP boundary, but this is also
  // reachable directly and must never forward a malformed amount to Stripe.
  // Caller amounts are never silently rounded.
  if (typeof tripId !== 'string' || tripId.trim() === '') {
    throw new UnprocessableEntityException({
      code: 'FARE_INTEGRITY_ERROR',
      message: 'A trip id is required to capture an authorization hold.',
    });
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    await recordFareIntegrityError(deps, tripId, {
      reason: 'capture amount is not a positive safe integer number of cents',
      requestedAmountCents: Number.isFinite(amountCents) ? amountCents : String(amountCents),
      paymentIntentId,
    });
    paymentMetrics.fareValidationFailureTotal.inc({ reason: 'bad_amount' });
    throw new UnprocessableEntityException({
      code: 'FARE_INTEGRITY_ERROR',
      message: 'Capture amount must be a positive whole number of cents.',
    });
  }

  // ── 2. Canonical trip ─────────────────────────────────────────────────────
  // Smallest trustworthy query: trip.bidId is written only inside the accept
  // transactions, but the authoritative proof of acceptance is the winning
  // bid's own status, so both are read.
  const trip = await deps.prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      bidId: true,
      finalFare: true,
      winnerBid: { select: { status: true } },
    },
  });

  if (!trip) {
    // No relational Trip row exists, so a tripEvent cannot be written without
    // weakening database integrity. Log and reject instead.
    deps.logger.error(
      `FARE INTEGRITY ERROR trip=${tripId}: capture attempted for a trip that does not exist (pi=${paymentIntentId})`,
    );
    paymentMetrics.fareValidationFailureTotal.inc({ reason: 'trip_not_found' });
    throw new UnprocessableEntityException({
      code: 'FARE_INTEGRITY_ERROR',
      message: 'Trip not found — capture refused.',
    });
  }

  // PO-1B: this validator has three callers — capture, the webhook booking path
  // and recovery. Owning the metric HERE gives one emission site instead of
  // three, and guarantees no caller can forget it.
  const reject = async (
    reason: string,
    extra: Record<string, unknown> = {},
    metricReason = 'amount_mismatch',
  ): Promise<never> => {
    paymentMetrics.fareValidationFailureTotal.inc({ reason: metricReason });
    await recordFareIntegrityError(deps, tripId, {
      reason,
      bidId: trip.bidId,
      requestedAmountCents: amountCents,
      paymentIntentId,
      ...extra,
    });
    throw new UnprocessableEntityException({
      code: 'FARE_INTEGRITY_ERROR',
      message: 'Capture amount does not match the trip canonical fare — payment blocked.',
    });
  };

  if (trip.bidId == null) {
    await reject('capture attempted on a non-bid trip — standard rides settle via charge-trip', {}, 'non_bid_trip');
  }
  if (trip.winnerBid?.status !== BidStatus.accepted) {
    await reject('capture attempted before the bid was accepted', {
      bidStatus: trip.winnerBid?.status ?? null,
    }, 'bid_not_accepted');
  }
  if (trip.finalFare == null) {
    await reject('capture attempted with no canonical finalFare on the trip', {}, 'no_final_fare');
  }

  // ── 3. Cent-exact comparison ──────────────────────────────────────────────
  // The DTO carries integer cents, so the dollar-level 0.005 tolerance used by
  // chargeTrip does not apply: converting the canonical Decimal(8,2) to cents
  // removes the float error that tolerance exists to absorb.
  const canonicalFare = Number(trip.finalFare);
  const canonicalAmountCents = Math.round(canonicalFare * 100);
  if (!Number.isSafeInteger(canonicalAmountCents) || canonicalAmountCents <= 0) {
    await reject('canonical finalFare cannot be safely converted to cents', {
      tripFinalFare: Number.isFinite(canonicalFare) ? canonicalFare : String(canonicalFare),
    }, 'unsafe_cents');
  }
  if (canonicalAmountCents !== amountCents) {
    await reject('capture amount does not match canonical finalFare', {
      expectedAmountCents: canonicalAmountCents,
    });
  }

  return { canonicalAmountCents };
}
