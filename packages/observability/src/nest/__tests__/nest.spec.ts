import {
  correlationStore,
  extractFromHeaders,
  generateCorrelationId,
  getCorrelationId,
  withCorrelation,
} from '../../correlation';
import { BidRideLogger } from '../../logger';
import { registry, bidRideMetrics } from '../../metrics';
import { CorrelationMiddleware } from '../correlation.middleware';
import { ObservabilityHealthController } from '../health.controller';
import { ObservabilityMetricsController } from '../metrics.controller';
import { ObservabilityModule } from '../observability.module';
import { HEALTH_CHECKERS, OBSERVABILITY_OPTIONS } from '../tokens';

/** Capture everything written to stdout/stderr during `fn`. */
function captureStdout(fn: () => void): string[] {
  const lines: string[] = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const sink = (chunk: any): boolean => {
    lines.push(String(chunk));
    return true;
  };
  (process.stdout as any).write = sink;
  (process.stderr as any).write = sink;
  try {
    fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines.join('').split('\n').filter(Boolean);
}

/** Minimal fake Express response that records headers/status and fires 'finish'. */
function fakeRes() {
  const headers: Record<string, string> = {};
  let finish: (() => void) | undefined;
  return {
    statusCode: 200,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    on: (evt: string, cb: () => void) => {
      if (evt === 'finish') finish = cb;
    },
    triggerFinish: () => finish?.(),
    headers,
  };
}

describe('correlation context', () => {
  it('generates a correlation id when none is supplied', () => {
    const id = extractFromHeaders({});
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(generateCorrelationId()).not.toBe(id);
  });

  it('preserves an inbound correlation id', () => {
    expect(extractFromHeaders({ 'x-correlation-id': 'abc-123' })).toBe('abc-123');
    expect(extractFromHeaders({ 'x-request-id': 'req-9' })).toBe('req-9');
  });

  it('remains available through asynchronous execution (AsyncLocalStorage)', async () => {
    await withCorrelation('trace-async', async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(getCorrelationId()).toBe('trace-async');
    });
  });
});

describe('CorrelationMiddleware', () => {
  it('sets the x-correlation-id response header from an inbound id', () => {
    const mw = new CorrelationMiddleware();
    const res = fakeRes();
    mw.use({ headers: { 'x-correlation-id': 'inbound-1' }, method: 'GET' }, res, () => {});
    expect(res.headers['x-correlation-id']).toBe('inbound-1');
  });

  it('emits one structured request log with correlationId and no body/headers', () => {
    const mw = new CorrelationMiddleware();
    const res = fakeRes();
    const lines = captureStdout(() => {
      mw.use(
        { headers: { 'x-correlation-id': 'log-1' }, method: 'POST', route: { path: '/verify-otp' } },
        res,
        () => {},
      );
      (res as any).statusCode = 201;
      res.triggerFinish();
    });
    const entry = JSON.parse(lines.find((l) => l.includes('http_request'))!);
    expect(entry).toMatchObject({
      level: 'info',
      message: 'http_request',
      correlationId: 'log-1',
      method: 'POST',
      route: '/verify-otp',
      statusCode: 201,
    });
    expect(typeof entry.durationMs).toBe('number');
    // never log bodies or headers
    expect(entry).not.toHaveProperty('body');
    expect(entry).not.toHaveProperty('headers');
    expect(entry).not.toHaveProperty('authorization');
  });

  it('records HTTP count and duration metrics with bounded labels', () => {
    const before = bidRideMetrics.httpRequestsTotal.get({ method: 'GET', status: '200' });
    const mw = new CorrelationMiddleware();
    const res = fakeRes();
    captureStdout(() => {
      mw.use({ headers: {}, method: 'GET', route: { path: '/ping' } }, res, () => {});
      res.triggerFinish();
    });
    expect(bidRideMetrics.httpRequestsTotal.get({ method: 'GET', status: '200' })).toBe(before + 1);
    const text = registry.toPrometheusText();
    // duration histogram present and labelled by method only (no ids/urls)
    expect(text).toContain('bidride_http_request_duration_seconds');
    expect(text).not.toMatch(/method="GET",[a-z]+="[0-9a-f-]{36}"/);
  });
});

