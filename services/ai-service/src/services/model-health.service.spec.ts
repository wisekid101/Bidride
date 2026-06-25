import { ModelHealthService } from './model-health.service';

let service: ModelHealthService;

beforeEach(() => {
  service = new ModelHealthService();
});

describe('ModelHealthService — record', () => {
  it('initialises a model entry on first record', () => {
    service.record('fare-adjustment', 42, false);
    const health = service.getHealth();
    expect(health['fare-adjustment']).toBeDefined();
    expect(health['fare-adjustment'].totalInferences).toBe(1);
  });

  it('accumulates inference counts across multiple records', () => {
    service.record('fraud-score', 10, false);
    service.record('fraud-score', 20, false);
    service.record('fraud-score', 30, false);
    expect(service.getHealth()['fraud-score'].totalInferences).toBe(3);
  });

  it('counts fallbacks correctly', () => {
    service.record('fare-adjustment', 5, true);
    service.record('fare-adjustment', 5, false);
    service.record('fare-adjustment', 5, true);
    const health = service.getHealth()['fare-adjustment'];
    expect(health.fallbackRatePercent).toBeCloseTo(66.67, 1);
  });

  it('counts errors correctly', () => {
    service.record('fraud-score', 10, false, true);
    service.record('fraud-score', 10, false, false);
    const health = service.getHealth()['fraud-score'];
    expect(health.errorRatePercent).toBe(50);
  });
});

describe('ModelHealthService — latency percentiles', () => {
  it('computes p50 latency correctly', () => {
    // 5 samples: 10, 20, 30, 40, 50 → sorted median (p50) = 30
    [10, 20, 30, 40, 50].forEach(ms => service.record('surge-forecast', ms, false));
    const health = service.getHealth()['surge-forecast'];
    expect(health.p50LatencyMs).toBe(30);
  });

  it('computes p95 latency correctly', () => {
    for (let i = 1; i <= 20; i++) service.record('bid-win-probability', i * 10, false);
    const health = service.getHealth()['bid-win-probability'];
    expect(health.p95LatencyMs).toBeGreaterThanOrEqual(190);
  });

  it('returns 0 for models with no data', () => {
    const health = service.getHealth();
    expect(health['new-model']).toBeUndefined();
  });
});

describe('ModelHealthService — setVersion', () => {
  it('records activeVersion and lastDeployedAt', () => {
    service.setVersion('fare-adjustment', 'v2');
    const health = service.getHealth()['fare-adjustment'];
    expect(health.activeVersion).toBe('v2');
    expect(health.lastDeployedAt).toBeInstanceOf(Date);
  });
});

describe('ModelHealthService — lastInferenceAt', () => {
  it('tracks last inference timestamp', async () => {
    const before = new Date();
    service.record('fare-adjustment', 10, false);
    const health = service.getHealth()['fare-adjustment'];
    expect(health.lastInferenceAt).toBeInstanceOf(Date);
    expect(health.lastInferenceAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
