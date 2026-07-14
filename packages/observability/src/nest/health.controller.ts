import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { checkAll } from '../health';
import type { HealthChecker } from '../health';
import { HEALTH_CHECKERS, OBSERVABILITY_OPTIONS, ObservabilityOptions } from './tokens';

/**
 * Standardized health endpoints with honest semantics. These are ADDITIVE new
 * routes — services keep any existing /health routes unchanged during migration.
 *  - GET /live  : liveness — is the process up? (never touches dependencies)
 *  - GET /ready : readiness — runs the service's injected dependency checkers;
 *                 returns 503 when a required dependency is unhealthy.
 */
@Controller()
export class ObservabilityHealthController {
  constructor(
    @Optional() @Inject(HEALTH_CHECKERS) private readonly checkers: HealthChecker[] = [],
    @Optional()
    @Inject(OBSERVABILITY_OPTIONS)
    private readonly options: ObservabilityOptions = { serviceName: 'service' },
  ) {}

  @Get('live')
  live() {
    return {
      status: 'healthy',
      service: this.options?.serviceName,
      version: this.options?.version ?? '1.0.0',
      uptime: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: any) {
    const report = await checkAll(this.checkers ?? [], this.options?.version ?? '1.0.0');
    if (report.status === 'unhealthy' && typeof res?.status === 'function') {
      res.status(503);
    }
    return { ...report, service: this.options?.serviceName };
  }
}
