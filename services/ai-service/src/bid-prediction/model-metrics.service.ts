import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BID_ENGINE_VERSION } from './bid-win-probability.engine';

export interface CalibrationBucket {
  bucket: string;
  predicted: number;
  actual: number;
  count: number;
}

export interface ZoneMetric {
  zone: string;
  predictions: number;
  accuracy: number;
}

export interface HourMetric {
  hour: number;
  predictions: number;
  accuracy: number;
}

export interface ModelMetricsResponse {
  model: { name: string; version: string; type: string };
  predictions: {
    total: number;
    withOutcome: number;
    accuracy: number | null;
    acceptanceRate: number | null;
    avgConfidence: number | null;
    falsePositives: number;
    falseNegatives: number;
    precision: number | null;
    recall: number | null;
    rocAucPlaceholder: null;
    calibration: CalibrationBucket[];
  };
  latency: { avgMs: number; p50Ms: number; p95Ms: number };
  fallbackRate: number | null;
  byZone: ZoneMetric[];
  byHour: HourMetric[];
}

type ZoneRow = { zone_key: string; total: number; correct: number };
type HourRow = { hour: number; total: number; correct: number };

@Injectable()
export class ModelMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(): Promise<ModelMetricsResponse> {
    const [inferenceSummary, outcomeSummary, byZoneRows, byHourRows, allOutcomes] =
      await Promise.all([
        this.getInferenceSummary(),
        this.getOutcomeSummary(),
        this.getByZone(),
        this.getByHour(),
        this.getOutcomesForCalibration(),
      ]);

    const calibration = this.computeCalibration(allOutcomes);

    const tp = outcomeSummary.truePositives;
    const fp = outcomeSummary.falsePositives;
    const fn = outcomeSummary.falseNegatives;
    const withOutcome = outcomeSummary.withOutcome;

    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall = tp + fn > 0 ? tp / (tp + fn) : null;
    const accuracy = withOutcome > 0 ? outcomeSummary.correct / withOutcome : null;
    const acceptanceRate =
      outcomeSummary.total > 0 ? outcomeSummary.accepted / outcomeSummary.total : null;

