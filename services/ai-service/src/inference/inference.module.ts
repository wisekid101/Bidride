import { Module } from '@nestjs/common';
import { InferenceController } from './inference.controller';
import { InternalKeyGuard } from '../internal-key.guard';
import { ModelRegistryService } from '../services/model-registry.service';
import { FallbackService } from '../services/fallback.service';
import { InferenceLogService } from '../services/inference-log.service';
import { ModelHealthService } from '../services/model-health.service';
import { FeatureService } from '../services/feature.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { BidPredictionModule } from '../bid-prediction/bid-prediction.module';
import { FareAdjustmentEngine } from './fare-adjustment.engine';
import { ShadowModeService } from '../shadow/shadow-mode.service';

@Module({
  imports: [RedisModule, BidPredictionModule],
  controllers: [InferenceController],
  providers: [
    ModelRegistryService,
    FallbackService,
    InferenceLogService,
    ModelHealthService,
    FeatureService,
    FareAdjustmentEngine,
    ShadowModeService,
    PrismaService,
    InternalKeyGuard,
  ],
})
export class InferenceModule {}
