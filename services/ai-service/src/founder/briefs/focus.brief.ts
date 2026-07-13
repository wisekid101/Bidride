import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketplaceHealthBrief } from './marketplace-health.brief';
import { MoneyMapBrief } from './money-map.brief';
import { BriefMetric, BriefSection, BriefZoneRow, FounderBrief } from './brief.types';
import { BRIEFS_SOURCE_VERSION, briefWindow, round2 } from './brief-helpers';
import { OpportunityAnalyzer, Opportunity } from '../opportunity.analyzer';
import { RecommendationLedgerService } from '../../recommendations/recommendation-ledger.service';
import {
  EvidenceItem, INSUFFICIENT_EVIDENCE, MIN_SAMPLE_SIZE, UniversalRecommendation,
} from '../../recommendations/recommendation.types';

// ─── Weekly Founder Focus Brief (Phase 3.2, Build Step 5) ────────────────────
// Seven sections answering "what changed, what worked, what needs me, and
// what should wait" — every number from governed marketplace data, every
// priority a full universal-format ledger recommendation. Nothing here
// executes anything; adopting a priority records a Founder decision only.
// Before/after correlation is never presented as causation.

export const FOCUS_RULES_VERSION = 'focus-v1';

const MIN_SCORED_FOR_CALIBRATION = 20;
const ATTENTION_THRESHOLD_PCT = 20; // wrong-direction change beyond this needs attention
const WORKED_FLOOR = 0.7;
const FAILED_CEILING = 0.3;
const MAX_PRIORITIES = 3;
const PRIORITY_TTL_DAYS = 7;

