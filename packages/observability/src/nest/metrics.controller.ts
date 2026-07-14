import { Controller, Get, Header } from '@nestjs/common';
import { registry } from '../metrics';

/** GET /metrics — Prometheus text exposition of the shared global registry. */
@Controller()
export class ObservabilityMetricsController {
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    return registry.toPrometheusText();
  }
}
