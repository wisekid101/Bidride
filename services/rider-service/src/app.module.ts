import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { RidersModule } from './riders/riders.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { TrustedContactsModule } from './trusted-contacts/trusted-contacts.module';
import { GeocodingModule } from './geocoding/geocoding.module';

@Module({
  controllers: [HealthController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The
  // geocoding controller's sole (redundant) controller-level ThrottlerGuard is
  // removed so the guard executes exactly once per request.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    RidersModule,
    PaymentMethodsModule,
    TrustedContactsModule,
    GeocodingModule,
  ],
})
export class AppModule {}
