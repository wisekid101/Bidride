import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SafetyModule } from './safety/safety.module';
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

const SERVICE_NAME = 'safety-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // PO-1C-ii: the existing HealthController keeps serving /health for the ALB
  // probe; the shared controllers ADD /live, /ready and /metrics.
  controllers: [HealthController, ObservabilityHealthController, ObservabilityMetricsController],
  providers: [
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
    SafetyModule,
  ],
})
export class AppModule {}
