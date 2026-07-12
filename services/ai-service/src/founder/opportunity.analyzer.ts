import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationLedgerService } from '../recommendations/recommendation-ledger.service';
import {
  EvidenceItem, INSUFFICIENT_EVIDENCE, MIN_SAMPLE_SIZE, UniversalRecommendation,
} from '../recommendations/recommendation.types';
import { briefWindow, changePct, latestQualityClasses, moneyEligible, round2, zoneKey } from './briefs/brief-helpers';

// ─── Opportunity Intelligence v1 (Founder-facing ONLY) ───────────────────────
// Answers one question with evidence: "where is there a measurable
// marketplace opportunity?" Zone-level aggregates only — NO personalization
// to individual riders or drivers in this milestone (manifest prohibition).
// Output is one standing recommendation in the universal format, written to
// the ledger. Advisory only: acting on it is a separate human workflow.

export const OPPORTUNITY_RULES_VERSION = 'opportunity-v1';

// Zone earnings below this per-trip average is flagged as an earnings gap.
const DRIVER_EARNINGS_TARGET_PER_TRIP = 10.0;
const RECOMMENDATION_TTL_DAYS = 7;

interface ZoneStats {
  zone: string;
  trips: number;
  prevTrips: number;
  completed: number;
  cancelled: number;
  completionRate: number | null;
  cancellationRate: number | null;
  growthPct: number | null;
  offerOutcomes: number;
  offerAcceptance: number | null;
  moneyTrips: number;
  avgDriverEarnings: number | null;
  distinctDrivers: number;
}

interface Opportunity {
  kind: string;
  zone: string;
  score: number;
  headline: string;
  detail: string;
  stats: ZoneStats;
}

