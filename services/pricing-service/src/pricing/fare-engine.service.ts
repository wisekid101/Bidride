import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

interface FareInput {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  rideType: string;
  requestedAt?: Date;
  isAirportTrip?: boolean;
  riderTrustScore?: number;
  riderTotalTrips?: number;
}

export interface FareEstimate {
  fare: number;
  distanceMiles: number;
  durationMin: number;
  surgeMultiplier: number;
  breakdown: {
    base: number;
    distance: number;
    duration: number;
    surge: number;
    airport: number;
    night: number;
    aiAdjustment: number;
  };
  modelVersion: string;
}

const BASE_FARE = 2.50;
const PER_MILE = 1.10;
const PER_MIN = 0.22;
const AIRPORT_PREMIUM = 3.50;
const NIGHT_PREMIUM = 1.00;
const MINIMUM_FARE = 5.00;
const AI_ADJUSTMENT_CAP = 2.00;
const AVG_SPEED_MPH = 20; // Newark city average

interface AiAdjustmentResult {
  adjustment: number;
  modelVersion: string;
  fallbackUsed: boolean;
}

@Injectable()
export class FareEngineService {
  private modelVersion = 'fare-engine-v1';

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async estimateFare(input: FareInput): Promise<FareEstimate> {
    const now = input.requestedAt ?? new Date();
    const distanceMiles = this.haversineDistance(
      input.pickupLat, input.pickupLng,
      input.dropoffLat, input.dropoffLng,
    );
    const durationMin = Math.round((distanceMiles / AVG_SPEED_MPH) * 60);

    const isNight = this.isNightRide(now);
    const isAirport = input.isAirportTrip ?? false;

    const surgeZoneScore = await this.getSurgeScore(input.pickupLat, input.pickupLng);
    const surgeMultiplier = 1.0 + (surgeZoneScore * 0.4);

    const distanceComponent = distanceMiles * PER_MILE;
    const durationComponent = durationMin * PER_MIN;
    const airportComponent = isAirport ? AIRPORT_PREMIUM : 0;
    const nightComponent = isNight ? NIGHT_PREMIUM : 0;

    const rawFare = (BASE_FARE + distanceComponent + durationComponent + airportComponent + nightComponent) * surgeMultiplier;

    const aiResult = await this.getAiAdjustment({
      distanceMiles,
      durationMin,
      surgeZoneScore,
      isAirport,
      isNight,
      hourOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
      riderTrustScore: input.riderTrustScore ?? 500,
      riderTotalTrips: input.riderTotalTrips ?? 0,
    });

    const fare = Math.max(rawFare + aiResult.adjustment, MINIMUM_FARE);

    return {
      fare: Math.round(fare * 100) / 100,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
      durationMin,
      surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
      breakdown: {
        base: BASE_FARE,
        distance: Math.round(distanceComponent * 100) / 100,
        duration: Math.round(durationComponent * 100) / 100,
        surge: Math.round((rawFare - (rawFare / surgeMultiplier)) * 100) / 100,
        airport: airportComponent,
        night: nightComponent,
        aiAdjustment: Math.round(aiResult.adjustment * 100) / 100,
      },
      modelVersion: aiResult.modelVersion,
    };
  }

  private async getAiAdjustment(features: object): Promise<AiAdjustmentResult> {
    const aiServiceUrl = process.env.AI_SERVICE_URL;
    if (!aiServiceUrl) {
      return { adjustment: 0, modelVersion: 'fallback-v1', fallbackUsed: true };
    }

    try {
      const res = await fetch(`${aiServiceUrl}/ai/fare-adjustment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(features),
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) throw new Error(`ai-service returned ${res.status}`);

      const envelope = await res.json() as { data: { adjustment: number }; modelVersion: string; fallbackUsed: boolean };
      return {
        adjustment: Math.max(-AI_ADJUSTMENT_CAP, Math.min(AI_ADJUSTMENT_CAP, envelope.data.adjustment)),
        modelVersion: envelope.modelVersion,
        fallbackUsed: envelope.fallbackUsed,
      };
    } catch {
      return { adjustment: 0, modelVersion: 'fallback-v1', fallbackUsed: true };
    }
  }

  private async getSurgeScore(lat: number, lng: number): Promise<number> {
    const zone = this.getZoneKey(lat, lng);

    const prismaConfig = await this.prisma.platformConfig.findUnique({
      where: { key: 'ai_surge_config' },
    });
    const config = (prismaConfig?.value as { requests_per_zone_threshold: number } | null) ?? { requests_per_zone_threshold: 150 };

    let raw = 0;
    if (this.redis) {
      const val = await this.redis.get(`surge:requests:${zone}`);
      raw = val ? parseInt(val, 10) : 0;
    }

    return Math.min(1.0, raw / config.requests_per_zone_threshold);
  }

  private getZoneKey(lat: number, lng: number): string {
    // 2km grid zones
    const latZone = Math.floor(lat / 0.018);
    const lngZone = Math.floor(lng / 0.022);
    return `${latZone}:${lngZone}`;
  }

  private isNightRide(date: Date): boolean {
    const hour = date.getHours();
    return hour >= 22 || hour < 5;
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
