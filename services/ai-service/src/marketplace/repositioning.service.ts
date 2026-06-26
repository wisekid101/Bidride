import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface ZoneRecommendation {
  zoneKey: string;
  centerLat: number;
  centerLng: number;
  distanceMiles: number;
  expectedDemand: number;         // 0–1
  estimatedWaitMin: number;
  estimatedEarningsRange: { min: number; max: number };
  rideSuccessProbability: number;
  reason: string;
}

function zoneToCenterCoords(zoneKey: string): { lat: number; lng: number } {
  const [latIdx, lngIdx] = zoneKey.split(':').map(Number);
  return { lat: (latIdx + 0.5) * 0.018, lng: (lngIdx + 0.5) * 0.022 };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function zoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

// Earnings floor formula (Founder-locked): (3mi × $1.10) + (12min × $0.22) + $2.50 = $8.44
const FLOOR_ESTIMATE = (3 * 1.10) + (12 * 0.22) + 2.50;

@Injectable()
export class RepositioningService {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis) {}

  async getRecommendations(lat: number, lng: number, maxResults = 3): Promise<ZoneRecommendation[]> {
    const currentZone = zoneKey(lat, lng);
    const [latIdx, lngIdx] = currentZone.split(':').map(Number);

    // Check 3×3 grid of adjacent zones (excluding current)
    const candidateZones: string[] = [];
    for (let dLat = -2; dLat <= 2; dLat++) {
      for (let dLng = -2; dLng <= 2; dLng++) {
        if (dLat === 0 && dLng === 0) continue;
        candidateZones.push(`${latIdx + dLat}:${lngIdx + dLng}`);
      }
    }

    const results: ZoneRecommendation[] = [];

    for (const zone of candidateZones) {
      const { lat: cLat, lng: cLng } = zoneToCenterCoords(zone);
      const dist = haversine(lat, lng, cLat, cLng);
      if (dist > 6) continue; // Skip zones > 6 miles

      const [requestsRaw, driversRaw] = await Promise.all([
        this.redis?.get(`surge:requests:${zone}`).catch(() => null) ?? Promise.resolve(null),
        this.redis?.scard(`surge:drivers:${zone}`).catch(() => 0) ?? Promise.resolve(0),
      ]);

      const requests = requestsRaw ? parseInt(requestsRaw, 10) : 0;
      const drivers = Number(driversRaw);
      if (requests === 0) continue;

      // Demand score: unmet demand = requests per available driver
      const unmetDemand = drivers > 0 ? Math.min(1.0, requests / (drivers * 2)) : Math.min(1.0, requests / 10);
      const expectedDemand = Math.min(1.0, unmetDemand);

      // Score this zone
      const zoneScore = expectedDemand * (1 - dist / 6);
      if (zoneScore < 0.1) continue;

      // Estimate wait time: lower demand → longer wait
      const estimatedWaitMin = Math.max(1, Math.round(5 / Math.max(expectedDemand, 0.2)));

      // Earnings range
      const earningsMin = FLOOR_ESTIMATE;
      const earningsMax = Math.round((FLOOR_ESTIMATE * (1 + expectedDemand * 0.4)) * 100) / 100;

      const rideSuccessProbability = Math.min(0.92, expectedDemand * 0.85);

      let reason = `${requests} active request${requests !== 1 ? 's' : ''} in zone`;
      if (drivers === 0) reason += ', no competing drivers';
      else if (requests > drivers * 2) reason += `, ${requests}:${drivers} demand-to-supply`;

      results.push({
        zoneKey: zone,
        centerLat: Math.round(cLat * 10000) / 10000,
        centerLng: Math.round(cLng * 10000) / 10000,
        distanceMiles: Math.round(dist * 100) / 100,
        expectedDemand: Math.round(expectedDemand * 100) / 100,
        estimatedWaitMin,
        estimatedEarningsRange: { min: Math.round(earningsMin * 100) / 100, max: earningsMax },
        rideSuccessProbability: Math.round(rideSuccessProbability * 100) / 100,
        reason,
      });
    }

    return results
      .sort((a, b) => b.rideSuccessProbability - a.rideSuccessProbability)
      .slice(0, maxResults);
  }
}
