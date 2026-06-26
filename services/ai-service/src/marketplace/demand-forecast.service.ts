import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface DemandForecast {
  horizon: '15min' | '30min' | '1h' | '4h' | '24h';
  horizonMinutes: number;
  predictedRequests: number;
  predictedMultiplier: number;
  confidence: number;
  trend: 'rising' | 'stable' | 'falling';
}

// Hour-of-day demand multiplier (0 = midnight)
const HOUR_FACTORS = [
  0.30, 0.20, 0.15, 0.15, 0.20, 0.35, // 0–5
  0.55, 0.85, 1.20, 1.00, 0.85, 0.80, // 6–11
  0.90, 0.85, 0.80, 0.85, 1.10, 1.30, // 12–17
  1.40, 1.35, 1.20, 1.00, 0.80, 0.55, // 18–23
];

const SURGE_THRESHOLD = 150;

function zoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

@Injectable()
export class DemandForecastService {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis) {}

  async forecast(lat: number, lng: number): Promise<DemandForecast[]> {
    const zone = zoneKey(lat, lng);
    const currentRequestsRaw = await this.redis?.get(`surge:requests:${zone}`).catch(() => null);
    const currentRequests = currentRequestsRaw ? parseInt(currentRequestsRaw, 10) : 0;
    const now = new Date();
    const currentHour = now.getHours();

    const horizons: Array<{ label: DemandForecast['horizon']; minutes: number }> = [
      { label: '15min', minutes: 15 },
      { label: '30min', minutes: 30 },
      { label: '1h', minutes: 60 },
      { label: '4h', minutes: 240 },
      { label: '24h', minutes: 1440 },
    ];

    return horizons.map(({ label, minutes }) => {
      const futureHour = Math.floor((currentHour + minutes / 60)) % 24;
      const currentFactor = HOUR_FACTORS[currentHour];
      const futureFactor = HOUR_FACTORS[futureHour];

      const ratio = currentFactor > 0 ? futureFactor / currentFactor : 1;
      const predictedRequests = Math.max(0, Math.round(currentRequests * ratio));
      const predictedMultiplier = Math.min(2.5, Math.max(1.0, 1 + (predictedRequests / SURGE_THRESHOLD) * 1.5));

      // Confidence decays with horizon
      const confidence = minutes <= 30 ? 0.80 : minutes <= 60 ? 0.68 : minutes <= 240 ? 0.52 : 0.35;

      const trend: DemandForecast['trend'] =
        ratio > 1.1 ? 'rising' : ratio < 0.9 ? 'falling' : 'stable';

      return {
        horizon: label,
        horizonMinutes: minutes,
        predictedRequests,
        predictedMultiplier: Math.round(predictedMultiplier * 100) / 100,
        confidence,
        trend,
      };
    });
  }
}
