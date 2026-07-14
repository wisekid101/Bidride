import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { randomUUID } from 'node:crypto';
import { AiResponseEnvelope, ModelHealthMetrics } from '../types';
import { ModelRegistryService } from '../services/model-registry.service';
import { FallbackService } from '../services/fallback.service';
import { InferenceLogService } from '../services/inference-log.service';
import { ModelHealthService } from '../services/model-health.service';
import { FeatureService } from '../services/feature.service';
import { BidWinProbabilityEngine, BID_ENGINE_VERSION } from '../bid-prediction/bid-win-probability.engine';
import { FareAdjustmentEngine, FARE_ENGINE_VERSION } from './fare-adjustment.engine';
import { ShadowModeService } from '../shadow/shadow-mode.service';

// Trust scores are deliberately absent: prohibited fare features
// (anti-discrimination rule, design/ai-governance-rules.md).
interface FareAdjustmentBody {
  distanceMiles: number;
  durationMin: number;
  surgeZoneScore?: number;
  isAirport?: boolean;
  isNight?: boolean;
  hourOfDay?: number;
  dayOfWeek?: number;
  riderTotalTrips?: number;
  pickupLat?: number;
  pickupLng?: number;
  tripId?: string;
  userId?: string;
}

interface FraudScoreBody {
  userId: string;
  userRole: 'rider' | 'driver';
  linkedAccounts: number;
  deviceFingerprints: number;
  fraudFlagCount: number;
  disputeCount: number;
  accountAgeDays: number;
  totalTrips: number;
  ruleScore: number;
  identityVerified: boolean;
  paymentVerified: boolean;
  emailVerified: boolean;
  tripId?: string;
}

interface BidWinProbabilityBody {
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
  tripId?: string;
  userId?: string;
}

interface SurgeForecastBody {
  lat: number;
  lng: number;
  hourOfDay?: number;
  dayOfWeek?: number;
  currentRequests?: number;
  currentDrivers?: number;
  tripId?: string;
}

interface DriverEarningsBody {
  lat: number;
  lng: number;
  hourOfDay?: number;
  dayOfWeek?: number;
  driverSessionHours?: number;
  tripsThisSession?: number;
  driverId?: string;
}

// Guard applied per-route (not class-level) so the read-only health probe
// stays public for load balancers while every inference endpoint requires
// the internal service key.
@Controller('ai')
export class InferenceController {
  constructor(
    private readonly modelRegistry: ModelRegistryService,
    private readonly fallback: FallbackService,
    private readonly inferenceLog: InferenceLogService,
    private readonly health: ModelHealthService,
    private readonly features: FeatureService,
    private readonly bidEngine: BidWinProbabilityEngine,
    private readonly fareEngine: FareAdjustmentEngine,
    private readonly shadowMode: ShadowModeService,
  ) {}

  private async runInference<T extends Record<string, unknown>>(
    modelName: string,
    featureVector: Record<string, unknown>,
    tripId?: string,
    userId?: string,
  ): Promise<AiResponseEnvelope<T>> {
    const start = Date.now();
    const inferenceId = randomUUID();

    let output: Record<string, unknown>;
    let modelVersion: string;
    let fallbackUsed: boolean;
    let confidence: number;

    try {
      const result = await this.modelRegistry.invoke(modelName, featureVector);
      output = result.output;
      modelVersion = result.modelVersion;
      fallbackUsed = false;
      confidence = result.confidence;
    } catch {
      output = this.fallback.execute(modelName, featureVector);
      modelVersion = 'fallback-v1';
      fallbackUsed = true;
      confidence = 0;
    }

    const latencyMs = Date.now() - start;

    this.inferenceLog.log({ modelName, modelVersion, inputFeatures: featureVector, output, confidence, fallbackUsed, latencyMs, tripId, userId });
    this.health.record(modelName, latencyMs, fallbackUsed);

    return { data: output as T, modelVersion, latencyMs, fallbackUsed, confidence, inferenceId, predictionTimestamp: new Date().toISOString() };
  }

