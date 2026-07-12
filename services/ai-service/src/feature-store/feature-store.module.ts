import { Module } from '@nestjs/common';
import { FeatureStoreController } from './feature-store.controller';
import { FeatureStoreService } from './feature-store.service';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';

// RedisModule is @Global() — REDIS_CLIENT resolves without an explicit import.
@Module({
  controllers: [FeatureStoreController],
  providers: [FeatureStoreService, PrismaService, InternalKeyGuard],
  exports: [FeatureStoreService],
})
export class FeatureStoreModule {}
