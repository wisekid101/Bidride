// ─── Founder Brief format (Founder Intelligence v1) ──────────────────────────
// Every metric names its window, sample size, source, comparison, and quality
// label. A brief that cannot evidence a number says "insufficient_evidence" —
// it never invents one.

export type BriefType = 'marketplace_health' | 'money_map' | 'ai_performance' | 'focus';

export type QualityLabel =
  | 'canonical_trusted'        // canonical money tables, Trusted/Reconciled classes only
  | 'canonical_all'            // canonical tables, all rows (non-monetary counts)
  | 'operational'              // AI/ops tables (never financial truth)
  | 'live_snapshot'            // Redis, point-in-time
  | 'insufficient_evidence';

export interface BriefMetric {
  name: string;
  value: number | string | null;
  unit?: string;
  window: string;
  sampleSize: number;
  source: string;
  comparison?: {
    period: string;
    value: number | string | null;
    changePct: number | null;
  };
  qualityLabel: QualityLabel;
  /** direction that counts as GOOD news for this metric (renders green) */
  betterWhen?: 'up' | 'down';
  note?: string;
}

/** Generic table row — keys must match the section's declared columns. */
export type BriefZoneRow = Record<string, string | number | null>;

export interface BriefSection {
  title: string;
  metrics: BriefMetric[];
  zoneTable?: { columns: string[]; rows: BriefZoneRow[] };
  notes?: string[];
}

export interface FounderBrief {
  briefType: BriefType;
  windowStart: string;
  windowEnd: string;
  comparisonWindowStart: string;
  comparisonWindowEnd: string;
  generatedAt: string;
  sourceVersion: string;
  sections: BriefSection[];
  /** metric names that could not be honestly computed at current volume */
  insufficientEvidence: string[];
}