  @UseGuards(InternalKeyGuard)
  @Post('fare-adjustment')
  async fareAdjustment(
    @Body() body: FareAdjustmentBody,
  ): Promise<AiResponseEnvelope<Record<string, unknown>>> {
    const start = Date.now();
    const inferenceId = randomUUID();
    const featureVector = await this.features.buildFareFeatures(body);

    // Real recommendation: SageMaker champion when an endpoint is deployed,
    // else the transparent local engine. Either way it is ALWAYS logged.
    // fallbackUsed is honest: true only when a configured endpoint FAILED and
    // the engine stood in — the engine being the champion is not a fallback.
    let endpointConfigured = false;
    try {
      endpointConfigured = !!this.modelRegistry.getChampion('fare-adjustment').endpointName;
    } catch { /* unknown model name — treat as no endpoint */ }

    let real: { adjustment: number; confidence: number; explanation: string; factors: unknown[] };
    let modelVersion: string;
    let fallbackUsed = false;
    try {
      const result = await this.modelRegistry.invoke('fare-adjustment', featureVector);
      // Service-side bound (belt to the caller's ±$2 clamp): sanitize
      // non-finite outputs to 0 — NaN survives min/max clamping.
      const raw = Number((result.output as { adjustment?: number }).adjustment ?? 0);
      const adj = Number.isFinite(raw) ? Math.max(-2, Math.min(2, raw)) : 0;
      real = {
        adjustment: adj,
        confidence: result.confidence,
        explanation: `SageMaker champion recommendation of $${adj.toFixed(2)}.`,
        factors: [],
      };
      modelVersion = result.modelVersion;
    } catch {
      // Engine consumes the SAME (Redis-enriched) feature vector that gets
      // logged, so the audit trail always matches the inputs actually used.
      const rec = this.fareEngine.recommend({
        surgeZoneScore: featureVector.surgeZoneScore as number | undefined,
        isNight: featureVector.isNight as boolean | undefined,
        isAirport: featureVector.isAirport as boolean | undefined,
        hourOfDay: featureVector.hourOfDay as number | undefined,
        riderTotalTrips: featureVector.riderTotalTrips as number | undefined,
      });
      real = rec;
      modelVersion = FARE_ENGINE_VERSION;
      fallbackUsed = endpointConfigured; // engine stood in for a failing endpoint
    }

    // Shadow gate — Founder hard rule: while shadowed, SERVE the neutral
    // value (adjustment 0, exactly what the caller's fallback produces) and
    // carry the real recommendation as data only.
    const shadow = await this.shadowMode.isShadow('fare');
    const served = shadow ? 0 : real.adjustment;
    const output = {
      adjustment: served,
      confidence: real.confidence,
      explanation: real.explanation,
      factors: real.factors,
      shadow,
      shadowRecommendation: real.adjustment,
      inferenceLogId: inferenceId,
    };

    const latencyMs = Date.now() - start;
    this.inferenceLog.log({
      modelName: 'fare-adjustment',
      modelVersion,
      inputFeatures: featureVector,
      output,
      confidence: real.confidence,
      fallbackUsed,
      latencyMs,
      tripId: body.tripId,
      userId: body.userId,
    });
    this.health.record('fare-adjustment', latencyMs, fallbackUsed);

    return {
      data: output,
      modelVersion,
      latencyMs,
      fallbackUsed,
      confidence: real.confidence,
      inferenceId,
      predictionTimestamp: new Date().toISOString(),
    };
  }

  @UseGuards(InternalKeyGuard)
  @Post('fraud-score')
  async fraudScore(
    @Body() body: FraudScoreBody,
  ): Promise<AiResponseEnvelope<{ fraudProbability: number }>> {
    const featureVector = this.features.buildFraudFeatures(body as unknown as Record<string, unknown>);
    return this.runInference('fraud-score', featureVector, body.tripId, body.userId);
  }

