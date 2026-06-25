import { InferenceController } from './inference.controller';
import { FallbackService } from '../services/fallback.service';
import { ModelHealthService } from '../services/model-health.service';
import { BidWinProbabilityEngine } from '../bid-prediction/bid-win-probability.engine';

const mockModelRegistry = {
  invoke: jest.fn(),
  getRecord: jest.fn().mockReturnValue(undefined), // no shadow slots configured
  invokeEndpoint: jest.fn(),
} as any;

const fallbackService = new FallbackService();
const bidEngine = new BidWinProbabilityEngine();

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

let controller: InferenceController;
let healthService: ModelHealthService;

beforeEach(() => {
  jest.clearAllMocks();
  healthService = new ModelHealthService();
  controller = new InferenceController(
    mockModelRegistry,
    fallbackService,
    mockInferenceLog,
    healthService,
    mockFeatures,
    bidEngine,
  );
});

// ─── Envelope shape ────────────────────────────────────────────────────────────

describe('InferenceController — response envelope', () => {
  it('POST /ai/fare-adjustment returns correct envelope when model unavailable', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint configured'));

    const result = await controller.fareAdjustment({
      distanceMiles: 3, durationMin: 12,
    } as any);

    expect(result.data).toHaveProperty('adjustment');
    expect(result.modelVersion).toBe('fallback-v1');
    expect(result.fallbackUsed).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.inferenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.predictionTimestamp).toBeDefined();
  });

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

  it('POST /ai/bid-win-probability uses rule engine — never fallback', async () => {
    const result = await controller.bidWinProbability({
      bidAmount: 20, aiFare: 18, distanceMiles: 3,
    });

    expect(result.data).toHaveProperty('probability');
    expect(result.data).toHaveProperty('confidence');
    expect(result.data).toHaveProperty('explanation');
    expect(result.fallbackUsed).toBe(false);
    expect(result.modelVersion).toBe('rule-v1');
    expect(result.data.probability).toBeGreaterThanOrEqual(0.05);
    expect(result.data.probability).toBeLessThanOrEqual(0.95);
    expect(result.predictionTimestamp).toBeDefined();
    // Verify modelRegistry.invoke was NOT called — engine runs directly
    expect(mockModelRegistry.invoke).not.toHaveBeenCalled();
  });

  it('POST /ai/bid-win-probability includes explanation strings', async () => {
    const result = await controller.bidWinProbability({
      bidAmount: 25, aiFare: 18,
      riderTrustScore: 900,
      availableDriversInZone: 10,
      isAirport: true,
    });

    expect(Array.isArray(result.data.explanation)).toBe(true);
    expect(result.data.explanation.length).toBeGreaterThan(0);
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
  it('calls inferenceLog.log after every inference', async () => {
    mockModelRegistry.invoke.mockRejectedValue(new Error('No endpoint'));

    await controller.fareAdjustment({ distanceMiles: 3, durationMin: 12 } as any);

    expect(mockInferenceLog.log).toHaveBeenCalledTimes(1);
    expect(mockInferenceLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'fare-adjustment',
        fallbackUsed: true,
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

  it('logs fallbackUsed=false when model returns a result', async () => {
    mockModelRegistry.invoke.mockResolvedValue({
      output: { adjustment: 1.5 },
      modelVersion: 'v1',
      confidence: 0.9,
    });

    await controller.fareAdjustment({ distanceMiles: 3, durationMin: 12 } as any);

    expect(mockInferenceLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackUsed: false }),
    );
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
