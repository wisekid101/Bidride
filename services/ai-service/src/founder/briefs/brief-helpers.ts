import { BriefMetric, QualityLabel } from './brief.types';
import { MIN_SAMPLE_SIZE } from '../../recommendations/recommendation.types';

export const BRIEFS_SOURCE_VERSION = 'founder-briefs-v1';
export const WINDOW_DAYS = 7;

export interface BriefWindow {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
  prevLabel: string;
}

export function briefWindow(days = WINDOW_DAYS, now = new Date()): BriefWindow {
  const end = now;
  const start = new Date(end.getTime() - days * 86_400_000);
  const prevEnd = start;
  const prevStart = new Date(prevEnd.getTime() - days * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return { start, end, prevStart, prevEnd, label: `${d(start)}..${d(end)}`, prevLabel: `${d(prevStart)}..${d(prevEnd)}` };
}

/**
 * 2km grid — the platform-wide zone convention (finest allowed location
 * granularity).
 *
 * PHASE 3.3 SCALING THRESHOLD: brief/opportunity zone rollups group trips by
 * this key IN MEMORY. That is correct and bounded at alpha/launch volume, but
 * once a weekly window exceeds ~50k trip rows the per-zone aggregation must
 * move to a read-only SQL `GROUP BY` on the zone expression (or a projected
 * feature-store rollup). Deferred deliberately — do NOT pre-build it.
 */
export function zoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }

export function changePct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

export function moneyEligible(classes: Map<string, string>, tripId: string): boolean {
  const cls = classes.get(tripId);
  return cls === 'trusted' || cls === 'reconciled';
}

/** Build a metric, automatically downgrading to insufficient_evidence below MIN_SAMPLE_SIZE. */
export function metric(input: {
  name: string;
  value: number | string | null;
  unit?: string;
  window: string;
  sampleSize: number;
  source: string;
  qualityLabel: QualityLabel;
  comparison?: BriefMetric['comparison'];
  betterWhen?: 'up' | 'down';
  note?: string;
  /** counts (e.g. "completed rides = 0") stay honest at any n; rates/averages need MIN_SAMPLE */
  isCount?: boolean;
}): BriefMetric {
  const insufficient = !input.isCount && input.sampleSize < MIN_SAMPLE_SIZE;
  return {
    name: input.name,
    value: insufficient ? null : input.value,
    unit: input.unit,
    window: input.window,
    sampleSize: input.sampleSize,
    source: input.source,
    comparison: insufficient ? undefined : input.comparison,
    qualityLabel: insufficient ? 'insufficient_evidence' : input.qualityLabel,
    betterWhen: input.betterWhen,
    note: insufficient
      ? `insufficient evidence: n=${input.sampleSize} < ${MIN_SAMPLE_SIZE}${input.note ? ` — ${input.note}` : ''}`
      : input.note,
  };
}
