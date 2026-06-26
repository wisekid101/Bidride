import { Injectable, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface ZoneEarningsEstimate {
  zoneKey: string;
  centerLat: number;
  centerLng: number;
  distanceMiles: number;
  expectedTripsPerHour: number;
  estimatedEarningsPerHour: { min: number; max: number };
  demandScore: number;
  reason: string;
}

export interface HourRecommendation {
  hour: number;
  label: string;
  expectedDemand: 'high' | 'medium' | 'low';
  estimatedEarningsPerHour: { min: number; max: number };
}

export interface BreakRecommendation {
  shouldBreak: boolean;
  suggestedMinutes: number;
  reason: string;
}

export interface AirportRecommendation {
  recommend: boolean;
  reason: string;
  estimatedQueueWaitMin?: number;
}

export interface EarningsOptimizerResult {
  currentZoneScore: number;
  bestZonesNow: ZoneEarningsEstimate[];
  bestHoursToday: HourRecommendation[];
  estimatedNextTripEarnings: { min: number; max: number };
  breakRecommendation: BreakRecommendation;
  airportRecommendation: AirportRecommendation;
  disclaimer: string;
}

// Earnings floor formula (Founder-locked)
const BASE_FLOOR = (3 * 1.10) + (12 * 0.22) + 2.50; // $8.44

const HOUR_DEMAND_LABELS: Record<number, HourRecommendation['expectedDemand']> = {};
for (let h = 0; h < 24; h++) {
  HOUR_DEMAND_LABELS[h] = (h >= 7 && h <= 9) || (h >= 17 && h <= 20) ? 'high'
    : (h >= 10 && h <= 16) || (h >= 21 && h <= 22) ? 'medium'
    : 'low';
}

const HOUR_LABELS_12 = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am',
  '12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];

function zoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}
function zoneToCenterCoords(zk: string): { lat: number; lng: number } {
  const [li, lgi] = zk.split(':').map(Number);
  return { lat: (li + 0.5) * 0.018, lng: (lgi + 0.5) * 0.022 };
}
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8, toRad = (d: number) => d * Math.PI / 180;
  const a = Math.sin(toRad((lat2 - lat1) / 2)) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad((lng2 - lng1) / 2)) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class EarningsOptimizerService {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis) {}

  async getRecommendations(
    lat: number,
    lng: number,
    hoursOnline = 0,
    currentSessionEarnings = 0,
  ): Promise<EarningsOptimizerResult> {
    const currentZone = zoneKey(lat, lng);
    const currentDemand = await this.getZoneDemand(currentZone);
    const currentZoneScore = Math.round(currentDemand * 100);

    const bestZones = await this.getBestZones(lat, lng, currentZone);
    const bestHours = this.getBestHoursToday();
    const estimatedNextTripEarnings = this.estimateNextTrip(currentDemand);

    const breakRec = this.getBreakRecommendation(hoursOnline, currentSessionEarnings);
    const airportRec = await this.getAirportRecommendation(lat, lng);

    return {
      currentZoneScore,
      bestZonesNow: bestZones,
      bestHoursToday: bestHours,
      estimatedNextTripEarnings,
      breakRecommendation: breakRec,
      airportRecommendation: airportRec,
      disclaimer: 'Estimates only — not a guarantee. Actual earnings depend on trip distance, duration, and demand.',
    };
  }

  private async getZoneDemand(zone: string): Promise<number> {
    const raw = await this.redis?.get(`surge:requests:${zone}`).catch(() => null);
    return raw ? Math.min(1.0, parseInt(raw, 10) / 150) : 0;
  }

  private async getBestZones(lat: number, lng: number, currentZone: string): Promise<ZoneEarningsEstimate[]> {
    const keys = await this.redis?.keys('surge:requests:*').catch(() => []) ?? [];
    const results: ZoneEarningsEstimate[] = [];

    for (const key of keys as string[]) {
      const zone = key.replace('surge:requests:', '');
      const { lat: cLat, lng: cLng } = zoneToCenterCoords(zone);
      const dist = haversine(lat, lng, cLat, cLng);
      if (dist > 8) continue;

      const raw = await this.redis?.get(key).catch(() => null);
      const requests = raw ? parseInt(raw, 10) : 0;
      const drivers = await this.redis?.scard(`surge:drivers:${zone}`).catch(() => 0) ?? 0;
      if (requests === 0) continue;

      const demand = Math.min(1.0, requests / 150);
      const tripsPerHour = Math.max(0.5, demand * 3.5);
      const earningsMin = Math.round(BASE_FLOOR * 100) / 100;
      const earningsMax = Math.round(BASE_FLOOR * (1 + demand * 0.5) * tripsPerHour * 100) / 100;

      let reason = `${requests} requests`;
      if (Number(drivers) === 0) reason += ', no competing drivers';
      else if (requests > Number(drivers) * 2) reason += `, high demand/supply ratio`;

      results.push({
        zoneKey: zone,
        centerLat: Math.round(cLat * 10000) / 10000,
        centerLng: Math.round(cLng * 10000) / 10000,
        distanceMiles: Math.round(dist * 100) / 100,
        expectedTripsPerHour: Math.round(tripsPerHour * 10) / 10,
        estimatedEarningsPerHour: { min: earningsMin, max: earningsMax },
        demandScore: Math.round(demand * 100) / 100,
        reason,
      });
    }

    return results.sort((a, b) => b.demandScore - a.demandScore).slice(0, 3);
  }

  private getBestHoursToday(): HourRecommendation[] {
    const now = new Date().getHours();
    const upcoming = [];
    for (let i = 1; i <= 8; i++) {
      const h = (now + i) % 24;
      upcoming.push(h);
    }
    const highDemand = upcoming.filter((h) => HOUR_DEMAND_LABELS[h] === 'high').slice(0, 3);
    if (highDemand.length === 0) highDemand.push(...upcoming.slice(0, 3));

    return highDemand.map((h) => ({
      hour: h,
      label: HOUR_LABELS_12[h],
      expectedDemand: HOUR_DEMAND_LABELS[h],
      estimatedEarningsPerHour: {
        min: BASE_FLOOR,
        max: HOUR_DEMAND_LABELS[h] === 'high' ? BASE_FLOOR * 4 : HOUR_DEMAND_LABELS[h] === 'medium' ? BASE_FLOOR * 2.5 : BASE_FLOOR * 1.5,
      },
    }));
  }

  private estimateNextTrip(demand: number): { min: number; max: number } {
    return {
      min: Math.round(BASE_FLOOR * 100) / 100,
      max: Math.round(BASE_FLOOR * (1 + demand * 0.6) * 100) / 100,
    };
  }

  private getBreakRecommendation(hoursOnline: number, sessionEarnings: number): BreakRecommendation {
    if (hoursOnline >= 6 && sessionEarnings > 50) {
      return { shouldBreak: true, suggestedMinutes: 20, reason: `${hoursOnline.toFixed(1)}h online — rest improves focus and safety` };
    }
    if (hoursOnline >= 4) {
      return { shouldBreak: false, suggestedMinutes: 0, reason: 'Consider a break at 6 hours online' };
    }
    return { shouldBreak: false, suggestedMinutes: 0, reason: 'No break needed yet' };
  }

  private async getAirportRecommendation(lat: number, lng: number): Promise<AirportRecommendation> {
    const EWR_LAT = 40.693, EWR_LNG = -74.175;
    const distToEwr = haversine(lat, lng, EWR_LAT, EWR_LNG);
    const queueLength = await this.redis?.zcard('queue:ewr').catch(() => 0) ?? 0;
    const estimatedWait = Number(queueLength) * 4; // ~4 min per car ahead

    if (distToEwr < 2 || (distToEwr < 5 && Number(queueLength) < 10)) {
      return {
        recommend: true,
        reason: distToEwr < 2 ? 'You are near EWR — airport queue is active' : 'Short queue at EWR, good earnings opportunity',
        estimatedQueueWaitMin: estimatedWait,
      };
    }
    return {
      recommend: false,
      reason: distToEwr > 10 ? 'EWR is too far from your location' : `Queue has ${queueLength} drivers — high wait time`,
      estimatedQueueWaitMin: estimatedWait > 0 ? estimatedWait : undefined,
    };
  }
}
