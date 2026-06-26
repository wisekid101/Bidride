import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InferenceModule } from './inference/inference.module';
import { MarketplaceModule } from './marketplace/marketplace.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    InferenceModule,
    MarketplaceModule,
  ],
})
export class AppModule {}
