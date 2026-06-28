import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
const internalHeaders = (): Record<string, string> =>
  process.env.INTERNAL_SERVICE_KEY
    ? { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }
    : {};

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
