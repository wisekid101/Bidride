import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InferenceModule } from './inference/inference.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { DataQualityModule } from './data-quality/data-quality.module';
import { FeatureStoreModule } from './feature-store/feature-store.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    InferenceModule,
    MarketplaceModule,
    DataQualityModule,
    FeatureStoreModule,
  ],
})
export class AppModule {}
