import { Injectable } from '@nestjs/common';

// Transparent v1 fare-adjustment model — deterministic and explainable by
// construction (AI Core Phase 2: no black boxes). Produces the REAL
// recommendation that is always logged; whether it is SERVED is decided by
// ShadowModeService. The platform additionally clamps whatever it receives
// to ±$2.00 (pricing-service fare engine), so this engine's own cap is a
// second belt, not the only one.
export const FARE_ENGINE_VERSION = 'fare-shadow-v1';

const CAP = 2.0;

export interface FareFactors {
  surgeZoneScore?: number;
  isNight?: boolean;
  isAirport?: boolean;
  hourOfDay?: number;
  riderTotalTrips?: number;
}

export interface FareRecommendation {
  adjustment: number;
  confidence: number;
  explanation: string;
  factors: Array<{ name: string; value: number | boolean; weight: number; contribution: number }>;
}

@Injectable()
export class FareAdjustmentEngine {
  recommend(f: FareFactors): FareRecommendation {
    const factors: FareRecommendation['factors'] = [];

    const surge = typeof f.surgeZoneScore === 'number' ? Math.max(0, Math.min(1, f.surgeZoneScore)) : 0;
    const surgeContribution = surge * 1.5;
    factors.push({ name: 'zone_demand', value: surge, weight: 1.5, contribution: round2(surgeContribution) });

    const nightContribution = f.isNight ? 0.25 : 0;
    factors.push({ name: 'night_ride', value: !!f.isNight, weight: 0.25, contribution: nightContribution });

    const airportContribution = f.isAirport ? 0.25 : 0;
    factors.push({ name: 'airport_trip', value: !!f.isAirport, weight: 0.25, contribution: airportContribution });

    // Loyal riders get a slight downward nudge — demand-shaping, not identity
    // pricing (rider trip count only; trust scores are NEVER a fare input —
    // anti-discrimination guardrail, see ai-core-architecture.md §8).
    const loyaltyContribution = (f.riderTotalTrips ?? 0) >= 25 ? -0.25 : 0;
    factors.push({ name: 'rider_loyalty', value: f.riderTotalTrips ?? 0, weight: -0.25, contribution: loyaltyContribution });

    const raw = surgeContribution + nightContribution + airportContribution + loyaltyContribution;
    const adjustment = round2(Math.max(-CAP, Math.min(CAP, raw)));

    // Confidence reflects feature completeness of the inputs we actually use.
    const provided = [f.surgeZoneScore, f.isNight, f.isAirport, f.riderTotalTrips]
      .filter((v) => v !== undefined).length;
    const confidence = round2(0.4 + 0.15 * provided);

    const active = factors.filter((x) => x.contribution !== 0);
    const explanation = active.length === 0
      ? 'No demand, time-of-day, or trip-type signals warrant an adjustment.'
      : `Adjustment of $${adjustment.toFixed(2)} from: ` +
        active.map((x) => `${x.name} (${x.contribution >= 0 ? '+' : ''}$${x.contribution.toFixed(2)})`).join(', ') +
        '.';

    return { adjustment, confidence, explanation, factors };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