    return {
      model: { name: 'bid-win-probability', version: BID_ENGINE_VERSION, type: 'rule-based' },
      predictions: {
        total: inferenceSummary.total,
        withOutcome,
        accuracy: accuracy !== null ? Math.round(accuracy * 1000) / 1000 : null,
        acceptanceRate: acceptanceRate !== null ? Math.round(acceptanceRate * 1000) / 1000 : null,
        avgConfidence:
          inferenceSummary.avgConfidence !== null
            ? Math.round(inferenceSummary.avgConfidence * 1000) / 1000
            : null,
        falsePositives: fp,
        falseNegatives: fn,
        precision: precision !== null ? Math.round(precision * 1000) / 1000 : null,
        recall: recall !== null ? Math.round(recall * 1000) / 1000 : null,
        rocAucPlaceholder: null,
        calibration,
      },
      latency: inferenceSummary.latency,
      fallbackRate: inferenceSummary.fallbackRate,
      byZone: byZoneRows.map((r) => ({
        zone: r.zone_key,
        predictions: Number(r.total),
        accuracy: Number(r.total) > 0 ? Math.round((Number(r.correct) / Number(r.total)) * 1000) / 1000 : 0,
      })),
      byHour: byHourRows.map((r) => ({
        hour: Number(r.hour),
        predictions: Number(r.total),
        accuracy: Number(r.total) > 0 ? Math.round((Number(r.correct) / Number(r.total)) * 1000) / 1000 : 0,
      })),
    };
  }

  private async getInferenceSummary() {
    const logs = await this.prisma.aiInferenceLog.findMany({
      where: { modelName: 'bid-win-probability' },
      select: { confidence: true, fallbackUsed: true, latencyMs: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    if (logs.length === 0) {
      return { total: 0, avgConfidence: null, fallbackRate: null, latency: { avgMs: 0, p50Ms: 0, p95Ms: 0 } };
    }

    const avgConfidence = logs.reduce((s, l) => s + Number(l.confidence), 0) / logs.length;
    const fallbackCount = logs.filter((l) => l.fallbackUsed).length;
    const latencies = logs.map((l) => l.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.ceil(0.5 * latencies.length) - 1] ?? 0;
    const p95 = latencies[Math.ceil(0.95 * latencies.length) - 1] ?? 0;
    const avgMs = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);

    return {
      total: logs.length,
      avgConfidence,
      fallbackRate: fallbackCount / logs.length,
      latency: { avgMs, p50Ms: p50, p95Ms: p95 },
    };
  }

  private async getOutcomeSummary() {
    const outcomes = await this.prisma.bidOutcome.findMany({
      select: { wasAccepted: true, predictionProbability: true, predictionCorrect: true },
    });

    const accepted = outcomes.filter((o) => o.wasAccepted).length;
    const withOutcome = outcomes.filter((o) => o.predictionCorrect !== null).length;
    const correct = outcomes.filter((o) => o.predictionCorrect === true).length;

    // True Positive: predicted >= 0.5 AND was accepted
    const tp = outcomes.filter(
      (o) => o.predictionProbability !== null && Number(o.predictionProbability) >= 0.5 && o.wasAccepted,
    ).length;
    // False Positive: predicted >= 0.5 AND NOT accepted
    const fp = outcomes.filter(
      (o) => o.predictionProbability !== null && Number(o.predictionProbability) >= 0.5 && !o.wasAccepted,
    ).length;
    // False Negative: predicted < 0.5 AND was accepted
    const fn = outcomes.filter(
      (o) => o.predictionProbability !== null && Number(o.predictionProbability) < 0.5 && o.wasAccepted,
    ).length;

    return { total: outcomes.length, accepted, withOutcome, correct, truePositives: tp, falsePositives: fp, falseNegatives: fn };
  }

  private getByZone() {
    return this.prisma.$queryRaw<ZoneRow[]>`
      SELECT zone_key, COUNT(*)::int AS total,
        SUM(CASE WHEN prediction_correct THEN 1 ELSE 0 END)::int AS correct
      FROM bid_outcomes
      WHERE zone_key IS NOT NULL AND prediction_correct IS NOT NULL
      GROUP BY zone_key
      ORDER BY total DESC
      LIMIT 20
    `;
  }

  private getByHour() {
    return this.prisma.$queryRaw<HourRow[]>`
      SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS total,
        SUM(CASE WHEN prediction_correct THEN 1 ELSE 0 END)::int AS correct
      FROM bid_outcomes
      WHERE prediction_correct IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `;
  }

  private async getOutcomesForCalibration() {
    return this.prisma.bidOutcome.findMany({
      where: { predictionProbability: { not: null }, predictionCorrect: { not: null } },
      select: { predictionProbability: true, wasAccepted: true },
      take: 10000,
    });
  }

  private computeCalibration(
    outcomes: { predictionProbability: unknown; wasAccepted: boolean }[],
  ): CalibrationBucket[] {
    const buckets: { label: string; min: number; max: number; total: number; accepted: number; sumPred: number }[] = [
      { label: '0.0–0.2', min: 0, max: 0.2, total: 0, accepted: 0, sumPred: 0 },
      { label: '0.2–0.4', min: 0.2, max: 0.4, total: 0, accepted: 0, sumPred: 0 },
      { label: '0.4–0.6', min: 0.4, max: 0.6, total: 0, accepted: 0, sumPred: 0 },
      { label: '0.6–0.8', min: 0.6, max: 0.8, total: 0, accepted: 0, sumPred: 0 },
      { label: '0.8–1.0', min: 0.8, max: 1.0, total: 0, accepted: 0, sumPred: 0 },
    ];

    for (const o of outcomes) {
      const prob = Number(o.predictionProbability);
      const bucket = buckets.find((b) => prob >= b.min && prob < b.max) ?? buckets[buckets.length - 1];
      bucket.total++;
      bucket.sumPred += prob;
      if (o.wasAccepted) bucket.accepted++;
    }

    return buckets
      .filter((b) => b.total > 0)
      .map((b) => ({
        bucket: b.label,
        predicted: Math.round((b.sumPred / b.total) * 1000) / 1000,
        actual: Math.round((b.accepted / b.total) * 1000) / 1000,
        count: b.total,
      }));
  }
}
