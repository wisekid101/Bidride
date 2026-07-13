import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { QualityClassService } from '../quality/quality-class.service';
import { round2, zoneKey } from './briefs/brief-helpers';
import { MIN_SAMPLE_SIZE } from '../recommendations/recommendation.types';

// ─── Outcome Evidence Snapshots (Phase 3.2, Build Step 2) ────────────────────
// For a DECIDED recommendation with zone canonicalRefs, measure the same
// canonical metrics that formed its original evidence, BEFORE vs AFTER the
// decision. The snapshot is measurement, not judgment: the Founder scores
// outcomes; the suggested score is advisory text derived from direction-aware
// deltas and is NEVER written to outcomeScore by any code path.
//
// Honesty rules: bounded queries only; money via the Trusted/Reconciled gate;
// windows below the sample floor produce insufficientEvidence and NO
// suggested score; copy never implies causation.

export const OUTCOME_SNAPSHOT_VERSION = 'outcome-snapshot-v1';

export interface OutcomeMetric {
  metric: string;
  source: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  sampleSizeBefore: number;
  sampleSizeAfter: number;
  qualityLabel: 'canonical_all' | 'canonical_trusted' | 'operational' | 'insufficient_evidence';
  /** direction that counts as improvement for this metric */
  betterWhen: 'up' | 'down';
}

export interface OutcomeEvidence {
  measuredAt: string;
  horizon: string;
  window: { before: string; after: string; horizonElapsed: boolean };
  metrics: OutcomeMetric[];
  suggestedScore: number | null;
  suggestedScoreBasis: string;
  insufficientEvidence: boolean;
  sourceVersion: string;
}

interface OutcomeConfig {
  horizonDays: number;
  beforeWindowDays: number;
}

const DEFAULT_CONFIG: OutcomeConfig = { horizonDays: 28, beforeWindowDays: 7 };
const CONFIG_KEY = 'ai_outcome_config';
// Normalizers: how much direction-aware change counts as a "full" (1.0) effect.
const NORMALIZERS: Record<string, number> = {
  completion_rate_pct: 25,
  cancellation_rate_pct: 25,
  zone_trips: 0.5, // relative: 50% change
  offer_acceptance_pct: 25,
  avg_driver_take_home_usd: 4,
};

@Injectable()
export class OutcomeSnapshotService {
  private readonly logger = new Logger(OutcomeSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityClassService,
  ) {}