describe('BidRideLogger PII redaction', () => {
  it('redacts sensitive fields', () => {
    const logger = new BidRideLogger('test');
    const lines = captureStdout(() => {
      logger.info('sensitive', {
        password: 'hunter2',
        otp: '123456',
        token: 'jwt.abc',
        authorization: 'Bearer x',
        cookie: 'sid=1',
        ssn: '123456789',
        cvv: '999',
        cardNumber: '4111111111111111',
      });
    });
    const entry = JSON.parse(lines[0]);
    for (const k of ['password', 'otp', 'token', 'authorization', 'cookie', 'ssn', 'cvv', 'cardNumber']) {
      expect(entry[k]).toBe('[REDACTED]');
    }
    expect(lines.join('')).not.toContain('hunter2');
    expect(lines.join('')).not.toContain('123456');
    expect(lines.join('')).not.toContain('4111111111111111');
  });
});

describe('MetricsRegistry', () => {
  it('returns the same instance for a repeated registration (reload-safe)', () => {
    const a = registry.counter('bidride_test_dup_total', 'help one');
    const b = registry.counter('bidride_test_dup_total', 'help two');
    expect(a).toBe(b);
    a.inc();
    expect(a.get()).toBe(b.get());
  });

  it('renders Prometheus text including core HTTP metrics', () => {
    const text = registry.toPrometheusText();
    expect(text).toContain('bidride_http_requests_total');
    expect(text).toContain('# TYPE bidride_http_requests_total counter');
  });
});

describe('ObservabilityHealthController', () => {
  it('/live is liveness — up regardless of dependencies', () => {
    const c = new ObservabilityHealthController([], { serviceName: 'auth-service', version: '9.9.9' });
    const body = c.live();
    expect(body).toMatchObject({ status: 'healthy', service: 'auth-service', version: '9.9.9' });
    expect(typeof body.uptime).toBe('number');
  });

  it('/ready returns 503 when a required dependency is unhealthy', async () => {
    const checkers = [
      async () => ({ name: 'postgresql', status: 'unhealthy' as const, required: true }),
    ];
    const c = new ObservabilityHealthController(checkers, { serviceName: 'auth-service' });
    const res = fakeRes();
    const report = await c.ready(res);
    expect(report.status).toBe('unhealthy');
    expect(res.statusCode).toBe(503);
  });

  it('/ready is healthy when all required dependencies are healthy', async () => {
    const checkers = [
      async () => ({ name: 'postgresql', status: 'healthy' as const, required: true }),
      async () => ({ name: 'redis', status: 'healthy' as const, required: true }),
    ];
    const c = new ObservabilityHealthController(checkers, { serviceName: 'auth-service' });
    const res = fakeRes();
    const report = await c.ready(res);
    expect(report.status).toBe('healthy');
    expect(res.statusCode).toBe(200);
  });
});

describe('ObservabilityMetricsController', () => {
  it('/metrics returns Prometheus exposition text', () => {
    const text = new ObservabilityMetricsController().metrics();
    expect(text).toContain('bidride_http_requests_total');
  });
});

describe('ObservabilityModule', () => {
  it('registers the correlation middleware exactly once for all routes', () => {
    const applied: any[] = [];
    const consumer: any = {
      apply: (...mw: any[]) => {
        applied.push(...mw);
        return { forRoutes: () => undefined };
      },
    };
    new ObservabilityModule().configure(consumer);
    expect(applied).toEqual([CorrelationMiddleware]);
    expect(applied).toHaveLength(1);
  });
});

describe('DI tokens', () => {
  it('exposes stable token strings', () => {
    expect(HEALTH_CHECKERS).toBe('BIDRIDE_HEALTH_CHECKERS');
    expect(OBSERVABILITY_OPTIONS).toBe('BIDRIDE_OBSERVABILITY_OPTIONS');
  });
});
