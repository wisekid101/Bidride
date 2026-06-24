import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AdminSessionGuard } from '../auth/admin-session.guard';

@Controller('admin/analytics')
@UseGuards(AdminSessionGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  getDashboardMetrics() {
    return this.analyticsService.getDashboardMetrics();
  }

  @Get('revenue')
  getRevenueTimeSeries(@Query('period') period?: 'day' | 'week' | 'month') {
    return this.analyticsService.getRevenueTimeSeries(period ?? 'week');
  }

  @Get('earnings-floor')
  getEarningsFloorImpact(@Query('period') period?: 'week' | 'month') {
    return this.analyticsService.getEarningsFloorImpact(period ?? 'month');
  }

  @Get('heatmap')
  getTripHeatmap(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
  ) {
    return this.analyticsService.getTripHeatmap(
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius ?? '5'),
    );
  }
}
