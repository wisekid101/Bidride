import { Module } from '@nestjs/common';
import { DriverRankingEngine } from './driver-ranking.engine';
import { DriverRankingService } from './driver-ranking.service';
import { DispatchSimulatorService } from './dispatch-simulator.service';
import { RepositioningService } from './repositioning.service';
import { HeatmapService } from './heatmap.service';
import { DemandForecastService } from './demand-forecast.service';
import { EarningsOptimizerService } from './earnings-optimizer.service';
import { MarketplaceController } from './marketplace.controller';
import { PrismaService } from '../prisma/prisma.service';
import { InferenceLogService } from '../services/inference-log.service';

// RedisModule is @Global() — no explicit import needed

@Module({
  controllers: [MarketplaceController],
  providers: [
    PrismaService,
    InferenceLogService,
    DriverRankingEngine,
    DriverRankingService,
    DispatchSimulatorService,
    RepositioningService,
    HeatmapService,
    DemandForecastService,
    EarningsOptimizerService,
  ],
  exports: [DriverRankingService, DispatchSimulatorService, HeatmapService],
})
export class MarketplaceModule {}