  private async loadConfig(): Promise<OutcomeConfig> {
    try {
      const row = await this.prisma.platformConfig.findUnique({ where: { key: CONFIG_KEY } });
      const raw = (row?.value ?? {}) as Partial<OutcomeConfig>;
      const merged = { ...DEFAULT_CONFIG, ...raw };
      if (!Number.isInteger(merged.horizonDays) || merged.horizonDays < 1 || merged.horizonDays > 90) merged.horizonDays = DEFAULT_CONFIG.horizonDays;
      if (!Number.isInteger(merged.beforeWindowDays) || merged.beforeWindowDays < 1 || merged.beforeWindowDays > 28) merged.beforeWindowDays = DEFAULT_CONFIG.beforeWindowDays;
      return merged;
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Scheduler entry: snapshot decided zone recommendations lacking evidence,
   * in bounded batches. Never loads all pending rows into memory.
   */
  async snapshotDue(batchSize = 100, now = new Date()): Promise<{ snapshotted: number; skipped: number }> {
    const candidates = await this.prisma.aiRecommendation.findMany({
      where: {
        status: { in: ['adopted', 'dismissed', 'outcome_pending'] },
        outcomeEvidence: { equals: Prisma.DbNull },
        canonicalRefs: { path: ['zoneKey'], not: Prisma.DbNull },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(1, batchSize), 100),
      select: { id: true },
    });
    let snapshotted = 0;
    let skipped = 0;
    for (const { id } of candidates) {
      try {
        await this.snapshotOne(id, now);
        snapshotted += 1;
      } catch (e) {
        skipped += 1;
        this.logger.warn(`outcome snapshot skipped for ${id}: ${(e as Error).message}`);
      }
    }
    return { snapshotted, skipped };
  }

  /** Snapshot a single recommendation (scheduler item + manual trigger share this). */
  async snapshotOne(id: string, now = new Date()): Promise<OutcomeEvidence> {
    const config = await this.loadConfig();
    const rec = await this.prisma.aiRecommendation.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!rec) throw new NotFoundException('Recommendation not found');
    const zone = (rec.canonicalRefs as { zoneKey?: string } | null)?.zoneKey;
    if (!zone) throw new Error('recommendation has no zoneKey canonical reference — nothing measurable');

    const decision = rec.events.find((e) => e.action === 'adopt' || e.action === 'dismiss');
    if (!decision) throw new Error('recommendation has no decision event yet');
    const decidedAt = decision.createdAt;

    const beforeStart = new Date(decidedAt.getTime() - config.beforeWindowDays * 86_400_000);
    const horizonEnd = new Date(decidedAt.getTime() + config.horizonDays * 86_400_000);
    const afterEnd = now < horizonEnd ? now : horizonEnd;
    const horizonElapsed = now >= horizonEnd;

    const [before, after] = await Promise.all([
      this.zoneMetrics(zone, beforeStart, decidedAt),
      this.zoneMetrics(zone, decidedAt, afterEnd),
    ]);

    const metrics: OutcomeMetric[] = [
      this.compare('zone_trips', 'trips (canonical)', before.trips, after.trips, before.trips, after.trips, 'up', true),
      this.compare('completion_rate_pct', 'trips (canonical)', before.completionRate, after.completionRate, before.terminal, after.terminal, 'up'),
      this.compare('cancellation_rate_pct', 'trips (canonical)', before.cancellationRate, after.cancellationRate, before.terminal, after.terminal, 'down'),
      this.compare('offer_acceptance_pct', 'bid_outcomes (operational)', before.offerAcceptance, after.offerAcceptance, before.offers, after.offers, 'up'),
      this.compare('avg_driver_take_home_usd', 'trips.driverEarnings + earningsSupplement (canonical, Trusted/Reconciled only)', before.avgTakeHome, after.avgTakeHome, before.moneyTrips, after.moneyTrips, 'up'),
    ];

    const { suggestedScore, basis, insufficient } = this.suggest(metrics, horizonElapsed);

    const evidence: OutcomeEvidence = {
      measuredAt: now.toISOString(),
      horizon: `${config.horizonDays}d after decision (${decidedAt.toISOString().slice(0, 10)})`,
      window: {
        before: `${beforeStart.toISOString().slice(0, 10)}..${decidedAt.toISOString().slice(0, 10)}`,
        after: `${decidedAt.toISOString().slice(0, 10)}..${afterEnd.toISOString().slice(0, 10)}`,
        horizonElapsed,
      },
      metrics,
      suggestedScore,
      suggestedScoreBasis: basis,
      insufficientEvidence: insufficient,
      sourceVersion: OUTCOME_SNAPSHOT_VERSION,
    };

    this.assertEvidenceSafe(evidence);

    await this.prisma.$transaction(async (tx) => {
      await tx.aiRecommendation.update({
        where: { id },
        data: {
          outcomeEvidence: evidence as unknown as Prisma.InputJsonValue,
          // adopted rows move to outcome_pending (awaiting the Founder's
          // score); dismissed rows keep their status — scoring them later is
          // still possible via dismissed → outcome_scored.
          ...(rec.status === 'adopted' && { status: 'outcome_pending' }),
        },
      });
      await tx.aiRecommendationEvent.create({
        data: {
          recommendationId: id,
          actor: 'ai-service',
          actorRole: 'system',
          action: 'attach_outcome_evidence',
          previousStatus: rec.status,
          newStatus: rec.status === 'adopted' ? 'outcome_pending' : rec.status,
          reason: `measured ${metrics.length} zone metrics (${OUTCOME_SNAPSHOT_VERSION}); horizonElapsed=${horizonElapsed}`,
        },
      });
    });
    return evidence;
  }

  /** Bounded zone metrics over [start, end) — the same canonical reads the analyzer used. */
  private async zoneMetrics(zone: string, start: Date, end: Date) {
    const trips = await this.prisma.trip.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { id: true, status: true, pickupLat: true, pickupLng: true, driverEarnings: true, earningsSupplement: true },
    });
    const inZone = trips.filter((t) => zoneKey(Number(t.pickupLat), Number(t.pickupLng)) === zone);
    const completed = inZone.filter((t) => t.status === 'completed');
    const cancelled = inZone.filter((t) => t.status === 'cancelled');
    const terminal = completed.length + cancelled.length;

    const money = await this.quality.moneyEligibleSubset(completed.map((t) => t.id));
    const moneyTrips = completed.filter((t) => money.has(t.id) && t.driverEarnings != null);
    const avgTakeHome = moneyTrips.length
      ? round2(moneyTrips.reduce((s, t) => s + Number(t.driverEarnings) + Number(t.earningsSupplement ?? 0), 0) / moneyTrips.length)
      : null;