@Injectable()
export class OpportunityAnalyzer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: RecommendationLedgerService,
  ) {}

  /** Analyze and write ONE standing recommendation to the ledger. */
  async generate(now = new Date()): Promise<{ id: string; kind: string; zone?: string; deduplicated?: boolean }> {
    const stats = await this.zoneStats(now);
    const evidenced = stats.filter((z) => z.trips >= MIN_SAMPLE_SIZE);
    const thin = stats.filter((z) => z.trips < MIN_SAMPLE_SIZE);
    const w = briefWindow(7, now);

    // Same-window dedup: if an undecided opportunity recommendation for this
    // window already sits in the inbox, return it instead of a duplicate the
    // Founder would have to burn a dismissal on.
    const existing = await this.prisma.aiRecommendation.findFirst({
      where: {
        domain: 'opportunity',
        family: 'zone-opportunity',
        status: { in: ['proposed', 'viewed'] },
        canonicalRefs: { path: ['window'], equals: w.label },
      },
      select: { id: true, recommendationType: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { id: existing.id, kind: 'deduplicated', deduplicated: true };
    }

    if (evidenced.length === 0) {
      // Honest empty answer — never invent an opportunity from thin data.
      const rec = this.insufficientEvidenceRecommendation(stats, w.label, now);
      const { id } = await this.ledger.create(rec);
      return { id, kind: 'insufficient_evidence' };
    }

    const best = this.pickBest(evidenced);
    const rec = this.toRecommendation(best, thin.map((t) => t.zone), w.label, now);
    const { id } = await this.ledger.create(rec);
    return { id, kind: best.kind, zone: best.zone };
  }

  private async zoneStats(now: Date): Promise<ZoneStats[]> {
    const w = briefWindow(7, now);
    const [trips, prevTrips, qualityClasses, outcomes] = await Promise.all([
      this.prisma.trip.findMany({
        where: { createdAt: { gte: w.start, lte: w.end } },
        select: { id: true, status: true, pickupLat: true, pickupLng: true, driverEarnings: true, earningsSupplement: true, driverId: true, finalFare: true },
      }),
      this.prisma.trip.findMany({
        where: { createdAt: { gte: w.prevStart, lt: w.prevEnd } },
        select: { pickupLat: true, pickupLng: true },
      }),
      latestQualityClasses(this.prisma),
      this.prisma.bidOutcome.findMany({
        where: { createdAt: { gte: w.start, lte: w.end }, zoneKey: { not: null } },
        select: { zoneKey: true, wasAccepted: true },
      }),
    ]);

    const prevByZone = new Map<string, number>();
    for (const t of prevTrips) {
      const z = zoneKey(Number(t.pickupLat), Number(t.pickupLng));
      prevByZone.set(z, (prevByZone.get(z) ?? 0) + 1);
    }

    const byZone = new Map<string, ZoneStats>();
    for (const t of trips) {
      const z = zoneKey(Number(t.pickupLat), Number(t.pickupLng));
      const s = byZone.get(z) ?? {
        zone: z, trips: 0, prevTrips: prevByZone.get(z) ?? 0, completed: 0, cancelled: 0,
        completionRate: null, cancellationRate: null, growthPct: null,
        offerOutcomes: 0, offerAcceptance: null, moneyTrips: 0, avgDriverEarnings: null, distinctDrivers: 0,
      };
      s.trips += 1;
      if (t.status === 'completed') s.completed += 1;
      if (t.status === 'cancelled') s.cancelled += 1;
      byZone.set(z, s);
    }

    // Per-zone money + driver counts (Trusted/Reconciled only for money).
    const driversByZone = new Map<string, Set<string>>();
    const earningsByZone = new Map<string, { sum: number; n: number }>();
    for (const t of trips) {
      const z = zoneKey(Number(t.pickupLat), Number(t.pickupLng));
      if (t.driverId) {
        const set = driversByZone.get(z) ?? new Set<string>();
        set.add(t.driverId);
        driversByZone.set(z, set);
      }
      if (t.status === 'completed' && t.driverEarnings != null && moneyEligible(qualityClasses, t.id)) {
        const e = earningsByZone.get(z) ?? { sum: 0, n: 0 };
        e.sum += Number(t.driverEarnings) + Number(t.earningsSupplement ?? 0);
        e.n += 1;
        earningsByZone.set(z, e);
      }
    }

    const offersByZone = new Map<string, { total: number; accepted: number }>();
    for (const o of outcomes) {
      const agg = offersByZone.get(o.zoneKey!) ?? { total: 0, accepted: 0 };
      agg.total += 1;
      if (o.wasAccepted) agg.accepted += 1;
      offersByZone.set(o.zoneKey!, agg);
    }

    for (const s of byZone.values()) {
      const terminal = s.completed + s.cancelled;
      s.completionRate = terminal ? round2((s.completed / terminal) * 100) : null;
      s.cancellationRate = terminal ? round2((s.cancelled / terminal) * 100) : null;
      s.growthPct = changePct(s.trips, s.prevTrips);
      const offers = offersByZone.get(s.zone);
      s.offerOutcomes = offers?.total ?? 0;
      s.offerAcceptance = offers?.total ? round2((offers.accepted / offers.total) * 100) : null;
      const earnings = earningsByZone.get(s.zone);
      s.moneyTrips = earnings?.n ?? 0;
      s.avgDriverEarnings = earnings?.n ? round2(earnings.sum / earnings.n) : null;
      s.distinctDrivers = driversByZone.get(s.zone)?.size ?? 0;
    }
    return [...byZone.values()];
  }

  private pickBest(zones: ZoneStats[]): Opportunity {
    const candidates: Opportunity[] = [];
    for (const z of zones) {
      // Supply shortage: demand present, very few distinct drivers serving it.
      if (z.trips >= MIN_SAMPLE_SIZE && z.distinctDrivers <= 2) {
        candidates.push({
          kind: 'supply_shortage', zone: z.zone, score: z.trips / Math.max(1, z.distinctDrivers),
          headline: `Supply shortage in zone ${z.zone}`,
          detail: `${z.trips} ride requests were served by only ${z.distinctDrivers} distinct driver(s).`,
          stats: z,
        });
      }
      // Demand growth.
      if (z.growthPct != null && z.growthPct >= 50 && z.prevTrips >= MIN_SAMPLE_SIZE) {
        candidates.push({
          kind: 'demand_growth', zone: z.zone, score: z.growthPct / 10,
          headline: `Demand growing ${z.growthPct}% in zone ${z.zone}`,
          detail: `${z.prevTrips} → ${z.trips} requests week over week.`,
          stats: z,
        });
      }
      // Low completion / high cancellation.
      if (z.completionRate != null && z.completionRate < 70) {
        candidates.push({
          kind: 'low_completion', zone: z.zone, score: (100 - z.completionRate) / 10,
          headline: `Low completion (${z.completionRate}%) in zone ${z.zone}`,
          detail: `${z.cancelled} of ${z.completed + z.cancelled} terminal trips cancelled.`,
          stats: z,
        });
      }
      // Strong offer acceptance.
      if (z.offerAcceptance != null && z.offerOutcomes >= MIN_SAMPLE_SIZE && z.offerAcceptance >= 70) {
        candidates.push({
          kind: 'strong_offer_acceptance', zone: z.zone, score: z.offerAcceptance / 20,
          headline: `Offers clear at ${z.offerAcceptance}% in zone ${z.zone}`,
          detail: `${z.offerOutcomes} offer outcomes with high acceptance — offer-first growth candidate.`,
          stats: z,
        });
      }
      // Driver earnings below target.
      if (z.avgDriverEarnings != null && z.moneyTrips >= MIN_SAMPLE_SIZE && z.avgDriverEarnings < DRIVER_EARNINGS_TARGET_PER_TRIP) {
        candidates.push({
          kind: 'driver_earnings_gap', zone: z.zone, score: (DRIVER_EARNINGS_TARGET_PER_TRIP - z.avgDriverEarnings) / 2,
          headline: `Driver take-home averages $${z.avgDriverEarnings} in zone ${z.zone}`,
          detail: `Below the $${DRIVER_EARNINGS_TARGET_PER_TRIP} per-trip target across ${z.moneyTrips} quality-gated trips.`,
          stats: z,
        });
      }
    }
    if (candidates.length === 0) {
      // Evidenced zones exist but nothing crosses a threshold — report the busiest zone honestly as "healthy".
      const busiest = [...zones].sort((a, b) => b.trips - a.trips)[0];
      return {
        kind: 'no_actionable_gap', zone: busiest.zone, score: 0,
        headline: 'No measurable marketplace gap crossed its threshold this window',
        detail: `Busiest zone ${busiest.zone} (${busiest.trips} requests) shows no shortage, churn, or earnings gap.`,
        stats: busiest,
      };
    }
    return candidates.sort((a, b) => b.score - a.score)[0];
  }

  private toRecommendation(opp: Opportunity, thinZones: string[], window: string, now: Date): UniversalRecommendation {
    const z = opp.stats;
    const asOf = now.toISOString();
    const evidence: EvidenceItem[] = [
      { source: 'trips (canonical)', metric: 'zone_requests', value: z.trips, window, sampleSize: z.trips, asOf },
      { source: 'trips (canonical)', metric: 'zone_requests_previous_window', value: z.prevTrips, window, sampleSize: z.prevTrips, asOf },
      { source: 'trips (canonical)', metric: 'completion_rate_pct', value: z.completionRate, window, sampleSize: z.completed + z.cancelled, asOf },
      { source: 'bid_outcomes (operational)', metric: 'offer_acceptance_pct', value: z.offerAcceptance, window, sampleSize: z.offerOutcomes, asOf },
      { source: 'trips.driverEarnings + earningsSupplement (canonical, Trusted/Reconciled only)', metric: 'avg_driver_take_home_usd', value: z.avgDriverEarnings, window, sampleSize: z.moneyTrips, asOf },
      { source: 'trips.driverId distinct (canonical)', metric: 'distinct_drivers_serving_zone', value: z.distinctDrivers, window, sampleSize: z.trips, asOf },
    ];

    const confidence = Math.min(0.9, round2(0.3 + 0.02 * z.trips)); // sample-driven, never certain
    return {
      domain: 'opportunity',
      family: 'zone-opportunity',
      recommendationType: 'marketplace_opportunity',
      title: opp.headline.slice(0, 200),
      summary: `${opp.detail} Window ${window}.`,
      recommendation: {
        action: 'review_zone_opportunity',
        value: opp.zone,
        unit: 'zoneKey',
        detail: `${opp.kind}: ${opp.detail}`,
      },
      confidence,
      sampleSize: z.trips,
      evidence,
      reasoning: [
        `Zone ${opp.zone} was analyzed over ${window} against supply, growth, completion, offer-acceptance, and earnings thresholds.`,
        `Signal "${opp.kind}" scored highest: ${opp.detail}`,
        `Confidence ${confidence} reflects the zone's sample size (n=${z.trips}); this is aggregate zone data — no individual rider or driver is identified.`,
      ],
      expectedOutcome: this.expectedOutcome(opp),
      expectedValue: { metric: 'weekly_zone_trips', delta: this.expectedDelta(opp), horizon: '4 weeks after action' },
      alternatives: [
        { action: 'wait_one_more_window', expectedValue: 'unchanged', tradeoff: 'stronger evidence, but the gap persists a week longer' },
        { action: 'review_neighboring_zones_jointly', tradeoff: 'wider blast radius; current evidence is zone-specific' },
      ],
      why: `The ${opp.kind.replace(/_/g, ' ')} signal exceeded its threshold with n=${z.trips} evidence in a single zone — the most measurable gap this window.`,
      whyNot: `Alpha volume is small (n=${z.trips}); one week of zone data can be noisy. ${thinZones.length ? `Zones ${thinZones.join(', ')} had insufficient evidence and were excluded.` : 'No zones were excluded for thin evidence.'}`,
      rollback: 'Advisory only — adopting records a decision, nothing executes. Any action taken can be reversed by reversing that action; dismiss the recommendation to remove it from the inbox.',
      businessImpact: 'Focuses operational attention on the single most evidenced marketplace gap.',
      userImpact: 'None directly — no rider or driver sees this; any follow-up action goes through existing product workflows.',
      safetyImpact: 'none — no safety surface is read or affected',
      revenueImpact: 'Indirect: addressing the gap should lift completed trips in the zone.',
      trustImpact: 'Positive if acted on transparently; no user-facing change from the recommendation itself.',
      constitutionTags: ['move_people', 'help_businesses', 'meaningful_ai'],
      sourceVersion: OPPORTUNITY_RULES_VERSION,
      rulesVersion: OPPORTUNITY_RULES_VERSION,
      // The earnings evidence makes this money-referencing: name the
      // canonical source explicitly (validator enforces it).
      canonicalFinancialSource: 'trips.driverEarnings + earningsSupplement (canonical, Trusted/Reconciled only)',
      canonicalRefs: { zoneKey: opp.zone, window },
      expiresAt: new Date(now.getTime() + RECOMMENDATION_TTL_DAYS * 86_400_000).toISOString(),
    };
  }

  private insufficientEvidenceRecommendation(stats: ZoneStats[], window: string, now: Date): UniversalRecommendation {
    const totalTrips = stats.reduce((s, z) => s + z.trips, 0);
    return {
      domain: 'opportunity',
      family: 'zone-opportunity',
      recommendationType: 'marketplace_opportunity',
      title: 'Insufficient evidence for a zone opportunity this window',
      summary: `Only ${totalTrips} requests across ${stats.length} zones in ${window} — no zone reaches the n=${MIN_SAMPLE_SIZE} evidence floor.`,
      recommendation: { action: 'no_action', detail: 'Collect more marketplace data before acting on zone-level signals.' },
      confidence: 0.2,
      // Honest n: the real total, even when it exceeds the per-zone floor —
      // the insufficiency is per-zone, which the summary states.
      sampleSize: totalTrips,
      evidence: [
        { source: 'trips (canonical)', metric: 'total_requests', value: totalTrips, window, sampleSize: totalTrips, asOf: now.toISOString() },
      ],
      reasoning: [`No zone reached n=${MIN_SAMPLE_SIZE} in ${window}; an opportunity claim would be noise, not evidence.`],
      expectedOutcome: 'No action taken; re-analyze next window.',
      expectedValue: INSUFFICIENT_EVIDENCE,
      alternatives: [],
      why: 'The honest answer at current volume.',
      whyNot: 'Acting on sub-threshold zone data risks optimizing noise.',
      rollback: 'Nothing to roll back — no action recommended.',
      businessImpact: 'None this window.',
      userImpact: 'None.',
      safetyImpact: 'none — no safety surface is read or affected',
      revenueImpact: 'None this window.',
      trustImpact: 'Positive: the system says "not enough evidence" instead of inventing certainty.',
      constitutionTags: ['meaningful_ai'],
      sourceVersion: OPPORTUNITY_RULES_VERSION,
      rulesVersion: OPPORTUNITY_RULES_VERSION,
      insufficientEvidence: true,
      canonicalRefs: { window },
      expiresAt: new Date(now.getTime() + RECOMMENDATION_TTL_DAYS * 86_400_000).toISOString(),
    };
  }

  private expectedOutcome(opp: Opportunity): string {
    switch (opp.kind) {
      case 'supply_shortage': return 'More drivers serving the zone reduces match time and lost requests.';
      case 'demand_growth': return 'Meeting growing demand converts growth into completed trips instead of churn.';
      case 'low_completion': return 'Diagnosing cancellations lifts the zone completion rate toward platform average.';
      case 'strong_offer_acceptance': return 'Leaning into offer-first flows where they demonstrably clear.';
      case 'driver_earnings_gap': return 'Closing the earnings gap improves driver retention in the zone.';
      default: return 'No action expected to change outcomes this window.';
    }
  }

  private expectedDelta(opp: Opportunity): string {
    return opp.kind === 'no_actionable_gap' ? '+0' : `directionally positive — magnitude unquantifiable at n=${opp.stats.trips}`;
  }
}
