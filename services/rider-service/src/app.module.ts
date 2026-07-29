import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { throttlerClientIp } from './throttler-tracker';
import { RidersModule } from './riders/riders.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { TrustedContactsModule } from './trusted-contacts/trusted-contacts.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import {
  HEALTH_CHECKERS,
  HealthChecker,
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
  ObservabilityMetricsController,
  ObservabilityModule,
} from '@bidride/observability/nest';
import { PrismaService } from './prisma/prisma.service';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisModule } from './redis/redis.module';

const SERVICE_NAME = 'rider-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // PO-1C-ii: the existing HealthController keeps serving /health for the ALB
  // probe; the shared controllers ADD /live, /ready and /metrics.
  controllers: [HealthController, ObservabilityHealthController, ObservabilityMetricsController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The
  // geocoding controller's sole (redundant) controller-level ThrottlerGuard is
  // removed so the guard executes exactly once per request.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    PrismaService,
    { provide: OBSERVABILITY_OPTIONS, useValue: { serviceName: SERVICE_NAME, version: VERSION } },
    {
      provide: HEALTH_CHECKERS,
      useFactory: (prisma: PrismaService, redis: Redis): HealthChecker[] => [
        async () => {
          const start = Date.now();
          try {
            await prisma.$queryRaw`SELECT 1`;
            return { name: 'postgresql', status: 'healthy', latencyMs: Date.now() - start, required: true };
          } catch (err) {
            return {
              name: 'postgresql', status: 'unhealthy', latencyMs: Date.now() - start,
              required: true, details: (err as Error).message,
            };
          }
        },
        async () => {
          const start = Date.now();
          try {
            const pong = await redis.ping();
            return {
              name: 'redis', status: pong === 'PONG' ? 'healthy' : 'degraded',
              latencyMs: Date.now() - start, required: true,
            };
          } catch (err) {
            return {
              name: 'redis', status: 'unhealthy', latencyMs: Date.now() - start,
              required: true, details: (err as Error).message,
            };
          }
        },
      ],
      inject: [PrismaService, REDIS_CLIENT],
    },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    ObservabilityModule,
    // S0-B3B1: getTracker resolves the real client IP from the ALB-appended
    // X-Forwarded-For (throttling only; req.ip is untouched). Limit/window unchanged.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100, getTracker: throttlerClientIp }]),
    RidersModule,
    PaymentMethodsModule,
    TrustedContactsModule,
    GeocodingModule,
  ],
})
export class AppModule {}
