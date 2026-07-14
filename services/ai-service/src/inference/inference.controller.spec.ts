import { InferenceController } from './inference.controller';
import { FallbackService } from '../services/fallback.service';
import { ModelHealthService } from '../services/model-health.service';
import { FeatureService } from '../services/feature.service';
import { BidWinProbabilityEngine } from '../bid-prediction/bid-win-probability.engine';
import { FareAdjustmentEngine } from './fare-adjustment.engine';

const mockModelRegistry = {
  invoke: jest.fn(),
  getRecord: jest.fn().mockReturnValue(undefined), // no shadow slots configured
  getChampion: jest.fn().mockReturnValue({ version: 'v1', endpointName: undefined }), // no endpoint deployed
  invokeEndpoint: jest.fn(),
} as any;

const fallbackService = new FallbackService();
const bidEngine = new BidWinProbabilityEngine();
const fareEngine = new FareAdjustmentEngine();

const mockInferenceLog = {
  log: jest.fn(),
} as any;

const mockFeatures = {
  buildFareFeatures: jest.fn().mockResolvedValue({ distanceMiles: 3, durationMin: 12 }),
  buildFraudFeatures: jest.fn().mockReturnValue({ userId: 'u-1', linkedAccounts: 0, deviceFingerprints: 1, fraudFlagCount: 0, disputeCount: 0, accountAgeDays: 100, totalTrips: 5 }),
  buildBidFeatures: jest.fn().mockResolvedValue({ bidAmount: 20, aiFare: 18 }),
  buildSurgeFeatures: jest.fn().mockResolvedValue({ lat: 40.7, lng: -74.1, currentRequests: 0 }),
  buildDriverEarningsFeatures: jest.fn().mockReturnValue({ lat: 40.7, lng: -74.1 }),
} as any;

// Shadow gate stub — each test picks the posture explicitly.
const mockShadowMode = {
  isShadow: jest.fn(),
  isLive: jest.fn(),
} as any;

let controller: InferenceController;
let healthService: ModelHealthService;

beforeEach(() => {
  jest.clearAllMocks();
  healthService = new ModelHealthService();
  mockFeatures.buildFareFeatures.mockResolvedValue({ distanceMiles: 3, durationMin: 12 });
  mockShadowMode.isShadow.mockResolvedValue(true); // default posture: shadowed
  controller = new InferenceController(
    mockModelRegistry,
    fallbackService,
    mockInferenceLog,
    healthService,
    mockFeatures,
    bidEngine,
    fareEngine,
    mockShadowMode,
  );
});

// ─── Fare adjustment — shadow gate ────────────────────────────────────────────

