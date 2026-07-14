import type { HealthChecker } from '../health';

/**
 * DI token for the array of readiness health checkers a service provides.
 * Each service supplies its own dependency checks (DB, Redis, …).
 */
export const HEALTH_CHECKERS = 'BIDRIDE_HEALTH_CHECKERS';

/** DI token for per-service observability options (service name, version). */
export const OBSERVABILITY_OPTIONS = 'BIDRIDE_OBSERVABILITY_OPTIONS';

export interface ObservabilityOptions {
  serviceName: string;
  version?: string;
}

export type { HealthChecker };