    const outcomes = await this.prisma.bidOutcome.findMany({
      where: { createdAt: { gte: start, lt: end }, zoneKey: zone },
      select: { wasAccepted: true },
    });

    return {
      trips: inZone.length,
      terminal,
      completionRate: terminal ? round2((completed.length / terminal) * 100) : null,
      cancellationRate: terminal ? round2((cancelled.length / terminal) * 100) : null,
      offers: outcomes.length,
      offerAcceptance: outcomes.length ? round2((outcomes.filter((o) => o.wasAccepted).length / outcomes.length) * 100) : null,
      moneyTrips: moneyTrips.length,
      avgTakeHome,
    };
  }

  private compare(
    metric: string, source: string,
    before: number | null, after: number | null,
    nBefore: number, nAfter: number,
    betterWhen: 'up' | 'down',
    isCount = false,
  ): OutcomeMetric {
    const sufficient = isCount || (nBefore >= MIN_SAMPLE_SIZE && nAfter >= MIN_SAMPLE_SIZE);
    const usable = sufficient && before !== null && after !== null;
    return {
      metric,
      source,
      before: usable || isCount ? before : null,
      after: usable || isCount ? after : null,
      delta: usable || (isCount && before !== null && after !== null) ? round2((after as number) - (before as number)) : null,
      sampleSizeBefore: nBefore,
      sampleSizeAfter: nAfter,
      qualityLabel: !sufficient
        ? 'insufficient_evidence'
        : source.includes('Trusted') ? 'canonical_trusted' : source.includes('operational') ? 'operational' : 'canonical_all',
      betterWhen,
    };
  }

  private suggest(metrics: OutcomeMetric[], horizonElapsed: boolean): { suggestedScore: number | null; basis: string; insufficient: boolean } {
    // Scoring floor applies to EVERY metric including counts: both windows
    // must clear MIN_SAMPLE_SIZE for a metric to influence the suggestion.
    const usable = metrics.filter(
      (m) =>
        m.qualityLabel !== 'insufficient_evidence' &&
        m.delta !== null &&
        m.before !== null &&
        m.sampleSizeBefore >= MIN_SAMPLE_SIZE &&
        m.sampleSizeAfter >= MIN_SAMPLE_SIZE,
    );
    if (!horizonElapsed) {
      return {
        suggestedScore: null,
        basis: 'no suggested score: the measurement horizon has not fully elapsed — partial windows are shown for information only',
        insufficient: true,
      };
    }
    if (usable.length === 0) {
      return {
        suggestedScore: null,
        basis: `no suggested score: every metric is below the n=${MIN_SAMPLE_SIZE} sample floor in the before or after window`,
        insufficient: true,
      };
    }
    // Direction-aware normalized improvement, averaged and clamped to [0,1]
    // around a 0.5 "no change" midpoint.
    const parts: string[] = [];
    let sum = 0;
    for (const m of usable) {
      const normalizer = NORMALIZERS[m.metric] ?? 1;
      const raw = m.metric === 'zone_trips'
        ? ((m.after as number) - (m.before as number)) / Math.max(1, m.before as number) / normalizer
        : ((m.delta as number) / normalizer);
      const directional = m.betterWhen === 'down' ? -raw : raw;
      const clamped = Math.max(-1, Math.min(1, directional));
      sum += clamped;
      parts.push(`${m.metric}: ${m.before}→${m.after} (${clamped >= 0 ? '+' : ''}${round2(clamped)})`);
    }
    const score = round2(Math.max(0, Math.min(1, 0.5 + (sum / usable.length) / 2)));
    return {
      suggestedScore: score,
      basis:
        `advisory only — direction-aware normalized change across ${usable.length} metric(s): ${parts.join('; ')}. ` +
        'Before/after correlation is NOT causation; external factors are not controlled for. The Founder decides the recorded score.',
      insufficient: false,
    };
  }

  /** Privacy screens over the snapshot before persistence (same rules as recommendations). */
  private assertEvidenceSafe(evidence: OutcomeEvidence): void {
    const flat = JSON.stringify(evidence);
    if (/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/.test(flat)) throw new Error('outcome evidence contains raw coordinates');
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(flat) || /\+1\d{10}/.test(flat)) throw new Error('outcome evidence contains PII');
    if (/sk_live|sk_test_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}/.test(flat)) throw new Error('outcome evidence contains a secret');
    for (const m of evidence.metrics) {
      for (const v of [m.before, m.after, m.delta]) {
        if (v !== null && typeof v !== 'number') throw new Error('outcome metric values must be numbers or null');
      }
    }
  }
}
