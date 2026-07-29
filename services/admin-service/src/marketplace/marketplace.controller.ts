import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { getCorrelationId } from '@bidride/observability';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
// PO-1C-ii: carry the admin request's correlation into the callee so one id
// spans both hops. Omitted when no context is in scope — never fabricated.
const internalHeaders = (): Record<string, string> => ({
  ...(process.env.INTERNAL_SERVICE_KEY
    ? { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }
    : {}),
  ...(getCorrelationId() ? { 'x-correlation-id': getCorrelationId()! } : {}),
});

// SEC-1: Marketplace stats and forecasting — operations and analytics both read this.
@Roles('operations_admin', 'analytics_admin')
@Controller('admin/marketplace')
export class MarketplaceAdminController {
  @Get('stats')
  async getStats(
    @Query('lat') lat = '40.7357',
    @Query('lng') lng = '-74.1724',
  ) {
    try {
      const res = await fetch(
        `${AI_SERVICE_URL}/ai/marketplace-stats?lat=${lat}&lng=${lng}`,
        { headers: internalHeaders(), signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) throw new Error(`ai-service ${res.status}`);
      return res.json();
    } catch {
      throw new ServiceUnavailableException('Marketplace intelligence unavailable');
    }
  }

  @Get('heatmap')
  async getHeatmap() {
    try {
      const res = await fetch(`${AI_SERVICE_URL}/ai/heatmap`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`ai-service ${res.status}`);
      return res.json();
    } catch {
      throw new ServiceUnavailableException('Heatmap service unavailable');
    }
  }

  @Get('forecast')
  async getForecast(
    @Query('lat') lat = '40.7357',
    @Query('lng') lng = '-74.1724',
  ) {
    try {
      const res = await fetch(
        `${AI_SERVICE_URL}/ai/demand-forecast?lat=${lat}&lng=${lng}`,
        { headers: internalHeaders(), signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) throw new Error(`ai-service ${res.status}`);
      return res.json();
    } catch {
      throw new ServiceUnavailableException('Demand forecast unavailable');
    }
  }
}
