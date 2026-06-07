import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PricingModule,
  ],
})
export class AppModule {}
