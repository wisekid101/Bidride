import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ConfigModule } from '@nestjs/config';
import { InferenceModule } from './inference/inference.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { DataQualityModule } from './data-quality/data-quality.module';
import { FeatureStoreModule } from './feature-store/feature-store.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { DomainsModule } from './domains/domains.module';
import { FounderModule } from './founder/founder.module';
import { RetentionModule } from './retention/retention.module';
import { QualityModule } from './quality/quality.module';
import { SchedulerModule } from './scheduler/scheduler.module';
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

const SERVICE_NAME = 'ai-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // PO-1C-ii: ai-service had no health route of any kind. These add /live,
  // /ready and /metrics.
  //
  // HealthController adds the plain /health that the ECS container health check
  // probes (`curl -sf http://localhost:3012/health`). Without it every probe hit
  // the /* catch-all, returned 404 every 30s, and ECS SIGTERM'd the task until
  // the deployment circuit breaker failed the rollout — even though the service
  // itself booted cleanly. The other services already carry this controller.
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
    InferenceModule,
    MarketplaceModule,
    DataQualityModule,
    FeatureStoreModule,
    RecommendationsModule,
    DomainsModule,
    FounderModule,
    RetentionModule,
    QualityModule,
    SchedulerModule,
  ],
})
export class AppModule {}
