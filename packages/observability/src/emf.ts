import { getServiceIdentity } from './service-identity';
import { getCorrelationId } from './correlation';

/**
 * CloudWatch Embedded Metric Format output (PO-1A).
 *
 * BidRide runs NestJS on Fargate with the `awslogs` driver already configured,
 * so a metric is a JSON line on stdout carrying an `_aws` block — CloudWatch
 * extracts it automatically. That buys three things nothing else does:
 *
 *   - NO new infrastructure. No scraper, no sidecar, no AMP workspace, no ALB
 *     route. The pipeline that carries logs today carries metrics tomorrow.
 *   - NO network call on the request path. Emission is a write to stdout, so
 *     telemetry cannot time out, throttle or fail a capture.
 *   - Logs and metrics in one place, which matters when one operator is doing
 *     the watching.
 *
 * The cost is AWS lock-in, contained to this one file: the emission API is the
 * existing registry, so swapping the formatter swaps the vendor.
 *
 * The Prometheus text endpoint is unchanged and still serves local development
 * and tests. This is an ADDITIONAL output, not a replacement.
 */

export const EMF_NAMESPACE = 'BidRide';

export type EmfUnit =
  | 'Count' | 'Seconds' | 'Milliseconds' | 'Bytes' | 'Percent' | 'None';

export interface EmfMetricInput {
  name: string;
  value: number;
  unit?: EmfUnit;
  dimensions?: Record<string, string>;
}

/** The `_aws` envelope CloudWatch looks for. */
interface EmfRecord {
  _aws: {
    Timestamp: number;
    CloudWatchMetrics: Array<{
      Namespace: string;
      Dimensions: string[][];
      Metrics: Array<{ Name: string; Unit: string }>;
    }>;
  };
  [key: string]: unknown;
}

export type EmfSink = (line: string) => void;

const defaultSink: EmfSink = (line) => process.stdout.write(line + '\n');

let sink: EmfSink = defaultSink;

/** Swap the destination. Used by tests; production writes to stdout. */
export function setEmfSink(fn: EmfSink | null): void {
  sink = fn ?? defaultSink;
}

/**
 * Build one EMF record from metrics that SHARE a dimension set.
 *
 * CloudWatch groups by dimension set, so metrics with different dimensions must
 * be separate records — batching them together would silently attribute values
 * to the wrong series.
 */
export function buildEmfRecord(
  metrics: EmfMetricInput[],
  dimensions: Record<string, string> = {},
  timestamp = Date.now(),
): EmfRecord | null {
  if (metrics.length === 0) return null;

  const id = getServiceIdentity();
  // Service and env are dimensions on every metric: without them, two services
  // emitting bidride_http_requests_total would sum into one meaningless number.
  const allDimensions: Record<string, string> = {
    service: id.service,
    env: id.env,
    ...dimensions,
  };
  const dimensionKeys = Object.keys(allDimensions);

  const record: EmfRecord = {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{
        Namespace: EMF_NAMESPACE,
        // A single dimension set: every metric in this record shares it.
        Dimensions: [dimensionKeys],
        Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit ?? 'Count' })),
      }],
    },
    ...allDimensions,
    // Context that is NOT a dimension — searchable in Logs Insights, and
    // deliberately not part of the metric's cardinality.
    version: id.version,
    commitSha: id.commitSha,
  };

  const correlationId = getCorrelationId();
  if (correlationId) record.correlationId = correlationId;

  for (const m of metrics) record[m.name] = m.value;

  return record;
}

/**
 * Emit metrics sharing one dimension set.
 *
 * Never throws. A telemetry failure that breaks a payment capture would be a
 * far worse defect than the missing datapoint.
 */
export function emitEmf(
  metrics: EmfMetricInput[],
  dimensions: Record<string, string> = {},
  timestamp = Date.now(),
): void {
  try {
    const record = buildEmfRecord(metrics, dimensions, timestamp);
    if (!record) return;
    sink(JSON.stringify(record));
  } catch {
    /* fail open — see the module comment */
  }
}

/** Emit a single metric. The common case. */
export function emitMetric(
  name: string,
  value: number,
  dimensions: Record<string, string> = {},
  unit: EmfUnit = 'Count',
): void {
  emitEmf([{ name, value, unit }], dimensions);
}
