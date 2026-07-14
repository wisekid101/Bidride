import { Module } from '@nestjs/common';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { FounderModule } from '../founder/founder.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { RetentionModule } from '../retention/retention.module';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';

// RedisModule is @Global() — REDIS_CLIENT resolves without an explicit import.
@Module({
  imports: [FounderModule, RecommendationsModule, RetentionModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, PrismaService, InternalKeyGuard],
})
export class SchedulerModule {}
