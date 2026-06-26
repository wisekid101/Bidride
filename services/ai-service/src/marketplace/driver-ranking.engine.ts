import { Injectable } from '@nestjs/common';

export interface DriverRankingCandidate {
  driverUserId: string;
  distanceMiles: number;
  etaMinutes: number;
  trustScore?: number;          // 0–1000
  acceptanceRate?: number;      // 0–1
  cancellationRate?: number;    // 0–1 (1 - completionRate)
  avgResponseTimeMs?: number;
  avgRating?: number;           // 0–5
  hasAirportExperience?: boolean;
  currentSessionEarningsUsd?: number;
  expectedSessionEarningsUsd?: number;
  hoursOnline?: number;
  preferredZoneKeys?: string[];
  currentZoneKey?: string;
  isPreferredByRider?: boolean;
}

export interface DriverRankingResult {
  driverUserId: string;
  score: number;
  rank: number;
  signals: Record<string, number>;
}

export const RANKING_VERSION = 'ranking-v1';

// Maximum possible score breakdown adds to 100
const WEIGHTS = {
  eta: 25,
  distance: 15,
  trust: 12,
  acceptance: 10,
  antiCancel: 8,
  rating: 8,
  responseTime: 7,
  preferredByRider: 5,
  airportExperience: 5,
  earningsFairness: 3,
  freshDriver: 2,
};

@Injectable()
export class DriverRankingEngine {
  scoreCandidate(c: DriverRankingCandidate, isAirportTrip: boolean): { score: number; signals: Record<string, number> } {
    const signals: Record<string, number> = {};

    // ETA (25pts): 0 min = full, ≥30 min = 0
    signals.eta = Math.max(0, WEIGHTS.eta * (1 - c.etaMinutes / 30));

    // Distance (15pts): 0 mi = full, ≥10 mi = 0
    signals.distance = Math.max(0, WEIGHTS.distance * (1 - c.distanceMiles / 10));

    // Trust score (12pts): 0–1000 → 0–12
    signals.trust = WEIGHTS.trust * ((c.trustScore ?? 500) / 1000);

    // Acceptance rate (10pts): 0–1 → 0–10
    signals.acceptance = WEIGHTS.acceptance * (c.acceptanceRate ?? 0.7);

    // Anti-cancellation (8pts): lower cancel = higher score
    signals.antiCancel = WEIGHTS.antiCancel * (1 - (c.cancellationRate ?? 0.05));

    // Rating (8pts): 5-star = 8, 3-star = 0, below 3 = 0
    const ratingNorm = Math.max(0, ((c.avgRating ?? 4.0) - 3) / 2);
    signals.rating = Math.min(WEIGHTS.rating, WEIGHTS.rating * ratingNorm);

    // Response time (7pts): <5s = full, ≥60s = 0
    const respMs = c.avgResponseTimeMs ?? 20000;
    signals.responseTime = Math.max(0, WEIGHTS.responseTime * (1 - respMs / 60000));

    // Preferred by rider (5pts)
    signals.preferredByRider = c.isPreferredByRider ? WEIGHTS.preferredByRider : 0;

    // Airport experience (5pts): only applies to airport trips
    signals.airportExperience =
      isAirportTrip && c.hasAirportExperience ? WEIGHTS.airportExperience : 0;

    // Earnings fairness (3pts): driver closer to their fair-share earns bonus
    if (c.currentSessionEarningsUsd !== undefined && c.expectedSessionEarningsUsd && c.expectedSessionEarningsUsd > 0) {
      const ratio = c.currentSessionEarningsUsd / c.expectedSessionEarningsUsd;
      const deviation = Math.abs(ratio - 1.0);
      signals.earningsFairness = WEIGHTS.earningsFairness * Math.max(0, 1 - deviation);
    } else {
      signals.earningsFairness = WEIGHTS.earningsFairness * 0.5; // neutral default
    }

    // Fresh driver bonus (2pts): online < 4 hours
    signals.freshDriver = (c.hoursOnline ?? 0) < 4 ? WEIGHTS.freshDriver : 0;

    const raw = Object.values(signals).reduce((s, v) => s + v, 0);
    // Round each signal and clamp total to [0, 100]
    const score = Math.min(100, Math.max(0, Math.round(raw * 10) / 10));

    return {
      score,
      signals: Object.fromEntries(
        Object.entries(signals).map(([k, v]) => [k, Math.round(v * 100) / 100]),
      ),
    };
  }

  rank(candidates: DriverRankingCandidate[], isAirportTrip: boolean): DriverRankingResult[] {
    const scored = candidates.map((c) => {
      const { score, signals } = this.scoreCandidate(c, isAirportTrip);
      return { driverUserId: c.driverUserId, score, signals };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.map((s, idx) => ({ ...s, rank: idx + 1 }));
  }
}
