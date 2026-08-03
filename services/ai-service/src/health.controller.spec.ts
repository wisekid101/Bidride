/**
 * ai-service was the only service without a plain /health route. The ECS
 * container health check runs `curl -sf http://localhost:3012/health`, so every
 * probe hit the /* catch-all, returned 404 every 30s, and ECS killed the task
 * with SIGTERM 143 until the deployment circuit breaker failed the rollout —
 * while the application itself was booting perfectly.
 *
 * These tests pin the contract that prevents that regression. They avoid
 * supertest deliberately: it is not a dependency of this service, and adding one
 * would change package.json and the lockfile for a health-route fix.
 */
import { HealthController } from './health.controller';

describe('ai-service HealthController', () => {
  const controller = new HealthController();

  it('is mounted at the exact path the ECS health check probes', () => {
    // @Controller('health') + @Get() => GET /health
    const path = Reflect.getMetadata('path', HealthController);
    expect(path).toBe('health');
    const method = Reflect.getMetadata('path', HealthController.prototype.check);
    expect(method).toBe('/');
  });

  it('returns the shared health response contract', () => {
    const res = controller.check();
    expect(res.status).toBe('ok');
    expect(typeof res.service).toBe('string');
    // Must be a parseable ISO timestamp, not an arbitrary string.
    expect(Number.isNaN(Date.parse(res.timestamp))).toBe(false);
  });

  it('carries no authentication guard — container probes send no credentials', () => {
    // A guard would surface as __guards__ metadata on the class or handler.
    expect(Reflect.getMetadata('__guards__', HealthController)).toBeUndefined();
    expect(
      Reflect.getMetadata('__guards__', HealthController.prototype.check),
    ).toBeUndefined();
  });
});

describe('ai-service AppModule wiring', () => {
  it('registers HealthController alongside the observability controllers', async () => {
    // Guards against someone removing /health while keeping /live and /ready —
    // exactly the state that failed in staging.
    const { AppModule } = await import('./app.module');
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', AppModule) ?? [];
    const names = controllers.map((c) => (c as { name: string }).name);
    expect(names).toContain('HealthController');
    expect(names).toContain('ObservabilityHealthController');
    expect(names).toContain('ObservabilityMetricsController');
  });
});
