import { aggregateHealth, checkAll, makeDbChecker, makeRedisChecker, makeHttpChecker } from '../health';
import type { ComponentHealth } from '../health';

describe('aggregateHealth', () => {
  const healthy: ComponentHealth = { name: 'db', status: 'healthy', required: true };
  const degraded: ComponentHealth = { name: 'cache', status: 'degraded', required: false };
  const unhealthyRequired: ComponentHealth = { name: 'db', status: 'unhealthy', required: true };
  const unhealthyOptional: ComponentHealth = { name: 'maps', status: 'unhealthy', required: false };

  it('returns healthy when all components are healthy', () => {
    expect(aggregateHealth([healthy])).toBe('healthy');
  });

  it('returns degraded when optional component is unhealthy', () => {
    expect(aggregateHealth([healthy, unhealthyOptional])).toBe('degraded');
  });

  it('returns unhealthy when required component is unhealthy', () => {
    expect(aggregateHealth([unhealthyRequired])).toBe('unhealthy');
  });

  it('returns degraded when any component is degraded', () => {
    expect(aggregateHealth([healthy, degraded])).toBe('degraded');
  });

  it('unhealthy required overrides degraded optional', () => {
    expect(aggregateHealth([unhealthyRequired, degraded])).toBe('unhealthy');
  });
});

describe('checkAll', () => {
  it('returns healthy report when all checkers pass', async () => {
    const checker = async (): Promise<ComponentHealth> => ({
      name: 'db', status: 'healthy', latencyMs: 5, required: true,
    });
    const report = await checkAll([checker]);
    expect(report.status).toBe('healthy');
    expect(report.components).toHaveLength(1);
    expect(report.uptime).toBeGreaterThanOrEqual(0);
  });

  it('marks component unhealthy when checker throws', async () => {
    const badChecker = async (): Promise<ComponentHealth> => { throw new Error('DB down'); };
    const report = await checkAll([badChecker]);
    expect(report.status).toBe('unhealthy');
    expect(report.components[0].details).toContain('DB down');
  });

  it('includes timestamp in ISO format', async () => {
    const report = await checkAll([]);
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(report.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('makeDbChecker', () => {
  it('returns healthy on successful ping', async () => {
    const checker = makeDbChecker(async () => {}, 'postgresql');
    const result = await checker();
    expect(result.status).toBe('healthy');
    expect(result.name).toBe('postgresql');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy when ping throws', async () => {
    const checker = makeDbChecker(async () => { throw new Error('Connection refused'); }, 'postgresql');
    const result = await checker();
    expect(result.status).toBe('unhealthy');
    expect(result.details).toContain('Connection refused');
  });

  it('marks as required', async () => {
    const checker = makeDbChecker(async () => {});
    const result = await checker();
    expect(result.required).toBe(true);
  });
});

describe('makeRedisChecker', () => {
  it('returns healthy when redis responds PONG', async () => {
    const checker = makeRedisChecker(async () => 'PONG');
    const result = await checker();
    expect(result.status).toBe('healthy');
  });

  it('returns degraded when redis responds unexpectedly', async () => {
    const checker = makeRedisChecker(async () => 'NOPE');
    const result = await checker();
    expect(result.status).toBe('degraded');
  });

  it('returns unhealthy when ping throws', async () => {
    const checker = makeRedisChecker(async () => { throw new Error('ECONNREFUSED'); });
    const result = await checker();
    expect(result.status).toBe('unhealthy');
  });
});

describe('makeHttpChecker', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('returns healthy when HTTP call succeeds with 2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const checker = makeHttpChecker(() => 'http://svc/health', 'ai-service');
    const result = await checker();
    expect(result.status).toBe('healthy');
    expect(result.name).toBe('ai-service');
  });

  it('returns degraded when HTTP call returns non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
    const checker = makeHttpChecker(() => 'http://svc/health', 'payment-service');
    const result = await checker();
    expect(result.status).toBe('degraded');
  });

  it('returns unhealthy for required service when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const checker = makeHttpChecker(() => 'http://svc/health', 'db', true);
    const result = await checker();
    expect(result.status).toBe('unhealthy');
    expect(result.required).toBe(true);
  });

  it('returns degraded (not unhealthy) for optional service when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as any;
    const checker = makeHttpChecker(() => 'http://svc/health', 'maps', false);
    const result = await checker();
    expect(result.status).toBe('degraded');
  });
});
