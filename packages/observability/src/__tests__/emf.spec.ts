import { buildEmfRecord, emitEmf, emitMetric, setEmfSink, EMF_NAMESPACE } from '../emf';
import { registry } from '../metrics';
import { withCorrelation } from '../correlation';
import { captureMetrics, withTestIdentity, restoreIdentity, resetMetrics } from '../testing';

// ─── PO-1A: CloudWatch Embedded Metric Format ───────────────────────────────
// EMF is a JSON line on stdout that CloudWatch parses into metrics. The
// envelope shape is a contract with AWS: get the `_aws` block wrong and the
// metrics silently never appear, which is the worst possible failure mode for
// observability. These tests pin the shape.

describe('EMF record', () => {
  beforeEach(withTestIdentity);
  afterEach(restoreIdentity);

  it('carries the _aws envelope CloudWatch looks for', () => {
    const r = buildEmfRecord([{ name: 'bidride_test_total', value: 3 }], {}, 1_700_000_000_000)!;

    expect(r._aws.Timestamp).toBe(1_700_000_000_000);
    expect(r._aws.CloudWatchMetrics).toHaveLength(1);
    expect(r._aws.CloudWatchMetrics[0].Namespace).toBe(EMF_NAMESPACE);
    expect(r._aws.CloudWatchMetrics[0].Metrics).toEqual([
      { Name: 'bidride_test_total', Unit: 'Count' },
    ]);
    expect(r.bidride_test_total).toBe(3);
  });

  it('always dimensions by service and env', () => {
    // Without these, two services emitting the same metric name sum into one
    // meaningless number.
    const r = buildEmfRecord([{ name: 'm', value: 1 }])!;

    expect(r._aws.CloudWatchMetrics[0].Dimensions[0]).toEqual(['service', 'env']);
    expect(r.service).toBe('test-service');
    expect(r.env).toBe('test');
  });

  it('adds caller dimensions after the identity dimensions', () => {
    const r = buildEmfRecord([{ name: 'm', value: 1 }], { outcome: 'failed' })!;

    expect(r._aws.CloudWatchMetrics[0].Dimensions[0]).toEqual(['service', 'env', 'outcome']);
    expect(r.outcome).toBe('failed');
  });

  it('carries version and commitSha as context, NOT as dimensions', () => {
    // They belong in Logs Insights, not in the metric's cardinality — a deploy
    // must not double the series count.
    const r = buildEmfRecord([{ name: 'm', value: 1 }])!;

    expect(r.version).toBe('0.0.0-test');
    expect(r.commitSha).toBe('testsha');
    expect(r._aws.CloudWatchMetrics[0].Dimensions[0]).not.toContain('version');
    expect(r._aws.CloudWatchMetrics[0].Dimensions[0]).not.toContain('commitSha');
  });

  it('attaches the correlation id when one is in scope', () => {
    const r = withCorrelation('corr-1', () => buildEmfRecord([{ name: 'm', value: 1 }])!);

    expect(r.correlationId).toBe('corr-1');
    expect(r._aws.CloudWatchMetrics[0].Dimensions[0]).not.toContain('correlationId');
  });

  it('omits correlationId entirely when there is no context', () => {
    expect(buildEmfRecord([{ name: 'm', value: 1 }])!.correlationId).toBeUndefined();
  });

  it('returns null for an empty metric list rather than an empty record', () => {
    expect(buildEmfRecord([])).toBeNull();
  });

  it('batches metrics that share a dimension set into one record', () => {
    const r = buildEmfRecord([
      { name: 'a', value: 1 },
      { name: 'b', value: 2, unit: 'Seconds' },
    ], { outcome: 'ok' })!;

    expect(r._aws.CloudWatchMetrics[0].Metrics).toEqual([
      { Name: 'a', Unit: 'Count' },
      { Name: 'b', Unit: 'Seconds' },
    ]);
    expect(r.a).toBe(1);
    expect(r.b).toBe(2);
  });
});

describe('EMF emission', () => {
  let capture: ReturnType<typeof captureMetrics>;

  beforeEach(() => {
    withTestIdentity();
    resetMetrics();
    capture = captureMetrics();
  });
  afterEach(() => { capture.stop(); restoreIdentity(); });

  it('emits one line per call', () => {
    emitMetric('bidride_x_total', 1, { outcome: 'ok' });

    expect(capture.named('bidride_x_total')).toEqual([
      { name: 'bidride_x_total', value: 1, unit: 'Count', dimensions: expect.objectContaining({ outcome: 'ok' }) },
    ]);
  });

  it('a counter increment emits immediately — an alarm can fire on the event', () => {
    registry.counter('bidride_evt_total', 'test').inc({ outcome: 'failed' });

    const found = capture.named('bidride_evt_total');
    expect(found).toHaveLength(1);
    expect(found[0].dimensions.outcome).toBe('failed');
  });

  it('a histogram emits the raw observation — CloudWatch computes statistics', () => {
    registry.histogram('bidride_lat_seconds', 'test').observe(0.25, { route: '/x' });

    expect(capture.named('bidride_lat_seconds')[0]).toMatchObject({ value: 0.25, unit: 'Seconds' });
  });

  it('a gauge does NOT emit on write — levels are sampled, not evented', () => {
    registry.gauge('bidride_depth', 'test').set(7);

    expect(capture.named('bidride_depth')).toHaveLength(0);
  });

  it('publishGauges samples every gauge', () => {
    registry.gauge('bidride_depth', 'test').set(7, { queue: 'a' });

    registry.publishGauges();

    expect(capture.named('bidride_depth')[0]).toMatchObject({ value: 7 });
  });

  // ── Fail open ─────────────────────────────────────────────────────────────

  it('a throwing sink never propagates to the caller', () => {
    setEmfSink(() => { throw new Error('stdout gone'); });

    expect(() => emitMetric('bidride_x_total', 1)).not.toThrow();

    setEmfSink(null);
  });

  it('an unserializable value never propagates', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => emitEmf([{ name: 'm', value: 1 }], circular as never)).not.toThrow();
  });

  it('a counter increment still counts locally when emission fails', () => {
    setEmfSink(() => { throw new Error('nope'); });
    const c = registry.counter('bidride_resilient_total', 'test');

    c.inc({ outcome: 'ok' });

    expect(c.get({ outcome: 'ok' })).toBe(1);
    setEmfSink(null);
  });
});
