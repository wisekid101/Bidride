import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  HEALTH_CHECKERS,
  HealthChecker,
  OBSERVABILITY_OPTIONS,
  ObservabilityHealthController,
  ObservabilityMetricsController,
  ObservabilityModule,
} from '@bidride/observability/nest';
import { NotificationsModule } from './notifications/notifications.module';
import { ProxyModule } from './proxy/proxy.module';
import { PrismaService } from './prisma/prisma.service';

const SERVICE_NAME = 'notification-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Module({
  // Existing HealthController (/health) is unchanged. The shared controllers add
  // standardized /live, /ready, /metrics. A dedicated PrismaService instance is
  // provided here solely for the readiness DB check.
  controllers: [HealthController, ObservabilityHealthController, ObservabilityMetricsController],
  providers: [
    PrismaService,
    { provide: OBSERVABILITY_OPTIONS, useValue: { serviceName: SERVICE_NAME, version: VERSION } },
    {
      provide: HEALTH_CHECKERS,
      useFactory: (prisma: PrismaService): HealthChecker[] => [
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
      ],
      inject: [PrismaService],
    },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),
    NotificationsModule,
    ProxyModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
