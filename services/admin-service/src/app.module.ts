import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { throttlerClientIp } from './throttler-tracker';
import { AdminSessionGuard } from './auth/admin-session.guard';
import { RolesGuard } from './auth/roles.guard';
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
import { IntelligenceModule } from './intelligence/intelligence.module';

@Module({
  controllers: [HealthController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The
  // intelligence controller's redundant controller-level ThrottlerGuard is
  // removed so the guard executes exactly once per request.
  // SEC-1: authentication is global and role enforcement runs behind it, so a
  // controller is protected by default. Five admin surfaces — finance,
  // operations, safety, marketplace and ai-metrics — were publicly reachable
  // because the previous per-controller opt-in was silently missed on each.
  // Guard order matters: throttle, then authenticate, then authorize.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AdminSessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // S0-B3B1: getTracker resolves the real client IP from the ALB-appended
    // X-Forwarded-For (throttling only; req.ip is untouched). Limit/window unchanged.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200, getTracker: throttlerClientIp }]),
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
    IntelligenceModule,
  ],
})
export class AppModule {}
