import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware';

/**
 * Wires the correlation + request-logging + HTTP-metrics middleware for every route.
 *
 * Controllers (health/metrics) and the HEALTH_CHECKERS / OBSERVABILITY_OPTIONS
 * providers are declared by each consuming service in its own module, so their
 * readiness checkers can inject that service's own dependencies (Prisma, Redis, …)
 * without cross-module DI coupling.
 */
@Module({})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
