import { PrismaService } from '../../prisma/prisma.service';
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

/** 2km grid — the platform-wide zone convention (finest allowed location granularity). */
export function zoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }

export function changePct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

/**
 * Latest data-quality class per trip (from the C1–C5 classifier's audited
 * trip_events). Monetary metrics use Trusted + Reconciled ONLY.
 */
export async function latestQualityClasses(prisma: PrismaService): Promise<Map<string, string>> {
  const events = await prisma.tripEvent.findMany({
    where: { eventType: 'data_quality_classified' },
    orderBy: { createdAt: 'asc' },
    select: { tripId: true, metadata: true },
  });
  const latest = new Map<string, string>();
  for (const e of events) {
    const cls = (e.metadata as { class?: string } | null)?.class;
    if (cls) latest.set(e.tripId, cls);
  }
  return latest;
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
