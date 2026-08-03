/**
 * admin-service is the only service with a global AdminSessionGuard, so it is
 * the only one where the shared observability controllers land behind
 * authentication. In staging that made /live, /ready and /metrics return 401
 * "No admin session" while /health returned 200 — and because both ECS and the
 * ALB probe /health alone, the service reported perfectly healthy with its
 * readiness endpoint and its entire metrics surface unreachable.
 *
 * Nothing asserted the exemption, so nothing caught it. These tests do.
 */
import { Reflector } from '@nestjs/core';
import { ExecutionContext, Type } from '@nestjs/common';
import {
  ObservabilityHealthController,
  ObservabilityMetricsController,
} from '@bidride/observability/nest';
import { NO_ADMIN_SESSION } from './auth/public-route.decorator';
import { HealthController } from './health.controller';

// Importing AppModule is what applies the exemption — the marker is set at
// module-evaluation time, so the import itself is the code under test.
import './app.module';

describe('admin-service observability exemption', () => {
  const reflector = new Reflector();

  const exemptionFor = (cls: Type<unknown>) =>
    reflector.getAllAndOverride<boolean | undefined>(NO_ADMIN_SESSION, [cls]);

  it.each([
    ['ObservabilityHealthController (/live, /ready)', ObservabilityHealthController],
    ['ObservabilityMetricsController (/metrics)', ObservabilityMetricsController],
    ['HealthController (/health)', HealthController],
  ])('%s is exempt from the admin session guard', (_label, cls) => {
    expect(exemptionFor(cls)).toBe(true);
  });

  it('resolves the exemption the same way AdminSessionGuard does', () => {
    // The guard reads [handler, class] via getAllAndOverride. A marker set on
    // the class must therefore be visible when the handler carries none —
    // otherwise the exemption would silently fail at request time.
    const ctx = {
      getHandler: () => ObservabilityHealthController.prototype.ready,
      getClass: () => ObservabilityHealthController,
    } as unknown as ExecutionContext;

    const exempt = reflector.getAllAndOverride<boolean | undefined>(
      NO_ADMIN_SESSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    expect(exempt).toBe(true);
  });

  it('does not exempt an ordinary admin controller', () => {
    // Guards against a change that blanket-exempts everything. SEC-1 made an
    // admin session the default; this proves the default still holds.
    class SomeAdminController {}
    expect(exemptionFor(SomeAdminController)).toBeUndefined();
  });
});