  @UseGuards(InternalKeyGuard)
  @Post('bid-win-probability')
  async bidWinProbability(
    @Body() body: BidWinProbabilityBody,
  ): Promise<AiResponseEnvelope<Record<string, unknown>>> {
    const start = Date.now();
    const inferenceId = randomUUID();

    const featureVector = await this.features.buildBidFeatures(body);
    const result = this.bidEngine.predict(featureVector as unknown as Parameters<BidWinProbabilityEngine['predict']>[0]);

    // Shadow gate — serve the caller's own fallback value (0.50) while the
    // real prediction rides along and is logged. bids.service surfaces
    // data.probability to the rider, so this is production-visible.
    const shadow = await this.shadowMode.isShadow('win_probability');
    const served = shadow ? 0.5 : result.probability;

    const latencyMs = Date.now() - start;
    const output = {
      probability: served,
      confidence: result.confidence,
      explanation: result.explanation,
      shadow,
      shadowRecommendation: result.probability,
      inferenceLogId: inferenceId,
    };

    this.inferenceLog.log({
      modelName: 'bid-win-probability',
      modelVersion: BID_ENGINE_VERSION,
      inputFeatures: featureVector,
      output: output as unknown as Record<string, unknown>,
      confidence: result.confidence,
      fallbackUsed: false,
      latencyMs,
      tripId: body.tripId,
      userId: body.userId,
    });
    this.health.record('bid-win-probability', latencyMs, false);

    // Shadow runner — invoke challenger/shadow endpoints in background (no-op until deployed)
    this.runShadows('bid-win-probability', featureVector, body.tripId);

    return {
      data: output,
      modelVersion: BID_ENGINE_VERSION,
      latencyMs,
      fallbackUsed: false,
      confidence: result.confidence,
      inferenceId,
      predictionTimestamp: new Date().toISOString(),
    };
  }

  @UseGuards(InternalKeyGuard)
  @Post('surge-forecast')
  async surgeForecast(
    @Body() body: SurgeForecastBody,
  ): Promise<AiResponseEnvelope<{ forecastedMultiplier: number }>> {
    const featureVector = await this.features.buildSurgeFeatures(body);
    return this.runInference('surge-forecast', featureVector, body.tripId);
  }

  @UseGuards(InternalKeyGuard)
  @Post('driver-earnings')
  async driverEarnings(
    @Body() body: DriverEarningsBody,
  ): Promise<AiResponseEnvelope<{ estimatedEarnings: number }>> {
    const featureVector = this.features.buildDriverEarningsFeatures(
      body as unknown as Record<string, unknown>,
    );
    return this.runInference('driver-earnings', featureVector, undefined, body.driverId);
  }

  @Get('health')
  getHealth(): { models: Record<string, ModelHealthMetrics>; service: { uptime: number; version: string } } {
    return {
      models: this.health.getHealth(),
      service: { uptime: process.uptime(), version: '1.0.0' },
    };
  }

  // Champion/challenger/shadow framework — fires background invocations for non-production comparison
  private runShadows(modelName: string, features: Record<string, unknown>, tripId?: string): void {
    const record = this.modelRegistry.getRecord(modelName);
    if (!record) return;

    const slots: Array<{ slot: string; entry: { version: string; endpointName?: string } }> = [];
    if (record.challenger?.endpointName) slots.push({ slot: 'challenger', entry: record.challenger });
    if (record.shadow?.endpointName) slots.push({ slot: 'shadow', entry: record.shadow });
    if (record.experimental?.endpointName) slots.push({ slot: 'experimental', entry: record.experimental });

    for (const { slot, entry } of slots) {
      void this.modelRegistry
        .invokeEndpoint(entry.endpointName!, features, entry.version)
        .then((res) => {
          this.inferenceLog.log({
            modelName,
            modelVersion: `${entry.version}:${slot}`,
            inputFeatures: features,
            output: res.output,
            confidence: res.confidence,
            fallbackUsed: false,
            latencyMs: 0,
            tripId,
          });
        })
        .catch(() => {});
    }
  }
}
