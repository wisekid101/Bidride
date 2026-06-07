import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { RefundsModule } from './refunds/refunds.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    AnalyticsModule,
    AuditModule,
    PlatformConfigModule,
    RefundsModule,
  ],
})
export class AppModule {}
