import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AdminAuthModule } from './auth/admin-auth.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { RefundsModule } from './refunds/refunds.module';
import { SupportModule } from './support/support.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    AdminAuthModule,
    AnalyticsModule,
    AuditModule,
    PlatformConfigModule,
    RefundsModule,
    SupportModule,
  ],
})
export class AppModule {}