describe('InferenceController — fare-adjustment shadow gate', () => {
  // surge 1.0 (+$1.50) + night (+$0.25) + airport (+$0.25) = real rec $2.00
  const loadedBody = {
    distanceMiles: 3, durationMin: 12,
    surgeZoneScore: 1, isNight: true, isAirport: true,
  } as any;

  beforeEach(() => {
    // The engine consumes the LOGGED feature vector (audit consistency), so
    // the mock builder must reflect the loaded body.
    mockFeatures.buildFareFeatures.mockResolvedValue({
      distanceMiles: 3, durationMin: 12,
      surgeZoneScore: 1, isNight: true, isAirport: true, hourOfDay: 23, riderTotalTrips: 0,
    });
  });

  it('while shadowed, serves the neutral adjustment 0 — identical to the caller fallback', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.data.adjustment).toBe(0);
    expect(result.data.shadow).toBe(true);
  });

  it('while shadowed, the REAL recommendation is logged but never applied', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));

    const result = await controller.fareAdjustment(loadedBody);

    // Real recommendation rides along as data…
    expect(result.data.shadowRecommendation).toBe(2);
    // …and is persisted to the inference log…
    expect(mockInferenceLog.log).toHaveBeenCalledTimes(1);
    const logged = mockInferenceLog.log.mock.calls[0][0];
    expect(logged.modelName).toBe('fare-adjustment');
    expect(logged.output.shadowRecommendation).toBe(2);
    expect(logged.output.shadow).toBe(true);
    // …but the served value stays neutral.
    expect(logged.output.adjustment).toBe(0);
    expect(result.data.adjustment).toBe(0);
  });

  it('serves the real recommendation only when the family is live', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));
    mockShadowMode.isShadow.mockResolvedValue(false);

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.data.adjustment).toBe(2);
    expect(result.data.shadow).toBe(false);
    expect(result.data.shadowRecommendation).toBe(2);
  });

  it('uses the local transparent engine when SageMaker is unavailable — not the zero fallback', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.modelVersion).toBe('fare-shadow-v1');
    expect(result.fallbackUsed).toBe(false);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.data.explanation).toContain('zone_demand');
    expect(Array.isArray(result.data.factors)).toBe(true);
    expect(result.inferenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.predictionTimestamp).toBeDefined();
  });

  it('uses the SageMaker champion when an endpoint responds, still shadow-gated', async () => {
    mockModelRegistry.invoke.mockResolvedValue({
      output: { adjustment: 1.5 },
      modelVersion: 'sm-v3',
      confidence: 0.9,
    });

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.modelVersion).toBe('sm-v3');
    expect(result.data.adjustment).toBe(0); // shadowed
    expect(result.data.shadowRecommendation).toBe(1.5);
    expect(result.confidence).toBe(0.9);
  });

  it('every response carries the inference id linking it to its log row', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.data.inferenceLogId).toBe(result.inferenceId);
  });

  it('caps a runaway SageMaker recommendation at ±$2 service-side', async () => {
    mockModelRegistry.invoke.mockResolvedValue({
      output: { adjustment: 7.25 },
      modelVersion: 'sm-v3',
      confidence: 0.9,
    });

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.data.shadowRecommendation).toBe(2);
  });

  it('sanitizes a non-numeric SageMaker output to 0 — NaN can never enter a fare', async () => {
    mockModelRegistry.invoke.mockResolvedValue({
      output: { adjustment: 'garbage' },
      modelVersion: 'sm-v3',
      confidence: 0.9,
    });

    const result = await controller.fareAdjustment(loadedBody);

    expect(result.data.shadowRecommendation).toBe(0);
    expect(Number.isFinite(result.data.adjustment as number)).toBe(true);
  });

  it('reports fallbackUsed honestly: true only when a CONFIGURED endpoint failed', async () => {
    // No endpoint deployed (default mock): the local engine IS the champion.
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));
    let result = await controller.fareAdjustment(loadedBody);
    expect(result.fallbackUsed).toBe(false);

    // Endpoint deployed but failing: the engine stands in — that IS a fallback.
    mockModelRegistry.getChampion.mockReturnValue({ version: 'v3', endpointName: 'sm-fare-prod' });
    mockModelRegistry.invoke.mockRejectedValue(new Error('endpoint 500'));
    result = await controller.fareAdjustment(loadedBody);
    expect(result.fallbackUsed).toBe(true);
    expect(result.modelVersion).toBe('fare-shadow-v1');
    mockModelRegistry.getChampion.mockReturnValue({ version: 'v1', endpointName: undefined });
  });
});

// ─── Bid win probability — shadow gate ────────────────────────────────────────

describe('InferenceController — bid-win-probability shadow gate', () => {
  it('while shadowed, serves the caller fallback value 0.50', async () => {
    const result = await controller.bidWinProbability({ bidAmount: 20, aiFare: 18 });

    expect(result.data.probability).toBe(0.5);
    expect(result.data.shadow).toBe(true);
    // Real prediction is carried and logged, never served.
    expect(result.data.shadowRecommendation).not.toBe(0.5);
    const logged = mockInferenceLog.log.mock.calls[0][0];
    expect(logged.output.probability).toBe(0.5);
    expect(logged.output.shadowRecommendation).toBe(result.data.shadowRecommendation);
  });

  it('serves the engine probability only when the family is live', async () => {
    mockShadowMode.isShadow.mockResolvedValue(false);

    const result = await controller.bidWinProbability({ bidAmount: 20, aiFare: 18 });

    expect(result.data.probability).toBe(result.data.shadowRecommendation);
    expect(result.data.probability).toBeGreaterThanOrEqual(0.05);
    expect(result.data.probability).toBeLessThanOrEqual(0.95);
    expect(result.data.shadow).toBe(false);
  });

  it('runs the rule engine directly — never the model registry', async () => {
    const result = await controller.bidWinProbability({
      bidAmount: 25, aiFare: 18,
      availableDriversInZone: 10,
      isAirport: true,
    });

    expect(result.modelVersion).toBe('rule-v1');
    expect(result.fallbackUsed).toBe(false);
    expect(Array.isArray(result.data.explanation)).toBe(true);
    expect((result.data.explanation as string[]).length).toBeGreaterThan(0);
    expect(mockModelRegistry.invoke).not.toHaveBeenCalled();
  });
});

