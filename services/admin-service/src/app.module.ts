import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AdminAuthModule } from './auth/admin-auth.module';
import { FraudModule } from './fraud/fraud.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { RefundsModule } from './refunds/refunds.module';
import { SupportModule } from './support/support.module';
import { AiModule } from './ai/ai.module';
import { MarketplaceAdminModule } from './marketplace/marketplace.module';
import { SafetyAdminModule } from './safety/safety-admin.module';
import { FinanceModule } from './finance/finance.module';
import { OperationsModule } from './operations/operations.module';
import { DriversAdminModule } from './drivers/drivers-admin.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    AdminAuthModule,
    AnalyticsModule,
    AuditModule,
    FraudModule,
    PlatformConfigModule,
    RefundsModule,
    SupportModule,
    AiModule,
    MarketplaceAdminModule,
    SafetyAdminModule,
    FinanceModule,
    OperationsModule,
    DriversAdminModule,
  ],
})
export class AppModule {}
