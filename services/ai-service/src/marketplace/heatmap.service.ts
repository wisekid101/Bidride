import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';

export interface HeatmapZone {
  zoneKey: string;
  centerLat: number;
  centerLng: number;
  requests: number;
  activeDrivers: number;
  demandScore: number;          // 0–1 (requests/threshold)
  surgeMultiplier: number;      // 1.0–2.5
  acceptanceRate: number | null;
  avgFareUsd: number | null;
  avgWaitMin: number | null;
  driverDensity: number;        // drivers per km²
  isAirportZone: boolean;
}

export interface HeatmapSummary {
  zones: HeatmapZone[];
  totalActiveRequests: number;
  totalActiveDrivers: number;
  activeZoneCount: number;
  timestamp: string;
}

// EWR airport approximate zone — Newark, NJ 40.693°N, 74.175°W
const EWR_ZONE = `${Math.floor(40.693 / 0.018)}:${Math.floor(-74.175 / 0.022)}`;
const SURGE_THRESHOLD = 150;
const ZONE_AREA_KM2 = 0.018 * 111.32 * 0.022 * 111.32; // ≈ 4.9 km²

function zoneToCenterCoords(zoneKey: string): { lat: number; lng: number } {
  const [latIdx, lngIdx] = zoneKey.split(':').map(Number);
  return { lat: (latIdx + 0.5) * 0.018, lng: (lngIdx + 0.5) * 0.022 };
}

@Injectable()
export class HeatmapService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async getHeatmap(): Promise<HeatmapSummary> {
    const [requestKeys, driverKeys, recentOutcomes] = await Promise.all([
      this.redis?.keys('surge:requests:*').catch(() => []) ?? Promise.resolve([]),
      this.redis?.keys('surge:drivers:*').catch(() => []) ?? Promise.resolve([]),
      this.getRecentOutcomesByZone(),
    ]);

    // Build zone map from request keys
    const zoneMap = new Map<string, { requests: number; drivers: number }>();

    for (const key of requestKeys as string[]) {
      const zone = key.replace('surge:requests:', '');
      const val = await this.redis?.get(key).catch(() => null);
      if (val) zoneMap.set(zone, { requests: parseInt(val, 10), drivers: 0 });
    }

    for (const key of driverKeys as string[]) {
      const zone = key.replace('surge:drivers:', '');
      const count = await this.redis?.scard(key).catch(() => 0) ?? 0;
      const existing = zoneMap.get(zone) ?? { requests: 0, drivers: 0 };
      existing.drivers = count;
      zoneMap.set(zone, existing);
    }

    const zones: HeatmapZone[] = [];
    for (const [zone, stats] of zoneMap.entries()) {
      if (stats.requests === 0 && stats.drivers === 0) continue;

      const { lat, lng } = zoneToCenterCoords(zone);
      const demandScore = Math.min(1.0, stats.requests / SURGE_THRESHOLD);
      const surgeMultiplier = Math.min(2.5, 1.0 + demandScore * 1.5);
      const driverDensity = Math.round((stats.drivers / ZONE_AREA_KM2) * 100) / 100;

      const zoneOutcomes = recentOutcomes.get(zone);

      zones.push({
        zoneKey: zone,
        centerLat: Math.round(lat * 10000) / 10000,
        centerLng: Math.round(lng * 10000) / 10000,
        requests: stats.requests,
        activeDrivers: stats.drivers,
        demandScore: Math.round(demandScore * 100) / 100,
        surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
        acceptanceRate: zoneOutcomes?.acceptanceRate ?? null,
        avgFareUsd: zoneOutcomes?.avgFare ?? null,
        avgWaitMin: stats.drivers > 0
          ? Math.max(1, Math.round(stats.requests / stats.drivers))
          : null,
        driverDensity,
        isAirportZone: zone === EWR_ZONE,
      });
    }

    zones.sort((a, b) => b.demandScore - a.demandScore);

    return {
      zones,
      totalActiveRequests: zones.reduce((s, z) => s + z.requests, 0),
      totalActiveDrivers: zones.reduce((s, z) => s + z.activeDrivers, 0),
      activeZoneCount: zones.length,
      timestamp: new Date().toISOString(),
    };
  }

  private async getRecentOutcomesByZone(): Promise<Map<string, { acceptanceRate: number; avgFare: number }>> {
    const map = new Map<string, { acceptanceRate: number; avgFare: number }>();
    try {
      const rows = await this.prisma.$queryRaw<
        { zone_key: string; acceptance_rate: number; avg_fare: number }[]
      >`
        SELECT zone_key,
          AVG(CASE WHEN was_accepted THEN 1.0 ELSE 0.0 END) AS acceptance_rate,
          AVG(final_fare::float) AS avg_fare
        FROM bid_outcomes
        WHERE zone_key IS NOT NULL AND created_at > NOW() - INTERVAL '6 hours'
        GROUP BY zone_key
      `;
      for (const r of rows) {
        map.set(r.zone_key, {
          acceptanceRate: Math.round(Number(r.acceptance_rate) * 100) / 100,
          avgFare: Math.round(Number(r.avg_fare) * 100) / 100,
        });
      }
    } catch {
      // DB unavailable — return empty map, heatmap still works from Redis
    }
    return map;
  }
}
