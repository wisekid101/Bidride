import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RidersModule } from './riders/riders.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { TrustedContactsModule } from './trusted-contacts/trusted-contacts.module';
import { GeocodingModule } from './geocoding/geocoding.module';

@Module({
  controllers: [HealthController],
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
