import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { DriverRankingService, RankDriversInput } from './driver-ranking.service';
import { DispatchSimulatorService, DispatchCandidate } from './dispatch-simulator.service';
import { RepositioningService } from './repositioning.service';
import { HeatmapService } from './heatmap.service';
import { DemandForecastService } from './demand-forecast.service';
import { EarningsOptimizerService } from './earnings-optimizer.service';

interface DispatchSimulateBody {
  tripId: string;
  candidates: DispatchCandidate[];
}

@Controller('ai')
export class MarketplaceController {
  constructor(
    private readonly ranking: DriverRankingService,
    private readonly simulator: DispatchSimulatorService,
    private readonly repositioning: RepositioningService,
    private readonly heatmap: HeatmapService,
    private readonly forecast: DemandForecastService,
    private readonly optimizer: EarningsOptimizerService,
  ) {}

  @Post('driver-ranking')
  rankDrivers(@Body() body: RankDriversInput) {
    return this.ranking.rankDrivers(body);
  }

  @Post('dispatch-simulate')
  simulateDispatch(@Body() body: DispatchSimulateBody) {
    return this.simulator.simulate(body.tripId, body.candidates);
  }

  @Get('repositioning')
  getRepositioning(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    return this.repositioning.getRecommendations(parseFloat(lat), parseFloat(lng));
  }

  @Get('heatmap')
  getHeatmap() {
    return this.heatmap.getHeatmap();
  }

  @Get('demand-forecast')
  getDemandForecast(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    return this.forecast.forecast(parseFloat(lat), parseFloat(lng));
  }

  @Get('earnings-optimizer')
  getEarningsOptimizer(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('hoursOnline') hoursOnline?: string,
    @Query('sessionEarnings') sessionEarnings?: string,
  ) {
    return this.optimizer.getRecommendations(
      parseFloat(lat),
      parseFloat(lng),
      hoursOnline ? parseFloat(hoursOnline) : 0,
      sessionEarnings ? parseFloat(sessionEarnings) : 0,
    );
  }

  // Aggregated stats for admin marketplace dashboard
  @Get('marketplace-stats')
  async getMarketplaceStats(
    @Query('lat') lat = '40.7357',
    @Query('lng') lng = '-74.1724',
  ) {
    const [heatmapData, forecastData] = await Promise.all([
      this.heatmap.getHeatmap(),
      this.forecast.forecast(parseFloat(lat), parseFloat(lng)),
    ]);
    return { heatmap: heatmapData, forecast: forecastData };
  }
}
