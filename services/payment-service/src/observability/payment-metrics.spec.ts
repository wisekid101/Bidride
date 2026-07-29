import { registry, testing } from '@bidride/observability';
import { paymentMetrics, stripeErrorType } from './payment-metrics';

// ─── PO-1B: payment metric contract ─────────────────────────────────────────
// These assert the two properties that make the catalog safe rather than
// expensive: every dimension value is bounded, and no identifier can ever
// become a dimension. CloudWatch bills per custom metric, so a `tripId` leaking
// into a label is the difference between $30 a month and four figures.

describe('payment metrics — dimension policy', () => {
  let capture: ReturnType<typeof testing.captureMetrics>;

  beforeEach(() => {
    testing.withTestIdentity();
    capture = testing.captureMetrics();
  });
  afterEach(() => { capture.stop(); testing.restoreIdentity(); });

  it.each([
    ['tripId'], ['paymentIntentId'], ['riderId'], ['recoveryId'], ['requestId'],
  ])('refuses the identifier %s as a dimension', (dim) => {
    paymentMetrics.captureTotal.inc({ outcome: 'failed', [dim]: 'sensitive-value' });

    const emitted = capture.named('bidride_payment_capture_total')[0];
    expect(emitted.dimensions).not.toHaveProperty(dim);
    expect(JSON.stringify(emitted.dimensions)).not.toContain('sensitive-value');
    expect(emitted.dimensions.outcome).toBe('failed');
  });

  it.each([
    ['captureTotal', 'outcome', 'not_a_real_outcome'],
    ['bookingTotal', 'outcome', 'invented'],
    ['recoveryTickTotal', 'action', 'made_up'],
    ['webhookTotal', 'event_type', 'invoice.paid'],
  ])('%s collapses an unknown %s to `other`', (metric, dim, value) => {
    (paymentMetrics as Record<string, { inc: (l: Record<string, string>) => void }>)[metric]
      .inc({ [dim]: value });

    const all = capture.all();
    expect(all[all.length - 1].dimensions[dim]).toBe('other');
  });

  it.each([
    ['succeeded'], ['failed'], ['unknown'],
  ])('capture outcome %s passes through', (outcome) => {
    paymentMetrics.captureTotal.inc({ outcome });

    expect(capture.named('bidride_payment_capture_total')[0].dimensions.outcome).toBe(outcome);
  });

  it.each([
    ['created'], ['already_booked'], ['healed_ledger'],
  ])('booking outcome %s passes through', (outcome) => {
    paymentMetrics.bookingTotal.inc({ outcome, source: 'capture' });

    expect(capture.named('bidride_payment_booking_total')[0].dimensions.outcome).toBe(outcome);
  });

  it.each([
    ['ran'], ['skipped_lock_held'], ['skipped_redis_unavailable'],
  ])('tick action %s passes through', (action) => {
    paymentMetrics.recoveryTickTotal.inc({ action });

    expect(capture.named('bidride_payment_recovery_tick_total')[0].dimensions.action).toBe(action);
  });

  it('every metric name is registered under the bidride_payment_ prefix', () => {
    const names = [
      'bidride_payment_capture_total',
      'bidride_payment_capture_failure_total',
      'bidride_payment_booking_total',
      'bidride_payment_booking_conflict_total',
      'bidride_payment_fare_validation_failure_total',
      'bidride_payment_recovery_items',
      'bidride_payment_recovery_oldest_age_seconds',
      'bidride_payment_recovery_resolution_total',
      'bidride_payment_recovery_tick_total',
      'bidride_payment_webhook_total',
      'bidride_payment_stripe_error_total',
    ];
    const text = registry.toPrometheusText();

    for (const n of names) expect(text).toContain(n);
  });

  it('counters emit on write; gauges do not', () => {
    paymentMetrics.captureTotal.inc({ outcome: 'succeeded' });
    paymentMetrics.recoveryItems.set(3, { status: 'unresolved', resolution: 'none' });

    expect(capture.named('bidride_payment_capture_total')).toHaveLength(1);
    expect(capture.named('bidride_payment_recovery_items')).toHaveLength(0);
  });

  it('gauges publish when sampled', () => {
    paymentMetrics.recoveryItems.set(3, { status: 'unresolved', resolution: 'none' });

    paymentMetrics.recoveryItems.publish();

    expect(capture.named('bidride_payment_recovery_items')[0]).toMatchObject({ value: 3 });
  });
});

describe('stripeErrorType', () => {
  it.each([
    ['a Stripe SDK error', { type: 'StripeCardError' }, 'StripeCardError'],
    ['a named error', Object.assign(new Error('x'), { name: 'TimeoutError' }), 'TimeoutError'],
    ['an unclassifiable throw', {}, 'unknown'],
    ['null', null, 'unknown'],
    ['a string throw', 'boom', 'unknown'],
  ])('maps %s to a bounded value', (_l, input, expected) => {
    expect(stripeErrorType(input)).toBe(expected);
  });
});
