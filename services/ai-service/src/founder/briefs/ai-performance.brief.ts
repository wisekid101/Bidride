import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BriefSection, BriefZoneRow, FounderBrief } from './brief.types';
import { BRIEFS_SOURCE_VERSION, briefWindow, latestQualityClasses, metric, round2 } from './brief-helpers';

// ─── BRIEF 3 — AI Performance ─────────────────────────────────────────────────
// How the AI itself is doing: ledger lifecycle counts, per-family inference
// health, shadow calibration against real outcomes, and data-quality gate
// stats. HARD RULE: no family is suggested for live activation because it
// produced recommendations — activation advice requires OUTCOME evidence, and
// absent that the advice is always "remain shadowed".

const FAMILY_LATENCY_BUDGET_MS: Record<string, number> = {
  'fare-adjustment': 3000,   // pricing-service caller timeout
  'driver-ranking': 300,     // dispatch hard timeout
  'bid-win-probability': 500,
};

const MIN_OUTCOME_EVIDENCE = 20;

@Injectable()
export class AiPerformanceBrief {
  constructor(private readonly prisma: PrismaService) {}

  async generate(now = new Date()): Promise<FounderBrief> {
    const w = briefWindow(7, now);
    const insufficient: string[] = [];

    // Ledger lifecycle.
    const statusCounts = await this.prisma.aiRecommendation.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const count = (s: string) => statusCounts.find((r) => r.status === s)?._count._all ?? 0;

    // Per-family inference health over the window.
    const inferences = await this.prisma.aiInferenceLog.findMany({
      where: { createdAt: { gte: w.start, lte: w.end } },
      select: { modelName: true, modelVersion: true, fallbackUsed: true, latencyMs: true },
    });
    const byFamily = new Map<string, { total: number; fallbacks: number; overBudget: number; latencies: number[] }>();
    for (const row of inferences) {
      const f = byFamily.get(row.modelName) ?? { total: 0, fallbacks: 0, overBudget: 0, latencies: [] };
      f.total += 1;
      if (row.fallbackUsed) f.fallbacks += 1;
      f.latencies.push(row.latencyMs);
      const budget = FAMILY_LATENCY_BUDGET_MS[row.modelName];
      if (budget && row.latencyMs > budget) f.overBudget += 1;
      byFamily.set(row.modelName, f);
    }
    const familyRows: BriefZoneRow[] = [...byFamily.entries()].map(([family, f]) => {
      const sorted = [...f.latencies].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
      return {
        family,
        inferences: f.total,
        fallbackRatePct: f.total ? round2((f.fallbacks / f.total) * 100) : null,
        overBudgetRatePct: f.total ? round2((f.overBudget / f.total) * 100) : null,
        p95LatencyMs: p95,
      };
    });

    // Shadow calibration: bid-win-probability real predictions vs outcomes.
    const outcomes = await this.prisma.bidOutcome.findMany({
      where: { predictionProbability: { not: null } },
      select: { predictionProbability: true, wasAccepted: true },
    });
    const buckets = [
      { label: '0.00–0.25', lo: 0, hi: 0.25 },
      { label: '0.25–0.50', lo: 0.25, hi: 0.5 },
      { label: '0.50–0.75', lo: 0.5, hi: 0.75 },
      { label: '0.75–1.00', lo: 0.75, hi: 1.01 },
    ].map((b) => {
      const rows = outcomes.filter((o) => Number(o.predictionProbability) >= b.lo && Number(o.predictionProbability) < b.hi);
      return {
        bucket: b.label,
        n: rows.length,
        predictedMean: rows.length ? round2(rows.reduce((s, o) => s + Number(o.predictionProbability), 0) / rows.length) : null,
        actualAcceptance: rows.length ? round2(rows.filter((o) => o.wasAccepted).length / rows.length) : null,
      };
    });

    // Data-quality gate (shared helper — one readout of the classifier).
    const latest = await latestQualityClasses(this.prisma);
    const dqCounts = { trusted: 0, reconciled: 0, suspect: 0, excluded: 0 } as Record<string, number>;
    for (const cls of latest.values()) dqCounts[cls] = (dqCounts[cls] ?? 0) + 1;
    const dqTotal = latest.size;
    const dqRejectionRate = dqTotal ? round2(((dqCounts.suspect + dqCounts.excluded) / dqTotal) * 100) : null;

    // Activation advice: outcome evidence or stay shadowed. No exceptions.
    const activationNotes = [...byFamily.keys()].map((family) => {
      const outcomeEvidence = family === 'bid-win-probability' ? outcomes.length : 0;
      return outcomeEvidence >= MIN_OUTCOME_EVIDENCE
        ? `${family}: ${outcomeEvidence} outcome joins — calibration reviewable, activation remains a Founder decision`
        : `${family}: REMAIN SHADOWED — insufficient outcome evidence (${outcomeEvidence} < ${MIN_OUTCOME_EVIDENCE}); generating recommendations is NOT outcome evidence`;
    });

    const sections: BriefSection[] = [
      {
        title: 'Recommendation ledger (all time)',
        metrics: (['proposed', 'viewed', 'adopted', 'dismissed', 'expired', 'outcome_pending', 'outcome_scored'] as const).map((s) =>
          metric({ name: `recommendations_${s}`, value: count(s), window: 'all time', sampleSize: count(s), source: 'ai_recommendations (operational)', qualityLabel: 'operational', isCount: true }),
        ),
      },
      {
        title: 'Inference health by family',
        metrics: [
          metric({ name: 'inferences_total', value: inferences.length, window: w.label, sampleSize: inferences.length, source: 'ai_inference_logs (operational)', qualityLabel: 'operational', isCount: true }),
        ],
        zoneTable: { columns: ['family', 'inferences', 'fallbackRatePct', 'overBudgetRatePct', 'p95LatencyMs'], rows: familyRows },
        notes: ['overBudgetRatePct estimates timeout exposure: ai-service latency above the caller\'s own timeout budget'],
      },
      {
        title: 'Shadow calibration — bid win probability (real predictions vs outcomes)',
        metrics: [
          metric({ name: 'outcome_joined_predictions', value: outcomes.length, window: 'all time', sampleSize: outcomes.length, source: 'bid_outcomes.predictionProbability (operational)', qualityLabel: 'operational', isCount: true }),
        ],
        zoneTable: { columns: ['bucket', 'n', 'predictedMean', 'actualAcceptance'], rows: buckets },
        notes: ['predictions are the REAL shadow values (never the served neutral 0.5)'],
      },
      {
        title: 'Data-quality gate',
        metrics: [
          metric({ name: 'classified_trips', value: dqTotal, window: 'all time', sampleSize: dqTotal, source: 'trip_events(data_quality_classified) (operational)', qualityLabel: 'operational', isCount: true }),
          metric({ name: 'data_quality_rejection_rate', value: dqRejectionRate, unit: '%', window: 'all time', sampleSize: dqTotal, source: 'C1–C5 classifier verdicts (suspect+excluded)/total', qualityLabel: 'operational' }),
        ],
        notes: [
          `class counts: trusted=${dqCounts.trusted} reconciled=${dqCounts.reconciled} suspect=${dqCounts.suspect} excluded=${dqCounts.excluded}`,
          ...activationNotes,
          'all AI families remain shadow-only; live activation requires Founder approval per governance v1.1',
        ],
      },
    ];

    for (const s of sections) for (const m of s.metrics) if (m.qualityLabel === 'insufficient_evidence') insufficient.push(m.name);

    return {
      briefType: 'ai_performance',
      windowStart: w.start.toISOString(),
      windowEnd: w.end.toISOString(),
      comparisonWindowStart: w.prevStart.toISOString(),
      comparisonWindowEnd: w.prevEnd.toISOString(),
      generatedAt: now.toISOString(),
      sourceVersion: BRIEFS_SOURCE_VERSION,
      sections,
      insufficientEvidence: insufficient,
    };
  }
}