// ─── Unchanged envelope endpoints ─────────────────────────────────────────────

describe('InferenceController — response envelope', () => {
  it('POST /ai/fraud-score returns correct envelope when model unavailable', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint'));

    const result = await controller.fraudScore({
      userId: 'u-1', userRole: 'rider',
      linkedAccounts: 0, deviceFingerprints: 1, fraudFlagCount: 0,
      disputeCount: 0, accountAgeDays: 100, totalTrips: 5,
      ruleScore: 600, identityVerified: true, paymentVerified: true, emailVerified: true,
    });

    expect(result.data).toHaveProperty('fraudProbability');
    expect(result.fallbackUsed).toBe(true);
    expect(result.predictionTimestamp).toBeDefined();
  });

  it('POST /ai/surge-forecast returns correct envelope', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint'));

    const result = await controller.surgeForecast({ lat: 40.7, lng: -74.1 });

    expect(result.data).toHaveProperty('forecastedMultiplier');
    expect(result.predictionTimestamp).toBeDefined();
  });

  it('POST /ai/driver-earnings returns floor estimate', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint'));

    const result = await controller.driverEarnings({ lat: 40.7, lng: -74.1 });

    expect(result.data).toHaveProperty('estimatedEarnings');
    expect(result.data.estimatedEarnings).toBe(8.44);
  });
});

// ─── Inference log is always called ───────────────────────────────────────────

describe('InferenceController — inference logging', () => {
  it('calls inferenceLog.log after every fare inference, including engine-served ones', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint'));

    await controller.fareAdjustment({ distanceMiles: 3, durationMin: 12 } as any);

    expect(mockInferenceLog.log).toHaveBeenCalledTimes(1);
    expect(mockInferenceLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'fare-adjustment',
        modelVersion: 'fare-shadow-v1',
        latencyMs: expect.any(Number),
      }),
    );
  });

  it('logs bid-win-probability with rule engine version', async () => {
    await controller.bidWinProbability({ bidAmount: 20, aiFare: 18 });

    expect(mockInferenceLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'bid-win-probability',
        modelVersion: 'rule-v1',
        fallbackUsed: false,
      }),
    );
  });
});

// ─── Prohibited attributes never enter the fare feature vector ────────────────

describe('FeatureService — fare feature allowlist', () => {
  it('buildFareFeatures never emits trust scores, even if a caller smuggles one in', async () => {
    const realFeatures = new FeatureService({} as any, undefined);

    const vector = await realFeatures.buildFareFeatures({
      distanceMiles: 3,
      durationMin: 12,
      riderTotalTrips: 30,
      riderTrustScore: 900, // prohibited — must be dropped
    } as any);

    expect(vector).not.toHaveProperty('riderTrustScore');
    expect(vector).not.toHaveProperty('driverTrustScore');
    expect(vector.riderTotalTrips).toBe(30);
  });
});

// ─── Health endpoint ───────────────────────────────────────────────────────────

describe('InferenceController — GET /ai/health', () => {
  it('returns service uptime and model health map', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint'));
    await controller.fareAdjustment({ distanceMiles: 3, durationMin: 12 } as any);

    const health = controller.getHealth();

    expect(health.service).toHaveProperty('uptime');
    expect(health.service.version).toBe('1.0.0');
    expect(health.models['fare-adjustment']).toBeDefined();
    expect(health.models['fare-adjustment'].totalInferences).toBe(1);
  });
});
