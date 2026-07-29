import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
// PO-1B: correlation context for every request, so a trip id logged in
// trip-service and a capture logged here share one id across the two hops.
import {
  HEALTH_CHECKERS,
  HealthChecker,
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
  ObservabilityMetricsController,
  ObservabilityModule,
} from '@bidride/observability/nest';
import Redis from 'ioredis';
import { PrismaService } from './prisma/prisma.service';
import { REDIS_CLIENT, RedisModule } from './redis/redis.module';
import { throttlerClientIp } from './throttler-tracker';
import { PaymentsModule } from './payments/payments.module';
import { LedgerModule } from './ledger/ledger.module';
import { WalletModule } from './wallet/wallet.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { PayoutBatchModule } from './payouts/payout-batch.module';
import { CaptureRecoveryModule } from './recovery/capture-recovery.module';

const SERVICE_NAME = 'payment-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // PO-1C-i: the static HealthController stays for backward compatibility, but
  // it returns {status:'ok'} unconditionally — it stayed green while PostgreSQL
  // was down. The shared controllers add /health (liveness), /ready (real
  // dependency checks) and /metrics.
  controllers: [HealthController, ObservabilityHealthController, ObservabilityMetricsController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The Stripe
  // webhook controller is @SkipThrottle-exempt; payments/internal keeps its own
  // explicit @Throttle (its redundant controller-level ThrottlerGuard is removed).
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // S0-B3B1: getTracker resolves the real client IP from the ALB-appended
    // X-Forwarded-For (throttling only; req.ip is untouched). Limit/window unchanged.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100, getTracker: throttlerClientIp }]),
    RedisModule,
    ObservabilityModule,
    PaymentsModule,
    LedgerModule,
    WalletModule,
    ReconciliationModule,
    PayoutBatchModule,
    CaptureRecoveryModule,
  ],
})
export class AppModule {}
