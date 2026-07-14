import { Module } from '@nestjs/common';
import { FeatureStoreController } from './feature-store.controller';
import { FeatureStoreService } from './feature-store.service';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';
import { QualityModule } from '../quality/quality.module';

// RedisModule is @Global() — REDIS_CLIENT resolves without an explicit import.
@Module({
  imports: [QualityModule],
  controllers: [FeatureStoreController],
  providers: [FeatureStoreService, PrismaService, InternalKeyGuard],
  exports: [FeatureStoreService],
})
export class FeatureStoreModule {}
