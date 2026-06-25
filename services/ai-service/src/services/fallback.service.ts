import { Injectable } from '@nestjs/common';

@Injectable()
export class FallbackService {
  // fare-adjustment: zero adjustment — never distort fare without a trained model
  executeForFareAdjustment(_features: Record<string, unknown>): { adjustment: number } {
    return { adjustment: 0 };
  }

  // fraud-score: rule-based signal combination (mirrors original trust-service logic)
  executeForFraudScore(features: Record<string, unknown>): { fraudProbability: number } {
    let probability = 0;
    if ((features.linkedAccounts as number) > 2)   probability += 30;
    if ((features.deviceFingerprints as number) > 5) probability += 20;
    if ((features.fraudFlagCount as number) > 0)   probability += 40;
    if ((features.disputeCount as number) > 3)     probability += 20;
    if ((features.accountAgeDays as number) < 7 && (features.totalTrips as number) === 0) probability += 10;
    return { fraudProbability: Math.min(100, probability) };
  }

  // bid-win-probability: heuristic based on bid-to-AI-fare ratio
  executeForBidWinProbability(features: Record<string, unknown>): { probability: number } {
    const bid = (features.bidAmount as number) ?? 0;
    const ai  = (features.aiFare as number) ?? 0;
    if (ai <= 0) return { probability: 0.5 };
    const probability = Math.max(0, Math.min(1, 0.4 + (bid / ai) * 0.5));
    return { probability: Math.round(probability * 100) / 100 };
  }

  // surge-forecast: extend current surge counter using existing multiplier formula
  executeForSurgeForecast(features: Record<string, unknown>): { forecastedMultiplier: number } {
    const requests = (features.currentRequests as number) ?? 0;
    const surgeScore = Math.min(1.0, requests / 150);
    return { forecastedMultiplier: Math.round((1.0 + surgeScore * 0.4) * 100) / 100 };
  }

  // driver-earnings: earnings floor formula for a typical Newark trip (~3 mi, ~12 min)
  // Formula: (miles × $1.10) + (minutes × $0.22) + $2.50
  executeForDriverEarnings(_features: Record<string, unknown>): { estimatedEarnings: number } {
    return { estimatedEarnings: Math.round(((3.0 * 1.10) + (12 * 0.22) + 2.50) * 100) / 100 };
  }

  execute(modelName: string, features: Record<string, unknown>): Record<string, unknown> {
    switch (modelName) {
      case 'fare-adjustment':     return this.executeForFareAdjustment(features);
      case 'fraud-score':         return this.executeForFraudScore(features);
      case 'bid-win-probability': return this.executeForBidWinProbability(features);
      case 'surge-forecast':      return this.executeForSurgeForecast(features);
      case 'driver-earnings':     return this.executeForDriverEarnings(features);
      default:                    return {};
    }
  }
}
