import {
  applyDimensionPolicy,
  PROHIBITED_DIMENSIONS,
  OTHER_VALUE,
} from '../dimensions';
import { registry } from '../metrics';
import {
  captureMetrics, captureDimensionViolations,
  withTestIdentity, restoreIdentity, resetMetrics,
} from '../testing';

// ─── PO-1A: cardinality policy ──────────────────────────────────────────────
// CloudWatch bills per custom metric, and a metric's cost is the product of its
// dimension values. A `tripId` dimension at 1,000 trips/day is ~30,000 metrics
// a month — a four-figure invoice and a dashboard nobody can read.
//
// A policy in a document gets violated. These tests exist because this one is
// code, and code is only a policy if it is tested.

describe('dimension policy — prohibited names', () => {
  let violations: ReturnType<typeof captureDimensionViolations>;

  beforeEach(() => { violations = captureDimensionViolations(); });
  afterEach(() => violations.stop());

  it.each([
    ['tripId'], ['riderId'], ['driverId'], ['paymentIntentId'], ['recoveryId'],
    ['requestId'], ['correlationId'], ['traceId'], ['userId'], ['sessionId'],
  ])('drops the unbounded identifier %s', (dim) => {
    const out = applyDimensionPolicy('m', { [dim]: 'abc-123', outcome: 'ok' });

    expect(out).toEqual({ outcome: 'ok' });
    expect(violations.all()).toEqual([
      { metric: 'm', dimension: dim, reason: 'prohibited' },
    ]);
  });

  it.each([
    ['error'], ['errorMessage'], ['message'], ['stack'], ['url'], ['path'], ['query'],
  ])('drops the free-text dimension %s', (dim) => {
    expect(applyDimensionPolicy('m', { [dim]: 'anything at all' })).toEqual({});
  });

  it.each([
    ['lat'], ['lng'], ['latitude'], ['longitude'], ['location'],
  ])('drops the location dimension %s', (dim) => {
    expect(applyDimensionPolicy('m', { [dim]: '40.7357' })).toEqual({});
  });

  it.each([
    ['phone'], ['email'], ['firstName'], ['ip'], ['address'],
  ])('drops the PII dimension %s', (dim) => {
    expect(applyDimensionPolicy('m', { [dim]: 'x' })).toEqual({});
  });

  it('matches case-insensitively — TripId is the same mistake as tripId', () => {
    expect(applyDimensionPolicy('m', { TripId: 'x', TRIPID: 'y', tripid: 'z' })).toEqual({});
  });

  it('drops the offending key rather than replacing it with a placeholder', () => {
    // Keeping the key would imply the dimension is legitimate.
    const out = applyDimensionPolicy('m', { tripId: 'x' });

    expect(Object.keys(out)).toHaveLength(0);
  });

  it('allows the bounded dimensions the catalog actually uses', () => {
    const labels = {
      outcome: 'failed', status: 'unresolved', resolution: 'awaiting_capture',
      source: 'recovery', stage: 'accepted', channel: 'sms', vendor: 'stripe',
      dependency: 'postgres', error_type: 'StripeCardError', method: 'GET',
    };

    expect(applyDimensionPolicy('m', labels)).toEqual(labels);
  });
});

describe('dimension policy — allow-listed values', () => {
  let violations: ReturnType<typeof captureDimensionViolations>;

  beforeEach(() => { violations = captureDimensionViolations(); });
  afterEach(() => violations.stop());

  const policy = { outcome: ['succeeded', 'failed', 'unknown'] as const };

  it('passes a known value through', () => {
    expect(applyDimensionPolicy('m', { outcome: 'failed' }, policy))
      .toEqual({ outcome: 'failed' });
  });

  it('collapses an unknown value to `other` rather than minting a series', () => {
    const out = applyDimensionPolicy('m', { outcome: 'brand_new_state' }, policy);

    expect(out).toEqual({ outcome: OTHER_VALUE });
    expect(violations.all()).toEqual([
      { metric: 'm', dimension: 'outcome', reason: 'unknown_value' },
    ]);
  });

  it('leaves dimensions with no declared allow-list alone', () => {
    expect(applyDimensionPolicy('m', { outcome: 'failed', method: 'GET' }, policy))
      .toEqual({ outcome: 'failed', method: 'GET' });
  });

  it('coerces non-string values instead of throwing', () => {
    expect(applyDimensionPolicy('m', { count: 5 as unknown as string }))
      .toEqual({ count: '5' });
  });

  it.each([
    ['null', null], ['undefined', undefined], ['a string', 'nope'], ['a number', 7],
  ])('never throws on %s labels', (_l, labels) => {
    expect(() => applyDimensionPolicy('m', labels as never)).not.toThrow();
    expect(applyDimensionPolicy('m', labels as never)).toEqual({});
  });

  it('a reporter that throws does not break emission', () => {
    violations.stop();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { onDimensionViolation } = require('../dimensions');
    onDimensionViolation(() => { throw new Error('reporter exploded'); });

    expect(() => applyDimensionPolicy('m', { tripId: 'x' })).not.toThrow();

    onDimensionViolation(() => undefined);
  });
});

describe('dimension policy — enforced at the metric, not just the helper', () => {
  let capture: ReturnType<typeof captureMetrics>;

  beforeEach(() => {
    withTestIdentity();
    resetMetrics();
    capture = captureMetrics();
  });
  afterEach(() => { capture.stop(); restoreIdentity(); });

  it('a counter refuses a prohibited dimension end to end', () => {
    registry.counter('bidride_guarded_total', 'test').inc({ tripId: 'trip-1', outcome: 'ok' });

    const emitted = capture.named('bidride_guarded_total')[0];
    expect(emitted.dimensions).not.toHaveProperty('tripId');
    expect(emitted.dimensions.outcome).toBe('ok');
  });

  it('a gauge refuses a prohibited dimension', () => {
    const g = registry.gauge('bidride_guarded_gauge', 'test');
    g.set(1, { driverId: 'd-1', status: 'online' });
    registry.publishGauges();

    expect(capture.named('bidride_guarded_gauge')[0].dimensions).not.toHaveProperty('driverId');
  });

  it('a histogram refuses a prohibited dimension', () => {
    registry.histogram('bidride_guarded_seconds', 'test').observe(1, { requestId: 'r-1' });

    expect(capture.named('bidride_guarded_seconds')[0].dimensions).not.toHaveProperty('requestId');
  });

  it('a registered allow-list collapses drift at the metric', () => {
    registry
      .counter('bidride_policy_total', 'test', { outcome: ['ok', 'failed'] })
      .inc({ outcome: 'something_else' });

    expect(capture.named('bidride_policy_total')[0].dimensions.outcome).toBe(OTHER_VALUE);
  });

  it('get() reads back through the same policy', () => {
    const c = registry.counter('bidride_read_total', 'test');
    c.inc({ tripId: 'x', outcome: 'ok' });

    // The prohibited key was dropped on write, so it must be dropped on read.
    expect(c.get({ tripId: 'x', outcome: 'ok' })).toBe(1);
    expect(c.get({ outcome: 'ok' })).toBe(1);
  });

  it('the prohibited list covers every identifier the catalog names', () => {
    for (const d of ['tripid', 'riderid', 'driverid', 'paymentintentid', 'requestid']) {
      expect(PROHIBITED_DIMENSIONS.has(d)).toBe(true);
    }
  });
});
