import { registry } from '@bidride/observability';

/**
 * Payment-domain metrics (PO-1B).
 *
 * Every metric here traces to a row in `docs/release/monitoring-guide.md` that
 * Operations polls by hand today. None was invented; if a signal is not on that
 * list it is not here.
 *
 * Each metric declares its allowed dimension VALUES. PO-1A collapses anything
 * unrecognised to `other` rather than minting a new series — CloudWatch bills
 * per custom metric, and drift in a dimension is what turns a $30 line item
 * into a four-figure one. Identifiers (tripId, paymentIntentId, recoveryId)
 * appear in logs and never here.
 *
 * Every metric has exactly ONE authoritative owner, named in its comment. That
 * is what stops a metric being incremented in both a method and its caller.
 */

/** Stripe errors we classify by name; anything else collapses to `other`. */
const STRIPE_ERROR_TYPES = [
  'StripeCardError',
  'StripeInvalidRequestError',
  'StripeIdempotencyError',
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeRateLimitError',
  'StripeConnectionError',
  'StripeAPIError',
  'TimeoutError',
  'UnexpectedCaptureStatus',
] as const;

/** The eight event types handleWebhookEvent actually handles. */
const WEBHOOK_EVENT_TYPES = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'charge.dispute.created',
  'account.updated',
  'payout.paid',
  'payout.failed',
] as const;

const RECOVERY_STATUSES = [
  'unresolved', 'resolved_captured', 'resolved_not_captured', 'needs_admin', 'closed',
] as const;

const RECOVERY_RESOLUTIONS = [
  'captured_and_booked', 'captured_already_booked', 'captured_ledger_healed',
  'stripe_reports_canceled', 'awaiting_capture', 'amount_mismatch',
  'payment_intent_mismatch', 'trip_missing', 'not_capturable',
  'hold_expired', 'handle_unresolvable', 'lookup_rejected', 'attempts_exhausted',
  'closed_by_admin',
] as const;

export const paymentMetrics = {
  /**
   * Capture attempts by authoritative outcome.
   * OWNER: PaymentService.captureAuthorizationHold (succeeded) and
   * recordCaptureOutcome (failed | unknown). Never the controller, never
   * trip-service — only this service knows what Stripe actually said.
   */
  captureTotal: registry.counter(
    'bidride_payment_capture_total',
    'Capture attempts by outcome',
    { outcome: ['succeeded', 'failed', 'unknown'] },
  ),

  /**
   * Capture failures with the Stripe classification attached.
   * OWNER: PaymentService.recordCaptureOutcome — the sole classifier.
   */
  captureFailureTotal: registry.counter(
    'bidride_payment_capture_failure_total',
    'Capture failures by outcome and Stripe error type',
    { outcome: ['failed', 'unknown'], stripe_error_type: [...STRIPE_ERROR_TYPES, 'unknown'] },
  ),

  /**
   * Bookings by outcome and by which path booked them.
   * OWNER: PaymentBookingService.bookCapturedPayment, at the OUTER method.
   * Emitting inside bookInTransaction would double-count every booking that
   * hits the P2002 retry.
   */
  bookingTotal: registry.counter(
    'bidride_payment_booking_total',
    'Payment bookings by outcome and source',
    {
      outcome: ['created', 'already_booked', 'healed_ledger'],
      source: ['capture', 'webhook', 'recovery'],
    },
  ),

  /**
   * Unique-constraint conflicts — the database preventing a duplicate.
   * OWNER: PaymentBookingService.bookCapturedPayment P2002 catch.
   * A steady trickle is healthy concurrency; a burst means something retries hard.
   */
  bookingConflictTotal: registry.counter(
    'bidride_payment_booking_conflict_total',
    'Booking conflicts resolved by a database constraint',
    { constraint: ['payment_trip', 'ledger_correlation', 'other'] },
  ),

  /**
   * F5 rejections, before Stripe is ever called.
   * OWNER: capture-validation.ts. It has three callers (capture, webhook,
   * recovery); owning it in the validator gives one call site, not three.
   */
  fareValidationFailureTotal: registry.counter(
    'bidride_payment_fare_validation_failure_total',
    'Canonical fare validation failures',
    {
      reason: [
        'bad_amount', 'trip_not_found', 'non_bid_trip', 'bid_not_accepted',
        'no_final_fare', 'unsafe_cents', 'amount_mismatch',
      ],
    },
  ),

  /**
   * Recovery worklist depth. OWNER: the scheduler, sampled on a locked tick.
   * A gauge is a level, not an event, so it is sampled rather than evented.
   */
  recoveryItems: registry.gauge(
    'bidride_payment_recovery_items',
    'Capture-recovery work items by status',
    { status: [...RECOVERY_STATUSES], resolution: [...RECOVERY_RESOLUTIONS, 'none'] },
  ),

  /**
   * Age of the longest-waiting unresolved item — the best single indicator of
   * scheduler health, because it rises whether the worker crashed, is blocked
   * on Redis, or is quietly skipping. OWNER: the scheduler.
   */
  recoveryOldestAgeSeconds: registry.gauge(
    'bidride_payment_recovery_oldest_age_seconds',
    'Age in seconds of the oldest unresolved capture-recovery item',
  ),

  /**
   * Terminal recovery transitions.
   * OWNER: CaptureRecoveryService.terminal — a single funnel with eleven call
   * sites, so every entry point (scheduler, admin recheck, webhook) is covered
   * once. Emitted AFTER the row update commits.
   */
  recoveryResolutionTotal: registry.counter(
    'bidride_payment_recovery_resolution_total',
    'Capture-recovery terminal transitions',
    { status: [...RECOVERY_STATUSES], resolution: [...RECOVERY_RESOLUTIONS] },
  ),

  /**
   * Scheduler ticks. OWNER: CaptureRecoveryScheduler.tick.
   * One emission per TICK, never per row — per-row counts belong to
   * recoveryResolutionTotal. `skipped_lock_held` is normal and expected;
   * sustained `skipped_redis_unavailable` means recovery has stalled silently.
   */
  recoveryTickTotal: registry.counter(
    'bidride_payment_recovery_tick_total',
    'Capture-recovery scheduler ticks by action',
    { action: ['ran', 'skipped_lock_held', 'skipped_redis_unavailable'] },
  ),

  /**
   * Stripe webhook deliveries. OWNER: PaymentService.handleWebhookEvent.
   * `duplicate` is a normal Stripe behaviour, not an error — but a spike in it
   * is worth seeing, which is why it is an outcome rather than a dropped event.
   */
  webhookTotal: registry.counter(
    'bidride_payment_webhook_total',
    'Stripe webhook deliveries by type and outcome',
    {
      event_type: [...WEBHOOK_EVENT_TYPES],
      outcome: ['processed', 'duplicate', 'unhandled', 'failed'],
    },
  ),

  /**
   * Every Stripe error, wherever it happens.
   * OWNER: each Stripe catch site — authorize, capture, retrieve.
   * StripeAuthenticationError here is a deployment abort condition.
   */
  stripeErrorTotal: registry.counter(
    'bidride_payment_stripe_error_total',
    'Stripe API errors by operation and type',
    {
      operation: ['authorize', 'capture', 'retrieve'],
      error_type: [...STRIPE_ERROR_TYPES, 'unknown'],
    },
  ),
};

/** Normalise an unknown throwable to a bounded error-type dimension value. */
export function stripeErrorType(e: unknown): string {
  const t = (e as { type?: unknown; name?: unknown })?.type
    ?? (e as { name?: unknown })?.name;
  return typeof t === 'string' && t !== '' ? t : 'unknown';
}
