import { Injectable, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  riderTotalTrips?: number;
}

// ── PRICING FEATURE ALLOWLIST (AI Core Phase 2 — Founder rule) ──────────────
// Every attribute sent to the AI fare hook or written into pricing audit
// inputFeatures MUST be named here. Anything else — trust scores, identity
// attributes, raw coordinates, contact details — is silently dropped, so a
// prohibited attribute can never ride into training or audit payloads by
// being added upstream. Trust scores are explicitly prohibited as pricing
// features (anti-discrimination rule, design/ai-governance-rules.md).
const ALLOWED_PRICING_FEATURES = new Set([
  'distanceMiles',
  'durationMin',
  'surgeZoneScore',
  'surgeMultiplier',
  'isAirport',
  'isAirportTrip',
  'isNight',
  'hourOfDay',
  'dayOfWeek',
  'riderTotalTrips', // trip count only — loyalty signal, NOT a trust attribute
  'pickupZone',
  'dropoffZone',
  'vehicleClass',
]);

export function pickAllowedPricingFeatures(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (ALLOWED_PRICING_FEATURES.has(key)) out[key] = value;
  }
  return out;
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
  // Optional AI passthrough (present only when the AI service supplied them).
  // Additive fields — existing consumers are unaffected.
  aiConfidence?: number;
  aiExplanation?: string;
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
  // True when the AI served a neutral shadow value (its real recommendation
  // was not applied). Shadow explainability must never reach responses.
  shadow: boolean;
  // Optional explainability payload from the shadow AI service.
  confidence?: number;
  explanation?: string;
  factors?: unknown[];
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

    // The single feature payload for BOTH the AI hook and the audit row —
    // filtered through the allowlist so prohibited attributes cannot enter.
    const pricingFeatures = pickAllowedPricingFeatures({
      distanceMiles,
      durationMin,
      surgeZoneScore,
      isAirport,
      isNight,
      hourOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
      riderTotalTrips: input.riderTotalTrips ?? 0,
    });

    const aiResult = await this.getAiAdjustment(pricingFeatures);

    const fare = Math.max(rawFare + aiResult.adjustment, MINIMUM_FARE);

    const estimate: FareEstimate = {
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
      // Explainability passthrough ONLY when the AI's recommendation was
      // actually applied (live). While shadowed, the estimate payload must be
      // byte-identical to the fallback payload — the real recommendation's
      // explanation must never leak to riders through /pricing/estimate.
      ...(!aiResult.shadow && aiResult.confidence != null && { aiConfidence: aiResult.confidence }),
      ...(!aiResult.shadow && aiResult.explanation != null && { aiExplanation: aiResult.explanation }),
    };

    // ── PRICING AUDIT (AI Core Phase 2) ────────────────────────────────────
    // One AiPricingLog row per quote, strictly fire-and-forget: an audit
    // failure must NEVER block or slow a fare quote. THIS TABLE IS AUDIT,
    // NEVER FINANCIAL TRUTH — trips.finalFare is the canonical money value.
    // The schema's tripId column is required but quotes precede trips, so
    // pre-trip quotes store a synthetic quoteId there; the requestId linkage
    // lives inside inputFeatures.
    const quoteId = randomUUID();
    try {
      void this.prisma.aiPricingLog.create({
        data: {
          tripId: quoteId,
          inputFeatures: {
            requestId: randomUUID(),
            quoteId,
            // Feature attributes pass the allowlist — prohibited attributes
            // (trust scores, identity) can never be persisted here.
            ...pickAllowedPricingFeatures({
              ...pricingFeatures,
              pickupZone: this.getZoneKey(input.pickupLat, input.pickupLng),
              dropoffZone: this.getZoneKey(input.dropoffLat, input.dropoffLng),
              vehicleClass: input.rideType,
              distanceMiles: estimate.distanceMiles,
              isAirportTrip: isAirport,
              surgeMultiplier: estimate.surgeMultiplier,
            }),
            schemaVersion: 2, // v2: trust scores removed, allowlist enforced
            // Free-form fields from the AI response are sanitized (coerced to
            // bounded strings) so this channel cannot smuggle structured data
            // past the feature allowlist into the audit trail.
            audit: {
              explanation: aiResult.explanation != null ? String(aiResult.explanation).slice(0, 300) : null,
              factors: Array.isArray(aiResult.factors)
                ? aiResult.factors.slice(0, 10).map((f) => (typeof f === 'string' ? f : JSON.stringify(f)).slice(0, 120))
                : null,
              fallbackUsed: aiResult.fallbackUsed,
              shadow: aiResult.shadow,
            },
          },
          rawFare: Math.round(rawFare * 100) / 100,
          aiAdjustment: Math.round(aiResult.adjustment * 100) / 100,
          finalFare: estimate.fare,
          modelVersion: aiResult.modelVersion,
          confidenceScore: aiResult.confidence ?? 0,
        },
      }).catch(() => {});
    } catch { /* audit must never affect quotes */ }

    return estimate;
  }

  private async getAiAdjustment(features: object): Promise<AiAdjustmentResult> {
    const aiServiceUrl = process.env.AI_SERVICE_URL;
    if (!aiServiceUrl) {
      return { adjustment: 0, modelVersion: 'fallback-v1', fallbackUsed: true, shadow: true };
    }

    try {
      const res = await fetch(`${aiServiceUrl}/ai/fare-adjustment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }) },
        body: JSON.stringify(features),
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) throw new Error(`ai-service returned ${res.status}`);

      const envelope = await res.json() as {
        data: {
          adjustment: number;
          // Optional shadow/explainability fields supplied by the AI service.
          shadow?: boolean;
          confidence?: number;
          explanation?: string;
          factors?: unknown[];
        };
        modelVersion: string;
        fallbackUsed: boolean;
      };
      // Sanitize before clamping: a non-numeric adjustment (NaN survives
      // min/max clamping!) must degrade to 0, never into the fare.
      const raw = Number(envelope.data.adjustment);
      const sanitized = Number.isFinite(raw) ? raw : 0;
      return {
        adjustment: Math.max(-AI_ADJUSTMENT_CAP, Math.min(AI_ADJUSTMENT_CAP, sanitized)),
        modelVersion: envelope.modelVersion,
        fallbackUsed: envelope.fallbackUsed,
        // Unless the AI explicitly says the value was served live, treat it
        // as shadowed — fail safe for the explainability passthrough.
        shadow: envelope.data.shadow !== false,
        confidence: envelope.data.confidence,
        explanation: envelope.data.explanation,
        factors: envelope.data.factors,
      };
    } catch {
      return { adjustment: 0, modelVersion: 'fallback-v1', fallbackUsed: true, shadow: true };
    }
  }

  async getDemandZones(
    lat: number,
    lng: number,
    radiusMi = 5,
  ): Promise<{ points: Array<{ latitude: number; longitude: number; weight: number }>; generatedAt: string }> {
    if (!this.redis || isNaN(lat) || isNaN(lng)) {
      return { points: [], generatedAt: new Date().toISOString() };
    }

    // Bounding box in degrees: 1° lat ≈ 69 mi, 1° lng ≈ 53 mi at 40°N
    const radiusDegLat = radiusMi / 69.0;
    const radiusDegLng = radiusMi / 53.0;

    const latMin = Math.floor((lat - radiusDegLat) / 0.018);
    const latMax = Math.floor((lat + radiusDegLat) / 0.018);
    const lngMin = Math.floor((lng - radiusDegLng) / 0.022);
    const lngMax = Math.floor((lng + radiusDegLng) / 0.022);

    const keys: string[] = [];
    const zonePairs: Array<{ latZone: number; lngZone: number }> = [];

    for (let lz = latMin; lz <= latMax; lz++) {
      for (let gz = lngMin; gz <= lngMax; gz++) {
        keys.push(`surge:requests:${lz}:${gz}`);
        zonePairs.push({ latZone: lz, lngZone: gz });
      }
    }

    if (keys.length === 0) {
      return { points: [], generatedAt: new Date().toISOString() };
    }

    const values = await this.redis.mget(...keys);
    const points: Array<{ latitude: number; longitude: number; weight: number }> = [];

    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      if (!val) continue;

      const weight = parseInt(val, 10);
      if (isNaN(weight) || weight <= 0) continue;

      const { latZone, lngZone } = zonePairs[i];
      const latitude = (latZone + 0.5) * 0.018;
      const longitude = (lngZone + 0.5) * 0.022;

      // Haversine filter: exclude corners of the rectangular bounding box
      if (this.haversineDistance(lat, lng, latitude, longitude) <= radiusMi) {
        points.push({ latitude, longitude, weight });
      }
    }

    return { points, generatedAt: new Date().toISOString() };
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
