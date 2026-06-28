import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TripsModule } from './trips/trips.module';
import { BidsModule } from './bids/bids.module';
import { ChatModule } from './chat/chat.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    TripsModule,
    BidsModule,
    ChatModule,
  ],
})
export class AppModule {}
