import { Controller, Post, Get, Body } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiResponseEnvelope, ModelHealthMetrics } from '../types';
import { ModelRegistryService } from '../services/model-registry.service';
import { FallbackService } from '../services/fallback.service';
import { InferenceLogService } from '../services/inference-log.service';
import { ModelHealthService } from '../services/model-health.service';
import { FeatureService } from '../services/feature.service';

interface FareAdjustmentBody {
  distanceMiles: number;
  durationMin: number;
  surgeZoneScore?: number;
  isAirport?: boolean;
  isNight?: boolean;
  hourOfDay?: number;
  dayOfWeek?: number;
  riderTrustScore?: number;
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
  distanceMiles: number;
  durationMin: number;
  surgeMultiplier?: number;
  driverCount?: number;
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

@Controller('ai')
export class InferenceController {
  constructor(
    private readonly modelRegistry: ModelRegistryService,
    private readonly fallback: FallbackService,
    private readonly inferenceLog: InferenceLogService,
    private readonly health: ModelHealthService,
    private readonly features: FeatureService,
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

    this.inferenceLog.log({
      modelName,
      modelVersion,
      inputFeatures: featureVector,
      output,
      confidence,
      fallbackUsed,
      latencyMs,
      tripId,
      userId,
    });

    this.health.record(modelName, latencyMs, fallbackUsed);

    return { data: output as T, modelVersion, latencyMs, fallbackUsed, confidence, inferenceId };
  }

  @Post('fare-adjustment')
  async fareAdjustment(
    @Body() body: FareAdjustmentBody,
  ): Promise<AiResponseEnvelope<{ adjustment: number }>> {
    const featureVector = await this.features.buildFareFeatures(body);
    return this.runInference('fare-adjustment', featureVector, body.tripId, body.userId);
  }

  @Post('fraud-score')
  async fraudScore(
    @Body() body: FraudScoreBody,
  ): Promise<AiResponseEnvelope<{ fraudProbability: number }>> {
    const featureVector = this.features.buildFraudFeatures(body as unknown as Record<string, unknown>);
    return this.runInference('fraud-score', featureVector, body.tripId, body.userId);
  }

  @Post('bid-win-probability')
  async bidWinProbability(
    @Body() body: BidWinProbabilityBody,
  ): Promise<AiResponseEnvelope<{ probability: number }>> {
    const featureVector = this.features.buildBidFeatures(body as unknown as Record<string, unknown>);
    return this.runInference('bid-win-probability', featureVector, body.tripId, body.userId);
  }

  @Post('surge-forecast')
  async surgeForecast(
    @Body() body: SurgeForecastBody,
  ): Promise<AiResponseEnvelope<{ forecastedMultiplier: number }>> {
    const featureVector = await this.features.buildSurgeFeatures(body);
    return this.runInference('surge-forecast', featureVector, body.tripId);
  }

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
}
