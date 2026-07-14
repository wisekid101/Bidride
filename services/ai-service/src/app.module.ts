import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InferenceModule } from './inference/inference.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { DataQualityModule } from './data-quality/data-quality.module';
import { FeatureStoreModule } from './feature-store/feature-store.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { DomainsModule } from './domains/domains.module';
import { FounderModule } from './founder/founder.module';
import { RetentionModule } from './retention/retention.module';
import { QualityModule } from './quality/quality.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    InferenceModule,
    MarketplaceModule,
    DataQualityModule,
    FeatureStoreModule,
    RecommendationsModule,
    DomainsModule,
    FounderModule,
    RetentionModule,
    QualityModule,
    SchedulerModule,
  ],
})
export class AppModule {}
