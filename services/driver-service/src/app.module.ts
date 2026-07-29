import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { throttlerClientIp } from './throttler-tracker';
import { DriversModule } from './drivers/drivers.module';
import { DocumentsModule } from './documents/documents.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { EarningsModule } from './earnings/earnings.module';
import {
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
  ObservabilityMetricsController,
  ObservabilityModule,
} from '@bidride/observability/nest';

const SERVICE_NAME = 'driver-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // PO-1C-ii: the existing HealthController keeps serving /health for the ALB
  // probe; the shared controllers ADD /live and /metrics.
  //
  // ARCHITECTURE EXCEPTION — /ready here is "application-process readiness
  // only; dependency readiness is not evaluated because the service lacks
  // injectable Prisma and Redis clients."
  //
  // No HEALTH_CHECKERS are registered. Unlike
  // every other service, driver-service has no injectable PrismaService and no
  // RedisModule: each service constructs its own `new PrismaClient()` and
  // `new Redis({...})`. Registering readiness checks would mean either
  // inventing a DI layer or opening a connection purely to probe it, both of
  // which are architecture changes rather than adoption. /ready therefore
  // reports on zero dependencies until that is addressed — see the PO-1C-ii
  // report. It is honest about checking nothing, rather than falsely healthy.
  controllers: [HealthController, ObservabilityHealthController, ObservabilityMetricsController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The Checkr
  // webhook controller is @SkipThrottle-exempt (provider bursts + signature auth).
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: OBSERVABILITY_OPTIONS, useValue: { serviceName: SERVICE_NAME, version: VERSION } },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    // S0-B3B1: getTracker resolves the real client IP from the ALB-appended
    // X-Forwarded-For (throttling only; req.ip is untouched). Limit/window unchanged.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100, getTracker: throttlerClientIp }]),
    DriversModule,
    DocumentsModule,
    VehiclesModule,
    EarningsModule,
  ],
})
export class AppModule {}
