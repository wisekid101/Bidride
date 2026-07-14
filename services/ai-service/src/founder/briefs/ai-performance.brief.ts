import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BriefSection, BriefZoneRow, FounderBrief } from './brief.types';
import { BRIEFS_SOURCE_VERSION, briefWindow, metric, round2 } from './brief-helpers';
import { QualityClassService } from '../../quality/quality-class.service';
import { domainForModel } from '../../domains/domain-manifest';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityClassService,
  ) {}

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
        domain: domainForModel(family),
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

    // Ledger outcome performance by recommendation family (Founder-scored).
    const scored = await this.prisma.aiRecommendation.findMany({
      where: { status: 'outcome_scored' },
      select: { family: true, status: true, confidence: true, outcomeScore: true, outcomeEvidence: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const regretDismissed = await this.prisma.aiRecommendation.findMany({
      where: { status: 'dismissed', outcomeScore: { not: null } },
      select: { family: true, outcomeScore: true },
      take: 1000,
    });
    const dismissedByFamily = new Map<string, { total: number; regret: number }>();
    // Dismissal counts (for regret rate) need dismissed totals incl. unscored:
    const dismissedTotals = await this.prisma.aiRecommendation.groupBy({
      by: ['family'], where: { status: 'dismissed' }, _count: { _all: true },
    });
    for (const row of dismissedTotals) dismissedByFamily.set(row.family, { total: row._count._all, regret: 0 });
    for (const r of regretDismissed) {
      if (Number(r.outcomeScore) >= 0.7) {
        const agg = dismissedByFamily.get(r.family) ?? { total: 0, regret: 0 };
        agg.regret += 1;
        dismissedByFamily.set(r.family, agg);
      }
    }
    const ledgerFamilies = new Map<string, Array<{ confidence: number; score: number; sufficient: boolean }>>();
    for (const r of scored) {
      const list = ledgerFamilies.get(r.family) ?? [];
      list.push({
        confidence: Number(r.confidence),
        score: Number(r.outcomeScore),
        sufficient: !(r.outcomeEvidence as { insufficientEvidence?: boolean } | null)?.insufficientEvidence,
      });
      ledgerFamilies.set(r.family, list);
    }
    const calibrationRows: BriefZoneRow[] = [...ledgerFamilies.entries()].map(([family, rows]) => {
      const n = rows.length;
      const meanConfidence = round2(rows.reduce((s, r) => s + r.confidence, 0) / n);
      const meanScore = round2(rows.reduce((s, r) => s + r.score, 0) / n);
      const brier = round2(rows.reduce((s, r) => s + (r.confidence - r.score) ** 2, 0) / n);
      const dismissed = dismissedByFamily.get(family);
      return {
        family,
        scoredOutcomes: n,
        meanConfidence: n >= MIN_OUTCOME_EVIDENCE ? meanConfidence : null,
        meanOutcomeScore: n >= MIN_OUTCOME_EVIDENCE ? meanScore : null,
        brierMse: n >= MIN_OUTCOME_EVIDENCE ? brier : null,
        dismissalRegret: dismissed ? `${dismissed.regret}/${dismissed.total}` : '0/0',
        evidence: n >= MIN_OUTCOME_EVIDENCE ? 'reviewable' : `insufficient_evidence (${n} < ${MIN_OUTCOME_EVIDENCE})`,
      };
    });

    // Data-quality gate — latest-per-trip resolved in SQL (DISTINCT ON),
    // never rescanned in memory.
    const { counts: dqCounts, total: dqTotal } = await this.quality.latestClassCounts();
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
        zoneTable: { columns: ['family', 'domain', 'inferences', 'fallbackRatePct', 'overBudgetRatePct', 'p95LatencyMs'], rows: familyRows },
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
        title: 'Recommendation family performance (Founder-scored outcomes)',
        metrics: [
          metric({ name: 'scored_outcomes_total', value: scored.length, window: 'all time', sampleSize: scored.length, source: 'ai_recommendations (operational)', qualityLabel: 'operational', isCount: true }),
        ],
        zoneTable: {
          columns: ['family', 'scoredOutcomes', 'meanConfidence', 'meanOutcomeScore', 'brierMse', 'dismissalRegret', 'evidence'],
          rows: calibrationRows,
        },
        notes: [
          `calibration statistics render only at ${MIN_OUTCOME_EVIDENCE}+ scored outcomes per family — immature calibration is never presented as reliable`,
          'generated ≠ scored: only Founder-scored outcomes count as evidence; adoption rate is NOT recommendation quality',
          'dismissal regret = dismissed recommendations later scored ≥ 0.7',
        ],
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
