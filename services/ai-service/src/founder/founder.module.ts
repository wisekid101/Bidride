import { Module } from '@nestjs/common';
import { FounderController } from './founder.controller';
import { FounderService } from './founder.service';
import { MarketplaceHealthBrief } from './briefs/marketplace-health.brief';
import { MoneyMapBrief } from './briefs/money-map.brief';
import { AiPerformanceBrief } from './briefs/ai-performance.brief';
import { OpportunityAnalyzer } from './opportunity.analyzer';
import { DomainSwitchService } from '../domains/domain-switch.service';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';
import { RecommendationsModule } from '../recommendations/recommendations.module';

// RedisModule is @Global() — REDIS_CLIENT resolves without an explicit import.
@Module({
  imports: [RecommendationsModule],
  controllers: [FounderController],
  providers: [
    FounderService,
    MarketplaceHealthBrief,
    MoneyMapBrief,
    AiPerformanceBrief,
    OpportunityAnalyzer,
    DomainSwitchService,
    PrismaService,
    InternalKeyGuard,
  ],
})
export class FounderModule {}
