import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';

@Controller('admin/ai')
export class AiMetricsController {
  @Get('metrics')
  async getMetrics() {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/ai/metrics`, {
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
