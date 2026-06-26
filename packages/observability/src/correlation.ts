import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface CorrelationContext {
  correlationId: string;
  traceId: string;
  startedAt: number;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function getTraceId(): string | undefined {
  return correlationStore.getStore()?.traceId;
}

export function getContext(): CorrelationContext | undefined {
  return correlationStore.getStore();
}

export function generateCorrelationId(): string {
  return randomUUID();
}

export function withCorrelation<T>(
  correlationId: string,
  fn: () => T,
  traceId?: string,
): T {
  const ctx: CorrelationContext = {
    correlationId,
    traceId: traceId ?? correlationId,
    startedAt: Date.now(),
  };
  return correlationStore.run(ctx, fn);
}

export function extractFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const raw =
    headers['x-correlation-id'] ??
    headers['x-request-id'] ??
    headers['x-trace-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? generateCorrelationId();
}
