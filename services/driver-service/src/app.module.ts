import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DriversModule } from './drivers/drivers.module';
import { DocumentsModule } from './documents/documents.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { EarningsModule } from './earnings/earnings.module';

@Module({
  controllers: [HealthController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The Checkr
  // webhook controller is @SkipThrottle-exempt (provider bursts + signature auth).
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DriversModule,
    DocumentsModule,
    VehiclesModule,
    EarningsModule,
  ],
})
export class AppModule {}
