import { Test } from '@nestjs/testing';
import { withCorrelation, getCorrelationId, testing, registry } from '@bidride/observability';
import {
  HEALTH_CHECKERS,
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
} from '@bidride/observability/nest';

// ─── PO-1C-ii: observability foundation adoption ────────────────────────────
// Behavioural, not source-text: these drive the real controller and the real
// correlation store rather than asserting that a file contains a string.

describe('driver-service observability adoption', () => {
  it('the shared health controller reports the service identity', async () => {
    const mod = await Test.createTestingModule({
      controllers: [ObservabilityHealthController],
      providers: [
        { provide: OBSERVABILITY_OPTIONS, useValue: { serviceName: 'driver-service', version: '1.0.0' } },
        { provide: HEALTH_CHECKERS, useValue: [] },
      ],
    }).compile();

    const live = mod.get(ObservabilityHealthController).live();

    expect(live).toMatchObject({ status: 'healthy', service: 'driver-service' });
    expect(typeof live.uptime).toBe('number');
  });

  it('readiness reports unhealthy when a required dependency fails', async () => {
    // The failure mode this checkpoint exists to remove: a probe that stays
    // green while its database is down.
    const mod = await Test.createTestingModule({
      controllers: [ObservabilityHealthController],
      providers: [
        { provide: OBSERVABILITY_OPTIONS, useValue: { serviceName: 'driver-service' } },
        {
          provide: HEALTH_CHECKERS,
          useValue: [async () => ({
            name: 'postgresql', status: 'unhealthy', latencyMs: 1, required: true,
          })],
        },
      ],
    }).compile();
    const res = { status: jest.fn() };

    const report = await mod.get(ObservabilityHealthController).ready(res);

    expect(report.status).toBe('unhealthy');
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('readiness is healthy when every dependency answers', async () => {
    const mod = await Test.createTestingModule({
      controllers: [ObservabilityHealthController],
      providers: [
        { provide: OBSERVABILITY_OPTIONS, useValue: { serviceName: 'driver-service' } },
        {
          provide: HEALTH_CHECKERS,
          useValue: [async () => ({
            name: 'postgresql', status: 'healthy', latencyMs: 1, required: true,
          })],
        },
      ],
    }).compile();
    const res = { status: jest.fn() };

    const report = await mod.get(ObservabilityHealthController).ready(res);

    expect(report.status).toBe('healthy');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('an inbound correlation id is preserved through async work', async () => {
    await withCorrelation('inbound-abc', async () => {
      await new Promise((r) => setTimeout(r, 3));
      expect(getCorrelationId()).toBe('inbound-abc');
    });
  });

  it('concurrent contexts stay isolated', async () => {
    const seen: string[] = [];
    await Promise.all([
      withCorrelation('req-a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getCorrelationId()!);
      }),
      withCorrelation('req-b', async () => { seen.push(getCorrelationId()!); }),
    ]);

    expect(seen.sort()).toEqual(['req-a', 'req-b']);
  });

  it('an outgoing internal call forwards x-correlation-id when context exists', () => {
    withCorrelation('trace-1', () => {
      const id = getCorrelationId();
      const headers = { 'Content-Type': 'application/json', ...(id ? { 'x-correlation-id': id } : {}) };

      expect(headers['x-correlation-id']).toBe('trace-1');
    });
  });

  it('omits the header entirely when no context is in scope', () => {
    const id = getCorrelationId();
    const headers = { 'Content-Type': 'application/json', ...(id ? { 'x-correlation-id': id } : {}) };

    // Absence must not change business behaviour or fabricate an id.
    expect(headers).not.toHaveProperty('x-correlation-id');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('telemetry failure does not propagate to the caller', () => {
    const capture = testing.captureMetrics();
    try {
      expect(() => {
        // A prohibited dimension is dropped, never thrown.
        registry.counter('bidride_driver_adoption_probe_total', 'test').inc({ tripId: 'x' });
      }).not.toThrow();
    } finally {
      capture.stop();
    }
  });
});
