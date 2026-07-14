import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type Redis from 'ioredis';
import {
  HEALTH_CHECKERS,
  HealthChecker,
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
  ObservabilityMetricsController,
  ObservabilityModule,
} from '@bidride/observability/nest';
import { AirportModule } from './airport/airport.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisModule, REDIS_CLIENT } from './redis/redis.module';

const SERVICE_NAME = 'airport-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // Existing HealthController (/health) is unchanged. The shared controllers add
  // standardized /live, /ready, /metrics. Redis is critical for the EWR FIFO
  // queue, so readiness checks both PostgreSQL and Redis. A dedicated
  // PrismaService instance is provided here solely for the readiness DB check;
  // the shared RedisModule (already used by AirportModule) supplies REDIS_CLIENT.
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
              name: 'postgresql',
              status: 'unhealthy',
              latencyMs: Date.now() - start,
              required: true,
              details: (err as Error).message,
            };
          }
        },
        async () => {
          const start = Date.now();
          try {
            const pong = await redis.ping();
            return {
              name: 'redis',
              status: pong === 'PONG' ? 'healthy' : 'degraded',
              latencyMs: Date.now() - start,
              required: true,
            };
          } catch (err) {
            return {
              name: 'redis',
              status: 'unhealthy',
              latencyMs: Date.now() - start,
              required: true,
              details: (err as Error).message,
            };
          }
        },
      ],
      inject: [PrismaService, REDIS_CLIENT],
    },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AirportModule,
    RedisModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
