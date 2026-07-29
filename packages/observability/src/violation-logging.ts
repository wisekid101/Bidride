import { BidRideLogger } from './logger';
import { onDimensionViolation, DimensionViolation } from './dimensions';

/**
 * Production subscriber for dimension-policy violations (PO-1C-i).
 *
 * PO-1A added the guard that drops a prohibited metric dimension. It works, but
 * nothing listened — so a `tripId` label reaching a counter was silently
 * discarded and nobody learned it had been attempted. A guard you cannot hear
 * is a guard you cannot fix behind.
 *
 * Four properties this deliberately has:
 *
 *   1. THE VALUE IS NEVER LOGGED. `DimensionViolation` does not carry it, so
 *      that is structural rather than a promise — the rejected value may be the
 *      exact PII or unbounded id the guard just caught, and writing it to a
 *      30-day log group would defeat the guard entirely.
 *
 *   2. WARN, NOT ERROR. The guard firing is the system working. It is a code
 *      defect to fix, not an incident to page on.
 *
 *   3. DEDUPLICATED. A violation on a hot path fires per request. The first
 *      occurrence of each (metric, dimension, reason) is logged and the rest
 *      are suppressed — one line tells you everything the thousandth would.
 *
 *   4. RECURSION-SAFE. BidRideLogger emits no metrics, so logging a violation
 *      cannot trigger another. A guard flag makes that hold even if the logger
 *      ever changes.
 */

const SUPPRESSED_AFTER_FIRST = true;

let installed = false;
let reporting = false;
const seen = new Set<string>();

export interface ViolationLoggingOptions {
  /** Logger to use. One is created with the given context when omitted. */
  logger?: BidRideLogger;
  /** Context name for the default logger. */
  context?: string;
}

/**
 * Subscribe the logger to dimension violations. Call once per service, from
 * `main.ts` after the app is created and before it listens.
 *
 * Idempotent: a second call replaces nothing and re-installs nothing, so a
 * service that bootstraps twice in tests does not double-log.
 */
export function installDimensionViolationLogging(
  options: ViolationLoggingOptions = {},
): void {
  if (installed) return;
  installed = true;

  const logger = options.logger ?? new BidRideLogger(options.context ?? 'observability');

  onDimensionViolation((v: DimensionViolation) => {
    // Re-entrancy guard. The logger emits no metrics today, so this cannot
    // trigger; it exists so that stays true if the logger ever gains them.
    if (reporting) return;

    const key = `${v.metric}|${v.dimension}|${v.reason}`;
    if (SUPPRESSED_AFTER_FIRST && seen.has(key)) return;
    seen.add(key);

    reporting = true;
    try {
      logger.warn('metric_dimension_rejected', {
        metric: v.metric,
        dimension: v.dimension,
        reason: v.reason,
        // NOTE: no value. See property 1 above.
        note: 'first occurrence only; subsequent identical violations are suppressed',
      });
    } finally {
      reporting = false;
    }
  });
}

/** Reset installation state. Tests only — never called in production. */
export function resetDimensionViolationLogging(): void {
  installed = false;
  reporting = false;
  seen.clear();
  onDimensionViolation(() => undefined);
}
