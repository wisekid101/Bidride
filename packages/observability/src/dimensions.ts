/**
 * Metric dimension policy (PO-1A).
 *
 * CloudWatch bills per custom metric, and a metric's cost is the product of its
 * dimension values. One unbounded dimension turns one metric into millions of
 * series: a `tripId` dimension at 1,000 trips/day is ~30,000 metrics a month.
 * That is a four-figure invoice and a dashboard nobody can read.
 *
 * A policy in a document gets violated. This one is code.
 *
 * Two layers, deliberately asymmetric:
 *
 *   1. PROHIBITED NAMES are always rejected. These identifiers are unbounded by
 *      nature and there is no legitimate metric use for them — they belong in
 *      logs, where "which trip" is exactly the question logs answer.
 *
 *   2. AN ALLOW-LIST is optional per metric. Declare one and unknown values
 *      collapse to `other` rather than minting a new series. Declare none and
 *      only layer 1 applies, so existing metrics keep working untouched.
 */

/** Collapsed value for an unexpected dimension value on an allow-listed metric. */
export const OTHER_VALUE = 'other';

/**
 * Dimension names that may never be used, in any metric, ever.
 *
 * Identifiers, free text and coordinates. Every one of these is high- or
 * unbounded-cardinality, and several are also PII.
 */
export const PROHIBITED_DIMENSIONS = new Set([
  // Unbounded identifiers
  'riderid', 'driverid', 'tripid', 'bidid', 'userid', 'adminid',
  'paymentintentid', 'captureRecoveryId'.toLowerCase(), 'recoveryid',
  'paymentid', 'ledgerid', 'correlationid', 'requestid', 'traceid', 'jobrunid',
  'sessionid', 'eventid', 'stripecustomerid', 'paymentmethodid',
  // Free text — unbounded by construction
  'error', 'errormessage', 'message', 'reason_text', 'detail', 'stack',
  'url', 'path', 'fullpath', 'query', 'useragent',
  // Location — unbounded and personally identifying
  'lat', 'lng', 'latitude', 'longitude', 'coordinates', 'location',
  // Direct PII
  'phone', 'phonenumber', 'email', 'name', 'firstname', 'lastname',
  'address', 'ip', 'ipaddress',
]);

export interface DimensionViolation {
  metric: string;
  dimension: string;
  reason: 'prohibited' | 'unknown_value';
}

/** Reported rather than thrown — telemetry must never break a request. */
export type ViolationReporter = (v: DimensionViolation) => void;

let reporter: ViolationReporter = () => {
  /* replaced by the package's logger wiring, or by a test */
};

export function onDimensionViolation(fn: ViolationReporter): void {
  reporter = fn;
}

/** Allowed values per dimension for one metric. Undefined = no allow-list. */
export type DimensionPolicy = Record<string, readonly string[]>;

/**
 * Apply the policy to a set of labels.
 *
 * Prohibited names are DROPPED, not collapsed — keeping the key with a
 * placeholder would still suggest the dimension is legitimate. Unknown values
 * on an allow-listed dimension collapse to `other`, which preserves the series
 * count while making the drift visible in the data.
 *
 * Never throws. A malformed label set produces a reduced label set, never an
 * exception in the caller's path.
 */
export function applyDimensionPolicy(
  metricName: string,
  labels: Record<string, string>,
  policy?: DimensionPolicy,
): Record<string, string> {
  if (!labels || typeof labels !== 'object') return {};

  const out: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(labels)) {
    if (PROHIBITED_DIMENSIONS.has(key.toLowerCase())) {
      safeReport({ metric: metricName, dimension: key, reason: 'prohibited' });
      continue;
    }

    const value = typeof rawValue === 'string' ? rawValue : String(rawValue);
    const allowed = policy?.[key];

    if (allowed && !allowed.includes(value)) {
      safeReport({ metric: metricName, dimension: key, reason: 'unknown_value' });
      out[key] = OTHER_VALUE;
      continue;
    }

    out[key] = value;
  }

  return out;
}

function safeReport(v: DimensionViolation): void {
  try {
    reporter(v);
  } catch {
    /* a reporter that throws must not break emission */
  }
}
