import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { getCorrelationId } from '@bidride/observability';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';

// PO-1C-ii: carry the admin request's correlation into the callee so one id
// spans both hops. Omitted when no context is in scope — never fabricated.
function correlationHeader(): Record<string, string> {
  const id = getCorrelationId();
  return id ? { 'x-correlation-id': id } : {};
}


// SEC-1: Model metrics and AI health.
@Roles('analytics_admin', 'operations_admin')
@Controller('admin/ai')
export class AiMetricsController {
  @Get('metrics')
  async getMetrics() {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/ai/metrics`, {
        headers: correlationHeader(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`ai-service ${res.status}`);
      return res.json();
    } catch {
      throw new ServiceUnavailableException('AI service unavailable');
    }
  }

  @Get('health')
  async getHealth() {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/ai/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`ai-service ${res.status}`);
      return res.json();
    } catch {
      throw new ServiceUnavailableException('AI service unavailable');
    }
  }
}
