import './observability/auth-metrics';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import {
  HEALTH_CHECKERS,
  HealthChecker,
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
  ObservabilityMetricsController,
  ObservabilityModule,
} from '@bidride/observability/nest';
import { AuthModule } from './auth/auth.module';
import { RedisModule, REDIS_CLIENT } from './redis/redis.module';
import { WebSocketEventGateway } from './websocket/websocket.gateway';
import { PrismaService } from './prisma/prisma.service';
import { HealthController } from './health.controller';

const SERVICE_NAME = 'auth-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // HealthController retains backward-compatible /health/live and /health/ready.
  // The shared controllers add standardized /health (liveness), /ready, /metrics.
  controllers: [HealthController, ObservabilityHealthController, ObservabilityMetricsController],
  providers: [
    WebSocketEventGateway,
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
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 300 }]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    RedisModule,
    AuthModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
