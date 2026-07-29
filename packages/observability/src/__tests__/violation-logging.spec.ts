import {
  installDimensionViolationLogging,
  resetDimensionViolationLogging,
} from '../violation-logging';
import { applyDimensionPolicy } from '../dimensions';
import { registry } from '../metrics';
import { BidRideLogger } from '../logger';
import { captureLogs, captureMetrics, withTestIdentity, restoreIdentity, resetMetrics } from '../testing';

// ─── PO-1C-i: the dimension guard becomes audible ───────────────────────────
// PO-1A dropped prohibited dimensions silently. A guard nobody can hear is a
// guard nobody fixes behind, so this subscribes the logger — while keeping the
// one property that makes the guard worth having: the rejected VALUE, which may
// be the exact PII or unbounded id that was caught, is never written down.

describe('dimension violation logging', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    withTestIdentity();
    resetDimensionViolationLogging();
    resetMetrics();
    logs = captureLogs();
  });
  afterEach(() => {
    logs.stop();
    resetDimensionViolationLogging();
    restoreIdentity();
  });

  it('logs a rejected dimension at warn level', () => {
    installDimensionViolationLogging({ context: 'test-service' });

    applyDimensionPolicy('bidride_test_total', { tripId: 'trip-abc-123' });

    const line = logs.lines()[0];
    expect(line).toMatchObject({
      level: 'warn',
      message: 'metric_dimension_rejected',
      metric: 'bidride_test_total',
      dimension: 'tripId',
      reason: 'prohibited',
    });
  });

  it('NEVER logs the rejected value', () => {
    // The whole point of the guard. DimensionViolation does not carry the
    // value, so this is structural — but assert it against the raw text, which
    // catches a leak through any field.
    installDimensionViolationLogging({ context: 'test-service' });

    applyDimensionPolicy('m', { riderId: 'rider-secret-id', phone: '+15551234567' });

    const text = logs.text();
    expect(text).not.toContain('rider-secret-id');
    expect(text).not.toContain('+15551234567');
    expect(text).toContain('riderId');
    expect(text).toContain('phone');
  });

  it('warns, never errors — the guard firing is the system working', () => {
    installDimensionViolationLogging({ context: 'test-service' });

    applyDimensionPolicy('m', { tripId: 'x' });

    expect(logs.lines().every((l) => l.level === 'warn')).toBe(true);
  });

  it('deduplicates repeated identical violations', () => {
    // A violation on a hot path fires per request; one line says everything the
    // thousandth would.
    installDimensionViolationLogging({ context: 'test-service' });

    for (let i = 0; i < 50; i++) applyDimensionPolicy('m', { tripId: `trip-${i}` });

    expect(logs.lines()).toHaveLength(1);
  });

  it('logs each distinct (metric, dimension, reason) once', () => {
    installDimensionViolationLogging({ context: 'test-service' });

    applyDimensionPolicy('metric_a', { tripId: 'x' });
    applyDimensionPolicy('metric_b', { tripId: 'x' });
    applyDimensionPolicy('metric_a', { riderId: 'x' });
    applyDimensionPolicy('metric_a', { tripId: 'y' }); // duplicate of the first

    expect(logs.lines()).toHaveLength(3);
  });

  it('reports an unknown allow-listed value distinctly from a prohibited name', () => {
    installDimensionViolationLogging({ context: 'test-service' });

    applyDimensionPolicy('m', { outcome: 'invented' }, { outcome: ['ok'] });

    expect(logs.lines()[0]).toMatchObject({ dimension: 'outcome', reason: 'unknown_value' });
  });

  it('is idempotent — installing twice does not double-log', () => {
    installDimensionViolationLogging({ context: 'test-service' });
    installDimensionViolationLogging({ context: 'test-service' });

    applyDimensionPolicy('m', { tripId: 'x' });

    expect(logs.lines()).toHaveLength(1);
  });

  it('accepts a caller-supplied logger', () => {
    installDimensionViolationLogging({ logger: new BidRideLogger('custom-context') });

    applyDimensionPolicy('m', { tripId: 'x' });

    expect(logs.lines()[0].context).toBe('custom-context');
  });

  it('does not recurse — logging a violation emits no metric', () => {
    const capture = captureMetrics();
    installDimensionViolationLogging({ context: 'test-service' });

    try {
      registry.counter('bidride_recursion_total', 'test').inc({ tripId: 'x', outcome: 'ok' });

      // One metric for the counter itself, and nothing produced by the logger.
      expect(capture.named('bidride_recursion_total')).toHaveLength(1);
      expect(logs.lines()).toHaveLength(1);
    } finally {
      capture.stop();
    }
  });

  it('a violation before installation is dropped, not thrown', () => {
    // Metric declaration happens at import time; emission does not. A violation
    // in that window is acceptable to lose, but must never crash a boot.
    expect(() => applyDimensionPolicy('m', { tripId: 'x' })).not.toThrow();
    expect(logs.lines()).toHaveLength(0);
  });

  it('a throwing logger does not break metric emission', () => {
    const exploding = { warn: () => { throw new Error('logger down'); } } as unknown as BidRideLogger;
    installDimensionViolationLogging({ logger: exploding });

    expect(() => applyDimensionPolicy('m', { tripId: 'x' })).not.toThrow();
  });
});
