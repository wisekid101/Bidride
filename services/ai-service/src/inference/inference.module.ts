import { Module } from '@nestjs/common';
import { InferenceController } from './inference.controller';
import { ModelRegistryService } from '../services/model-registry.service';
import { FallbackService } from '../services/fallback.service';
import { InferenceLogService } from '../services/inference-log.service';
import { ModelHealthService } from '../services/model-health.service';
import { FeatureService } from '../services/feature.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [InferenceController],
  providers: [
    ModelRegistryService,
    FallbackService,
    InferenceLogService,
    ModelHealthService,
    FeatureService,
    PrismaService,
  ],
})
export class InferenceModule {}
