export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  details?: string;
  required: boolean;
}

export interface HealthReport {
  status: HealthStatus;
  version: string;
  uptime: number;
  components: ComponentHealth[];
  timestamp: string;
}

export type HealthChecker = () => Promise<ComponentHealth>;

export function aggregateHealth(components: ComponentHealth[]): HealthStatus {
  const requiredComponents = components.filter((c) => c.required);
  if (requiredComponents.some((c) => c.status === 'unhealthy')) return 'unhealthy';
  if (components.some((c) => c.status === 'degraded' || c.status === 'unhealthy')) return 'degraded';
  return 'healthy';
}

export async function checkAll(
  checkers: HealthChecker[],
  version = '1.0.0',
): Promise<HealthReport> {
  const components = await Promise.all(
    checkers.map((fn) =>
      fn().catch((err): ComponentHealth => ({
        name: 'unknown',
        status: 'unhealthy',
        required: true,
        details: err instanceof Error ? err.message : String(err),
      })),
    ),
  );

  return {
    status: aggregateHealth(components),
    version,
    uptime: Math.floor(process.uptime()),
    components,
    timestamp: new Date().toISOString(),
  };
}

export function makeDbChecker(pingFn: () => Promise<void>, name = 'postgresql'): HealthChecker {
  return async (): Promise<ComponentHealth> => {
    const start = Date.now();
    try {
      await pingFn();
      return { name, status: 'healthy', latencyMs: Date.now() - start, required: true };
    } catch (err) {
      return {
        name,
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : 'ping failed',
        required: true,
      };
    }
  };
}

export function makeRedisChecker(pingFn: () => Promise<string>, name = 'redis'): HealthChecker {
  return async (): Promise<ComponentHealth> => {
    const start = Date.now();
    try {
      const result = await pingFn();
      const ok = result === 'PONG' || result === 'pong';
      return {
        name,
        status: ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        required: true,
      };
    } catch (err) {
      return {
        name,
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : 'ping failed',
        required: true,
      };
    }
  };
}

export function makeHttpChecker(
  urlFn: () => string,
  name: string,
  required = false,
): HealthChecker {
  return async (): Promise<ComponentHealth> => {
    const start = Date.now();
    try {
      const res = await fetch(urlFn(), { signal: AbortSignal.timeout(3000) });
      return {
        name,
        status: res.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        required,
      };
    } catch (err) {
      return {
        name,
        status: required ? 'unhealthy' : 'degraded',
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : 'unreachable',
        required,
      };
    }
  };
}
