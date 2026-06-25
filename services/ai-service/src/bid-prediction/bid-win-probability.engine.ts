import { Injectable } from '@nestjs/common';

export interface BidWinProbabilityInput {
  bidAmount: number;
  aiFare: number;
  distanceMiles?: number;
  etaMinutes?: number;
  riderTrustScore?: number;
  driverTrustScore?: number;
  isAirport?: boolean;
  weatherFactor?: number;
  timeOfDay?: number;
  driverAcceptanceHistory?: number;
  driverCancellationRate?: number;
  driverResponseTimeMs?: number;
  currentZoneDemand?: number;
  availableDriversInZone?: number;
  historicalAcceptanceRate?: number;
}

export interface BidWinProbabilityOutput {
  probability: number;
  confidence: number;
  explanation: string[];
}

export const BID_ENGINE_VERSION = 'rule-v1';
const TOTAL_SIGNALS = 13;

@Injectable()
export class BidWinProbabilityEngine {
  predict(input: BidWinProbabilityInput): BidWinProbabilityOutput {
    const explanation: string[] = [];
    let delta = 0;
    let signalsPresent = 0;

    // 1. Bid ratio — most influential signal
    const aiFare = input.aiFare > 0 ? input.aiFare : 1;
    const bidRatio = input.bidAmount / aiFare;
    if (bidRatio >= 1.05) {
      delta += 0.15;
      explanation.push('Bid above market rate');
    } else if (bidRatio >= 0.97) {
      delta += 0.05;
    } else if (bidRatio >= 0.90) {
      // at-market: no adjustment
    } else if (bidRatio >= 0.83) {
      delta -= 0.10;
      explanation.push('Bid below market');
    } else {
      delta -= 0.20;
      explanation.push('Bid significantly below market');
    }

    // 2. Rider trust score (0–1000)
    const riderScore = input.riderTrustScore ?? 500;
    if (input.riderTrustScore !== undefined) signalsPresent++;
    if (riderScore >= 800) {
      delta += 0.10;
      explanation.push('High rider trust');
    } else if (riderScore >= 650) {
      delta += 0.05;
      explanation.push('Good rider trust');
    } else if (riderScore < 350) {
      delta -= 0.12;
      explanation.push('Low rider trust score');
    } else if (riderScore < 500) {
      delta -= 0.05;
    }

    // 3. Driver trust score (0–1000)
    const driverScore = input.driverTrustScore ?? 500;
    if (input.driverTrustScore !== undefined) signalsPresent++;
    if (driverScore >= 800) {
      delta += 0.05;
      explanation.push('Verified high-trust driver');
    } else if (driverScore < 400) {
      delta -= 0.08;
    }

    // 4. Available drivers in zone
    if (input.availableDriversInZone !== undefined) signalsPresent++;
    const driversInZone = input.availableDriversInZone ?? -1;
    if (driversInZone >= 8) {
      delta += 0.12;
      explanation.push('Strong driver availability');
    } else if (driversInZone >= 5) {
      delta += 0.07;
      explanation.push('Good driver availability');
    } else if (driversInZone === 0) {
      delta -= 0.20;
      explanation.push('No drivers available in zone');
    } else if (driversInZone >= 1 && driversInZone <= 2) {
      delta -= 0.08;
      explanation.push('Limited driver availability');
    }

    // 5. Zone demand (0–1)
    if (input.currentZoneDemand !== undefined) signalsPresent++;
    const zoneDemand = input.currentZoneDemand ?? -1;
    if (zoneDemand > 0.8) {
      delta += 0.08;
      explanation.push('Peak demand — drivers actively seeking');
    } else if (zoneDemand > 0.6) {
      delta += 0.04;
      explanation.push('High zone demand');
    } else if (zoneDemand >= 0 && zoneDemand < 0.2) {
      delta -= 0.05;
      explanation.push('Low zone demand');
    }

    // 6. Airport flag
    if (input.isAirport !== undefined) signalsPresent++;
    if (input.isAirport) {
      delta += 0.08;
      explanation.push('Airport trip — high driver motivation');
    }

    // 7. Weather factor (1.0 = normal, > 1 = adverse)
    if (input.weatherFactor !== undefined) signalsPresent++;
    const weather = input.weatherFactor ?? 1.0;
    if (weather >= 1.4) {
      delta += 0.12;
      explanation.push('Adverse weather — drivers in high demand');
    } else if (weather >= 1.2) {
      delta += 0.06;
      explanation.push('Weather increasing demand');
    } else if (weather >= 1.1) {
      delta += 0.03;
    }

    // 8. Time of day
    if (input.timeOfDay !== undefined) signalsPresent++;
    const hour = input.timeOfDay ?? new Date().getHours();
    if (hour >= 7 && hour <= 9) {
      delta += 0.05;
      explanation.push('Morning peak hours');
    } else if (hour >= 17 && hour <= 20) {
      delta += 0.07;
      explanation.push('Evening peak hours');
    } else if (hour >= 22 || hour <= 4) {
      delta -= 0.04;
    }

    // 9. Driver acceptance history (0–1)
    if (input.driverAcceptanceHistory !== undefined) signalsPresent++;
    const acceptanceHistory = input.driverAcceptanceHistory ?? -1;
    if (acceptanceHistory >= 0.85) {
      delta += 0.05;
      explanation.push('Strong driver acceptance history');
    } else if (acceptanceHistory >= 0.65) {
      delta += 0.02;
    } else if (acceptanceHistory >= 0 && acceptanceHistory < 0.50) {
      delta -= 0.08;
      explanation.push('Driver has low acceptance rate');
    }

    // 10. Driver cancellation rate (0–1)
    if (input.driverCancellationRate !== undefined) signalsPresent++;
    const cancellationRate = input.driverCancellationRate ?? -1;
    if (cancellationRate > 0.15) {
      delta -= 0.07;
      explanation.push('High driver cancellation risk');
    } else if (cancellationRate > 0.10) {
      delta -= 0.03;
    }

    // 11. Driver response time (ms)
    if (input.driverResponseTimeMs !== undefined) signalsPresent++;
    const responseTimeMs = input.driverResponseTimeMs ?? -1;
    if (responseTimeMs >= 0 && responseTimeMs < 8000) {
      delta += 0.03;
      explanation.push('Fast driver response time');
    } else if (responseTimeMs > 45000) {
      delta -= 0.04;
    }

    // 12. Historical zone acceptance rate (0–1)
    if (input.historicalAcceptanceRate !== undefined) signalsPresent++;
    const historicalRate = input.historicalAcceptanceRate ?? -1;
    if (historicalRate >= 0.75) {
      delta += 0.06;
      explanation.push('Strong historical acceptance in this zone');
    } else if (historicalRate >= 0 && historicalRate < 0.40) {
      delta -= 0.06;
      explanation.push('Low historical acceptance in this zone');
    }

    // 13. ETA (minutes)
    if (input.etaMinutes !== undefined) signalsPresent++;
    const eta = input.etaMinutes ?? -1;
    if (eta >= 0 && eta <= 5) {
      delta += 0.04;
      explanation.push('Short ETA');
    } else if (eta > 20) {
      delta -= 0.03;
    }

    // Probability: base 0.50 + weighted adjustments, clamped [0.05, 0.95]
    const raw = 0.50 + delta;
    const probability = Math.max(0.05, Math.min(0.95, raw));

    // Confidence: 0.55 base + up to 0.33 for signal coverage, max 0.88 (rule-based cap)
    const confidence = Math.min(0.88, 0.55 + 0.33 * (signalsPresent / TOTAL_SIGNALS));

    return {
      probability: Math.round(probability * 10000) / 10000,
      confidence: Math.round(confidence * 10000) / 10000,
      explanation: explanation.slice(0, 5),
    };
  }
}
