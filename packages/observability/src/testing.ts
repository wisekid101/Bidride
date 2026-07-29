import { setEmfSink } from './emf';
import { onDimensionViolation, DimensionViolation } from './dimensions';
import { registry } from './metrics';
import { setServiceIdentity, refreshServiceIdentity } from './service-identity';

/**
 * Test helpers (PO-1A).
 *
 * Instrumentation is only worth adding if it can be asserted on. Without these,
 * every service testing a metric would re-invent stdout capture, and the
 * assertions would drift apart across twelve services.
 *
 * These belong to the package, not to any service, and they exist so PO-1B can
 * write `expect(metrics.names()).toContain(...)` instead of parsing log lines.
 */

export interface CapturedMetric {
  name: string;
  value: number;
  unit: string;
  dimensions: Record<string, string>;
}

export interface MetricCapture {
  /** Every metric emitted since capture started, in order. */
  all(): CapturedMetric[];
  /** Metrics matching a name. */
  named(name: string): CapturedMetric[];
  /** Distinct metric names seen. */
  names(): string[];
  /** Raw EMF lines, for asserting on the envelope itself. */
  raw(): string[];
  clear(): void;
  stop(): void;
}

/**
 * Redirect EMF emission into memory for the duration of a test.
 *
 * ALWAYS call `stop()` — an un-stopped capture leaks into the next test and
 * turns an unrelated failure into a mystery. `afterEach(() => capture.stop())`
 * is the intended shape.
 */
export function captureMetrics(): MetricCapture {
  const lines: string[] = [];

  setEmfSink((line) => { lines.push(line); });

  const parsed = (): CapturedMetric[] => {
    const out: CapturedMetric[] = [];
    for (const line of lines) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a malformed line is a finding for raw(), not a crash here
      }
      const aws = record._aws as
        | { CloudWatchMetrics: Array<{ Dimensions: string[][]; Metrics: Array<{ Name: string; Unit: string }> }> }
        | undefined;
      if (!aws?.CloudWatchMetrics?.[0]) continue;

      const { Dimensions, Metrics } = aws.CloudWatchMetrics[0];
      const dimensionKeys = Dimensions[0] ?? [];
      const dimensions: Record<string, string> = {};
      for (const k of dimensionKeys) dimensions[k] = String(record[k]);

      for (const m of Metrics) {
        out.push({
          name: m.Name,
          value: Number(record[m.Name]),
          unit: m.Unit,
          dimensions,
        });
      }
    }
    return out;
  };

  return {
    all: parsed,
    named: (name) => parsed().filter((m) => m.name === name),
    names: () => [...new Set(parsed().map((m) => m.name))],
    raw: () => [...lines],
    clear: () => { lines.length = 0; },
    stop: () => { setEmfSink(null); lines.length = 0; },
  };
}

export interface ViolationCapture {
  all(): DimensionViolation[];
  stop(): void;
}

/** Capture dimension-policy violations — used to prove the policy bites. */
export function captureDimensionViolations(): ViolationCapture {
  const found: DimensionViolation[] = [];
  onDimensionViolation((v) => { found.push(v); });
  return {
    all: () => [...found],
    stop: () => { onDimensionViolation(() => undefined); found.length = 0; },
  };
}

export interface LogCapture {
  lines(): Record<string, unknown>[];
  /** The raw text, for asserting that a secret is absent from the whole line. */
  text(): string;
  stop(): void;
}

/**
 * Capture logger output.
 *
 * `text()` is the important one: asserting a redacted VALUE is absent from the
 * entire serialized line catches leaks that a key-by-key assertion misses, such
 * as a secret nested inside an error message.
 */
export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  const capture = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };

  (process.stdout as { write: unknown }).write = capture;
  (process.stderr as { write: unknown }).write = capture;

  return {
    lines: () => chunks
      .join('')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return { unparsed: l };
        }
      }),
    text: () => chunks.join(''),
    stop: () => {
      (process.stdout as { write: unknown }).write = origOut;
      (process.stderr as { write: unknown }).write = origErr;
      chunks.length = 0;
    },
  };
}

/** Deterministic identity for assertions that would otherwise read the env. */
export function withTestIdentity(): void {
  setServiceIdentity({
    service: 'test-service', env: 'test', version: '0.0.0-test', commitSha: 'testsha',
  });
}

export function restoreIdentity(): void {
  refreshServiceIdentity();
}

/** Clear all registered metrics between tests. */
export function resetMetrics(): void {
  registry.reset();
}