@Injectable()
export class FocusBrief {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: MarketplaceHealthBrief,
    private readonly money: MoneyMapBrief,
    private readonly opportunity: OpportunityAnalyzer,
    private readonly ledger: RecommendationLedgerService,
  ) {}

  async generate(now = new Date()): Promise<FounderBrief> {
    const w = briefWindow(7, now);
    const insufficient: string[] = [];

    // Fresh week-over-week source data (computed, not persisted as sub-briefs).
    const [healthBrief, moneyBrief, analysis, scoredRows] = await Promise.all([
      this.health.generate(now),
      this.money.generate(now),
      this.opportunity.analyze(now),
      this.prisma.aiRecommendation.findMany({
        where: { status: 'outcome_scored' },
        select: { id: true, family: true, title: true, confidence: true, outcomeScore: true, outcomeEvidence: true, constitutionTags: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    const allMetrics = [...healthBrief.sections, ...moneyBrief.sections].flatMap((s) => s.metrics);
    const withComparison = allMetrics.filter((m) => m.comparison?.changePct != null && m.qualityLabel !== 'insufficient_evidence');

    // 1 — Week over week.
    const improved = withComparison.filter((m) => this.isGoodChange(m));
    const worsened = withComparison.filter((m) => !this.isGoodChange(m) && m.comparison!.changePct !== 0);
    const weekOverWeek: BriefSection = {
      title: 'Week over week',
      metrics: withComparison,
      notes: [
        improved.length ? `improved: ${improved.map((m) => `${m.name} (${this.pct(m)})`).join(', ')}` : 'nothing measurably improved this week',
        worsened.length ? `got worse: ${worsened.map((m) => `${m.name} (${this.pct(m)})`).join(', ')}` : 'nothing measurably worsened this week',
      ],
    };

    // 2 — Needs attention: wrong-direction beyond threshold, n-gated.
    const attention = worsened.filter((m) => Math.abs(m.comparison!.changePct!) >= ATTENTION_THRESHOLD_PCT && m.sampleSize >= MIN_SAMPLE_SIZE);
    const needsAttention: BriefSection = {
      title: 'Needs attention',
      metrics: attention,
      notes: attention.length
        ? [`${attention.length} metric(s) moved more than ${ATTENTION_THRESHOLD_PCT}% in the wrong direction with n≥${MIN_SAMPLE_SIZE}`]
        : ['no metric crossed its attention threshold this week'],
    };

    // 3 — Recommendation report: what worked, what failed (sufficient evidence only).
    const sufficient = scoredRows.filter((r) => !(r.outcomeEvidence as { insufficientEvidence?: boolean } | null)?.insufficientEvidence);
    const worked = sufficient.filter((r) => Number(r.outcomeScore) >= WORKED_FLOOR);
    const failed = sufficient.filter((r) => Number(r.outcomeScore) < FAILED_CEILING);
    const recRow = (r: (typeof scoredRows)[number]): BriefZoneRow => ({
      recommendationId: r.id, family: r.family, title: r.title.slice(0, 60),
      confidence: round2(Number(r.confidence)), outcomeScore: round2(Number(r.outcomeScore)),
    });
    const recommendationReport: BriefSection = {
      title: 'Recommendation report',
      metrics: [],
      zoneTable: {
        columns: ['recommendationId', 'family', 'title', 'confidence', 'outcomeScore'],
        rows: [...worked.map(recRow), ...failed.map(recRow)],
      },
      notes: [
        `worked (score ≥ ${WORKED_FLOOR}, sufficient evidence): ${worked.length}`,
        `failed (score < ${FAILED_CEILING}, sufficient evidence): ${failed.length}`,
        `${scoredRows.length - sufficient.length} scored outcome(s) excluded for insufficient evidence`,
        'scores are Founder judgments over before/after measurements — correlation, not causation',
      ],
    };

    // 4 — Family evidence status.
    const byFamily = new Map<string, number>();
    for (const r of scoredRows) byFamily.set(r.family, (byFamily.get(r.family) ?? 0) + 1);
    const familyRows: BriefZoneRow[] = [...byFamily.entries()].map(([family, n]) => ({
      family, scoredOutcomes: n,
      calibration: n >= MIN_SCORED_FOR_CALIBRATION ? 'reviewable' : `insufficient_evidence (${n} < ${MIN_SCORED_FOR_CALIBRATION})`,
    }));
    const familyStatus: BriefSection = {
      title: 'Family evidence status',
      metrics: [],
      zoneTable: { columns: ['family', 'scoredOutcomes', 'calibration'], rows: familyRows },
      notes: familyRows.length
        ? [`calibration is treated as meaningful only at ${MIN_SCORED_FOR_CALIBRATION}+ scored outcomes per family`]
        : ['no family has any scored outcome yet — every family lacks evidence'],
    };

    // 5 — Top 3 priorities: full ledger recommendations (deduped per window).
    const { priorities, deduped } = await this.materializePriorities(analysis.candidates, attention, w.label, now);
    const prioritySection: BriefSection = {
      title: 'Top 3 priorities',
      metrics: [],
      zoneTable: {
        columns: ['rank', 'recommendationId', 'title', 'confidence', 'expectedValue'],
        rows: priorities.map((p, i) => ({
          rank: i + 1, recommendationId: p.id, title: p.title.slice(0, 70),
          confidence: p.confidence, expectedValue: p.expectedValue,
        })),
      },
      notes: [
        priorities.length ? 'each priority is a governed ledger recommendation — open it in the inbox to decide' : 'no priority clears the evidence floor this week',
        ...(deduped ? ['priorities already proposed this window were reused, not duplicated'] : []),
        'adopting a priority records your decision only; nothing executes',
      ],
    };

    // 6 — Do not act yet.
    const doNotAct: BriefSection = {
      title: 'Do not act yet',
      metrics: [],
      zoneTable: {
        columns: ['signal', 'missingEvidence'],
        rows: [
          ...analysis.thin.map((z) => ({ signal: `zone ${z.zone}`, missingEvidence: `n=${z.trips} < ${MIN_SAMPLE_SIZE} trips this window` })),
          ...worsened
            .filter((m) => m.sampleSize < MIN_SAMPLE_SIZE)
            .map((m) => ({ signal: m.name, missingEvidence: `n=${m.sampleSize} < ${MIN_SAMPLE_SIZE}` })),
        ],
      },
      notes: ['signals listed here are below their evidence floors — acting on them would be optimizing noise'],
    };

    // 7 — Sources.
    const sources: BriefSection = {
      title: 'Sources',
      metrics: [],
      notes: [
        `canonical: trips.finalFare / driverEarnings / platformFee / earningsSupplement, payments, refunds — window ${w.label}, quality-gated Trusted/Reconciled for money`,
        'operational: bid_outcomes, ai_recommendations (ledger), ai_inference_logs — never financial truth',
        'aggregates and zone keys only — no rider or driver is identified anywhere in this brief',
      ],
    };

    const sections = [weekOverWeek, needsAttention, recommendationReport, familyStatus, prioritySection, doNotAct, sources];
    for (const s of sections) for (const m of s.metrics) if (m.qualityLabel === 'insufficient_evidence') insufficient.push(m.name);

    return {
      briefType: 'focus',
      windowStart: w.start.toISOString(),
      windowEnd: w.end.toISOString(),
      comparisonWindowStart: w.prevStart.toISOString(),
      comparisonWindowEnd: w.prevEnd.toISOString(),
      generatedAt: now.toISOString(),
      sourceVersion: `${BRIEFS_SOURCE_VERSION}+${FOCUS_RULES_VERSION}`,
      sections,
      insufficientEvidence: [...new Set(insufficient)],
    };
  }

  private isGoodChange(m: BriefMetric): boolean {
    const change = m.comparison!.changePct!;
    return m.betterWhen === 'down' ? change <= 0 : change >= 0;
  }

  private pct(m: BriefMetric): string {
    const c = m.comparison!.changePct!;
    return `${c >= 0 ? '+' : ''}${c}%`;
  }

  /** Create (or reuse) up to three full ledger recommendations as priorities. */
  private async materializePriorities(
    zoneCandidates: Opportunity[],
    attention: BriefMetric[],
    windowLabel: string,
    now: Date,
  ): Promise<{ priorities: Array<{ id: string; title: string; confidence: number; expectedValue: string }>; deduped: boolean }> {
    // Window dedup: reuse undecided focus priorities from this window.
    const existing = await this.prisma.aiRecommendation.findMany({
      where: {
        domain: 'founder',
        family: 'focus-recommendation',
        status: { in: ['proposed', 'viewed'] },
        canonicalRefs: { path: ['window'], equals: windowLabel },
      },
      select: { id: true, title: true, confidence: true, payload: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_PRIORITIES,
    });
    if (existing.length > 0) {
      return {
        deduped: true,
        priorities: existing.map((r) => ({
          id: r.id, title: r.title, confidence: round2(Number(r.confidence)),
          expectedValue: this.evString((r.payload as { expectedValue?: unknown }).expectedValue),
        })),
      };
    }

    // Rank candidates: zone gaps by score, then attention metrics by |change|.
    const recs: UniversalRecommendation[] = [];
    for (const c of zoneCandidates.slice(0, MAX_PRIORITIES)) {
      recs.push(this.zonePriority(c, windowLabel, now));
    }
    for (const m of attention) {
      if (recs.length >= MAX_PRIORITIES) break;
      recs.push(this.metricPriority(m, windowLabel, now));
    }

    const priorities: Array<{ id: string; title: string; confidence: number; expectedValue: string }> = [];
    for (const rec of recs.slice(0, MAX_PRIORITIES)) {
      const { id } = await this.ledger.create(rec);
      priorities.push({ id, title: rec.title, confidence: rec.confidence, expectedValue: this.evString(rec.expectedValue) });
    }
    return { priorities, deduped: false };
  }

  private evString(ev: unknown): string {
    if (ev === INSUFFICIENT_EVIDENCE) return 'insufficient evidence';
    const e = ev as { metric?: string; delta?: string; horizon?: string } | undefined;
    return e?.metric ? `${e.metric}: ${e.delta} (${e.horizon})` : 'n/a';
  }

  private zonePriority(c: Opportunity, windowLabel: string, now: Date): UniversalRecommendation {
    const z = c.stats;
    const asOf = now.toISOString();
    const evidence: EvidenceItem[] = [
      { source: 'trips (canonical)', metric: 'zone_requests', value: z.trips, window: windowLabel, sampleSize: z.trips, asOf },
      { source: 'trips (canonical)', metric: 'completion_rate_pct', value: z.completionRate, window: windowLabel, sampleSize: z.completed + z.cancelled, asOf },
      { source: 'trips.driverEarnings + earningsSupplement (canonical, Trusted/Reconciled only)', metric: 'avg_driver_take_home_usd', value: z.avgDriverEarnings, window: windowLabel, sampleSize: z.moneyTrips, asOf },
      { source: 'trips.driverId distinct (canonical)', metric: 'distinct_drivers_serving_zone', value: z.distinctDrivers, window: windowLabel, sampleSize: z.trips, asOf },
    ];
    const confidence = Math.min(0.9, round2(0.3 + 0.02 * z.trips));
    return {
      domain: 'founder',
      family: 'focus-recommendation',
      recommendationType: 'weekly_priority',
      title: `Priority: ${c.headline}`.slice(0, 200),
      summary: `${c.detail} Window ${windowLabel}.`,
      recommendation: { action: 'prioritize_zone_review', value: c.zone, unit: 'zoneKey', detail: `${c.kind}: ${c.detail}` },
      confidence,
      sampleSize: z.trips,
      evidence,
      reasoning: [
        `Signal "${c.kind}" crossed its threshold in zone ${c.zone} with n=${z.trips} this window (${windowLabel}).`,
        `Ranked by expected value × confidence (${confidence}) against this week's other governed signals.`,
      ],
      expectedOutcome: 'Focused operational attention on the most evidenced marketplace gap this week.',
      expectedValue: { metric: 'weekly_zone_trips', delta: `directionally positive — magnitude unquantifiable at n=${z.trips}`, horizon: '4 weeks after action' },
      alternatives: [
        { action: 'defer_to_next_week', tradeoff: 'one more week of evidence, one more week of the gap' },
      ],
      why: 'The most measurable gap in this week\'s governed data.',
      whyNot: `Alpha volume is small (n=${z.trips}); one week of zone data can be noisy.`,
      rollback: 'Advisory only — nothing executes; dismiss to remove from the inbox.',
      businessImpact: 'Directs the week\'s scarce operational attention by evidence.',
      userImpact: 'None directly — follow-up actions go through existing product workflows.',
      safetyImpact: 'none — no safety surface is read or affected',
      revenueImpact: 'Indirect via completed-trip lift in the zone.',
      trustImpact: 'Neutral; positive if acted on transparently.',
      constitutionTags: ['move_people', 'meaningful_ai'],
      sourceVersion: FOCUS_RULES_VERSION,
      rulesVersion: FOCUS_RULES_VERSION,
      canonicalFinancialSource: 'trips.driverEarnings + earningsSupplement (canonical, Trusted/Reconciled only)',
      canonicalRefs: { zoneKey: c.zone, window: windowLabel },
      expiresAt: new Date(now.getTime() + PRIORITY_TTL_DAYS * 86_400_000).toISOString(),
    };
  }

  private metricPriority(m: BriefMetric, windowLabel: string, now: Date): UniversalRecommendation {
    const change = m.comparison!.changePct!;
    // Any money-table reference makes the priority financial; normalize the
    // named source to a clean canonical prefix the validator accepts.
    const isMoney = /finalFare|driverEarnings|platformFee|earningsSupplement|payments|refunds/i.test(m.source) || m.unit === 'USD';
    // Normalize any money source to a validator-accepted canonical prefix.
    // Exhaustive by design: a money metric must never emit a raw, non-canonical
    // source string, which would fail canonical-source validation downstream.
    const canonicalSource = /refunds/i.test(m.source)
      ? 'refunds (canonical)'
      : /payments/i.test(m.source)
        ? 'payments (canonical)'
        : /finalFare|driverEarnings|platformFee|earningsSupplement/i.test(m.source)
          ? 'trips (canonical, Trusted/Reconciled only)'
          : 'canonical financial source (Trusted/Reconciled only)';
    return {
      domain: 'founder',
      family: 'focus-recommendation',
      recommendationType: 'weekly_priority',
      title: `Priority: investigate ${m.name.replace(/_/g, ' ')} (${change >= 0 ? '+' : ''}${change}% week over week)`.slice(0, 200),
      summary: `${m.name} moved ${change >= 0 ? '+' : ''}${change}% in the wrong direction (n=${m.sampleSize}, ${m.window}).`,
      recommendation: { action: 'investigate_metric', value: m.name, detail: `source: ${m.source}` },
      confidence: Math.min(0.8, round2(0.3 + 0.02 * m.sampleSize)),
      sampleSize: m.sampleSize,
      evidence: [
        { source: m.source, metric: m.name, value: m.value, window: m.window, sampleSize: m.sampleSize, asOf: now.toISOString() },
        { source: m.source, metric: `${m.name}_previous`, value: m.comparison!.value ?? null, window: m.comparison!.period, sampleSize: m.sampleSize, asOf: now.toISOString() },
      ],
      reasoning: [
        `${m.name} changed ${change}% against a better-when-${m.betterWhen ?? 'up'} direction with n=${m.sampleSize} — beyond the ${ATTENTION_THRESHOLD_PCT}% attention threshold.`,
      ],
      expectedOutcome: 'Understanding whether the shift is noise, seasonality, or a real regression.',
      expectedValue: { metric: m.name, delta: 'return toward prior-week level', horizon: '2 weeks' },
      alternatives: [{ action: 'wait_one_window', tradeoff: 'more evidence, later diagnosis' }],
      why: 'Largest wrong-direction move above threshold this week.',
      whyNot: 'One week of change can be noise at current volume.',
      rollback: 'Advisory only — nothing executes.',
      businessImpact: 'Early detection of a regressing marketplace metric.',
      userImpact: 'None directly.',
      safetyImpact: 'none — no safety surface is read or affected',
      revenueImpact: isMoney ? 'Directly tied to the moving money metric.' : 'Indirect.',
      trustImpact: 'Neutral.',
      constitutionTags: isMoney ? ['move_money', 'meaningful_ai'] : ['move_people', 'meaningful_ai'],
      sourceVersion: FOCUS_RULES_VERSION,
      rulesVersion: FOCUS_RULES_VERSION,
      ...(isMoney && { canonicalFinancialSource: canonicalSource }),
      canonicalRefs: { metric: m.name, window: windowLabel },
      expiresAt: new Date(now.getTime() + PRIORITY_TTL_DAYS * 86_400_000).toISOString(),
    };
  }
}
