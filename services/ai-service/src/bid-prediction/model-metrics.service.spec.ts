import { ModelMetricsService } from './model-metrics.service';
import { BID_ENGINE_VERSION } from './bid-win-probability.engine';

const mockPrisma = {
  aiInferenceLog: { findMany: jest.fn() },
  bidOutcome: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
} as any;

const service = new ModelMetricsService(mockPrisma);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe('ModelMetricsService — empty state', () => {
  it('returns zero/null metrics when no data exists', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([]);

    const result = await service.getMetrics();

    expect(result.model.version).toBe(BID_ENGINE_VERSION);
    expect(result.model.type).toBe('rule-based');
    expect(result.predictions.total).toBe(0);
    expect(result.predictions.accuracy).toBeNull();
    expect(result.predictions.acceptanceRate).toBeNull();
    expect(result.predictions.avgConfidence).toBeNull();
    expect(result.predictions.rocAucPlaceholder).toBeNull();
    expect(result.predictions.calibration).toHaveLength(0);
  });
});

describe('ModelMetricsService — accuracy computation', () => {
  it('computes accuracy from prediction_correct field', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([
      { wasAccepted: true, predictionProbability: '0.8000', predictionCorrect: true },
      { wasAccepted: true, predictionProbability: '0.7000', predictionCorrect: true },
      { wasAccepted: false, predictionProbability: '0.3000', predictionCorrect: true },
      { wasAccepted: true, predictionProbability: '0.4000', predictionCorrect: false },
    ]);

    const result = await service.getMetrics();

    expect(result.predictions.withOutcome).toBe(4);
    expect(result.predictions.accuracy).toBeCloseTo(0.75, 2); // 3/4
  });

  it('computes false positives and false negatives', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([
      { wasAccepted: false, predictionProbability: '0.8000', predictionCorrect: false }, // FP
      { wasAccepted: false, predictionProbability: '0.9000', predictionCorrect: false }, // FP
      { wasAccepted: true, predictionProbability: '0.3000', predictionCorrect: false },  // FN
    ]);

    const result = await service.getMetrics();

    expect(result.predictions.falsePositives).toBe(2);
    expect(result.predictions.falseNegatives).toBe(1);
  });

  it('computes precision and recall correctly', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([
      { wasAccepted: true,  predictionProbability: '0.8000', predictionCorrect: true  }, // TP
      { wasAccepted: true,  predictionProbability: '0.7000', predictionCorrect: true  }, // TP
      { wasAccepted: false, predictionProbability: '0.6000', predictionCorrect: false }, // FP
      { wasAccepted: true,  predictionProbability: '0.3000', predictionCorrect: false }, // FN
    ]);

    const result = await service.getMetrics();

    // Precision = TP/(TP+FP) = 2/3 ≈ 0.667
    expect(result.predictions.precision).toBeCloseTo(0.667, 2);
    // Recall = TP/(TP+FN) = 2/3 ≈ 0.667
    expect(result.predictions.recall).toBeCloseTo(0.667, 2);
  });
});

describe('ModelMetricsService — latency summary', () => {
  it('computes avg latency, p50, p95 from inference logs', async () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue(
      latencies.map((ms) => ({ confidence: '0.70', fallbackUsed: false, latencyMs: ms })),
    );
    mockPrisma.bidOutcome.findMany.mockResolvedValue([]);

    const result = await service.getMetrics();

    expect(result.latency.avgMs).toBe(55);
    expect(result.latency.p50Ms).toBe(50); // index 4 of sorted [10..100]
    expect(result.latency.p95Ms).toBe(100);
  });

  it('computes fallback rate correctly', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([
      { confidence: '0.7', fallbackUsed: false, latencyMs: 10 },
      { confidence: '0.7', fallbackUsed: false, latencyMs: 10 },
      { confidence: '0.7', fallbackUsed: true, latencyMs: 10 },
      { confidence: '0.7', fallbackUsed: true, latencyMs: 10 },
    ]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([]);

    const result = await service.getMetrics();

    expect(result.fallbackRate).toBe(0.5);
  });
});

describe('ModelMetricsService — zone and hour breakdown', () => {
  it('maps raw SQL rows to zone metrics', async () => {
    mockPrisma.aiInferenceLog.findMany.mockResolvedValue([]);
    mockPrisma.bidOutcome.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ zone_key: '2255:3363', total: 10, correct: 8 }])
      .mockResolvedValueOnce([{ hour: 18, total: 5, correct: 4 }]);

    const result = await service.getMetrics();

    expect(result.byZone).toHaveLength(1);
    expect(result.byZone[0].zone).toBe('2255:3363');
    expect(result.byZone[0].accuracy).toBeCloseTo(0.8, 2);

    expect(result.byHour).toHaveLength(1);
    expect(result.byHour[0].hour).toBe(18);
    expect(result.byHour[0].accuracy).toBeCloseTo(0.8, 2);
  });
});
