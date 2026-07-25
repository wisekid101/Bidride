import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TripsModule } from './trips/trips.module';
import { BidsModule } from './bids/bids.module';
import { ChatModule } from './chat/chat.module';

@Module({
  controllers: [HealthController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The trips
  // and bids controllers' redundant controller-level ThrottlerGuard is removed so
  // the guard executes exactly once per request (their @Throttle overrides stay).
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    TripsModule,
    BidsModule,
    ChatModule,
  ],
})
export class AppModule {}
