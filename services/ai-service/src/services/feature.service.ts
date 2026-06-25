import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// FeatureService is the single source of truth for AI input feature vectors.
// It assembles features from PostgreSQL (PlatformConfig), Redis (surge counters),
// and caller-provided inputs — so every service speaks the same feature language.

@Injectable()
export class FeatureService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async buildFareFeatures(input: {
    distanceMiles: number;
    durationMin: number;
    isAirport?: boolean;
    isNight?: boolean;
    hourOfDay?: number;
    dayOfWeek?: number;
    riderTrustScore?: number;
    riderTotalTrips?: number;
    // Optional: if lat/lng provided, enrich surgeZoneScore from Redis
    pickupLat?: number;
    pickupLng?: number;
    surgeZoneScore?: number;
  }): Promise<Record<string, unknown>> {
    let surgeZoneScore = input.surgeZoneScore ?? 0;

    if (input.pickupLat !== undefined && input.pickupLng !== undefined && this.redis) {
      const zone = this.zoneKey(input.pickupLat, input.pickupLng);
      const [val, cfg] = await Promise.all([
        this.redis.get(`surge:requests:${zone}`).catch(() => null),
        this.prisma.platformConfig.findUnique({ where: { key: 'ai_surge_config' } }).catch(() => null),
      ]);
      const threshold =
        (cfg?.value as { requests_per_zone_threshold?: number })?.requests_per_zone_threshold ?? 150;
      if (val) surgeZoneScore = Math.min(1.0, parseInt(val, 10) / threshold);
    }

    return {
      distanceMiles: input.distanceMiles,
      durationMin: input.durationMin,
      surgeZoneScore,
      isAirport: input.isAirport ?? false,
      isNight: input.isNight ?? false,
      hourOfDay: input.hourOfDay ?? new Date().getHours(),
      dayOfWeek: input.dayOfWeek ?? new Date().getDay(),
      riderTrustScore: input.riderTrustScore ?? 500,
      riderTotalTrips: input.riderTotalTrips ?? 0,
    };
  }

  buildFraudFeatures(input: Record<string, unknown>): Record<string, unknown> {
    return { ...input };
  }

  async buildBidFeatures(input: {
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
    lat?: number;
    lng?: number;
  }): Promise<Record<string, unknown>> {
    let currentZoneDemand = input.currentZoneDemand;
    let availableDriversInZone = input.availableDriversInZone;

    if (input.lat !== undefined && input.lng !== undefined && this.redis) {
      const zone = this.zoneKey(input.lat, input.lng);
      const [requestsRaw, driverCount] = await Promise.all([
        this.redis.get(`surge:requests:${zone}`).catch(() => null),
        this.redis.scard(`surge:drivers:${zone}`).catch(() => 0),
      ]);
      if (requestsRaw !== null && currentZoneDemand === undefined) {
        const cfg = await this.prisma.platformConfig
          .findUnique({ where: { key: 'ai_surge_config' } })
          .catch(() => null);
        const threshold =
          (cfg?.value as { requests_per_zone_threshold?: number })
            ?.requests_per_zone_threshold ?? 150;
        currentZoneDemand = Math.min(1.0, parseInt(requestsRaw, 10) / threshold);
      }
      if (availableDriversInZone === undefined) {
        availableDriversInZone = driverCount;
      }
    }

    return {
      bidAmount: input.bidAmount,
      aiFare: input.aiFare,
      distanceMiles: input.distanceMiles,
      etaMinutes: input.etaMinutes,
      riderTrustScore: input.riderTrustScore,
      driverTrustScore: input.driverTrustScore,
      isAirport: input.isAirport,
      weatherFactor: input.weatherFactor,
      timeOfDay: input.timeOfDay ?? new Date().getHours(),
      driverAcceptanceHistory: input.driverAcceptanceHistory,
      driverCancellationRate: input.driverCancellationRate,
      driverResponseTimeMs: input.driverResponseTimeMs,
      currentZoneDemand,
      availableDriversInZone,
      historicalAcceptanceRate: input.historicalAcceptanceRate,
    };
  }

  async buildSurgeFeatures(input: {
    lat: number;
    lng: number;
    hourOfDay?: number;
    dayOfWeek?: number;
    currentRequests?: number;
    currentDrivers?: number;
  }): Promise<Record<string, unknown>> {
    let currentRequests = input.currentRequests ?? 0;

    if (this.redis) {
      const zone = this.zoneKey(input.lat, input.lng);
      const val = await this.redis.get(`surge:requests:${zone}`).catch(() => null);
      if (val) currentRequests = parseInt(val, 10);

      const driverCount = await this.redis.scard(`surge:drivers:${zone}`).catch(() => 0);
      return {
        lat: input.lat,
        lng: input.lng,
        zone,
        hourOfDay: input.hourOfDay ?? new Date().getHours(),
        dayOfWeek: input.dayOfWeek ?? new Date().getDay(),
        currentRequests,
        currentDrivers: driverCount,
      };
    }

    return {
      lat: input.lat,
      lng: input.lng,
      hourOfDay: input.hourOfDay ?? new Date().getHours(),
      dayOfWeek: input.dayOfWeek ?? new Date().getDay(),
      currentRequests,
      currentDrivers: input.currentDrivers ?? 0,
    };
  }

  buildDriverEarningsFeatures(input: Record<string, unknown>): Record<string, unknown> {
    return { ...input };
  }

  private zoneKey(lat: number, lng: number): string {
    return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
  }
}
