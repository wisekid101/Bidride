import { Injectable, NestMiddleware } from '@nestjs/common';
import { correlationStore, extractFromHeaders, getContext, withCorrelation } from '../correlation';
import { BidRideLogger } from '../logger';
import { bidRideMetrics } from '../metrics';

const CORRELATION_HEADER = 'x-correlation-id';
const logger = new BidRideLogger('http');

/**
 * Establishes an AsyncLocalStorage correlation context for every request:
 *  - accepts an inbound x-correlation-id / x-request-id / x-trace-id, or generates one
 *  - echoes it back in the x-correlation-id response header
 *  - keeps it available through the async handler chain
 *  - emits ONE structured request-completion log (method, route template, status, duration)
 *  - records bounded HTTP metrics (labels: method + status only — never IDs or raw URLs)
 *
 * Request/response bodies and headers are never logged.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void): void {
    const id = extractFromHeaders(req?.headers ?? {});
    if (typeof res?.setHeader === 'function') res.setHeader(CORRELATION_HEADER, id);

    withCorrelation(id, () => {
      const ctx = getContext();
      const startedAt = Date.now();

      if (typeof res?.on === 'function') {
        res.on('finish', () => {
          const durationMs = Date.now() - startedAt;
          const method = String(req?.method ?? 'UNKNOWN');
          const status = Number(res?.statusCode ?? 0);
          const route = routeTemplate(req);

          // Log within the captured context so correlationId is attached even
          // though 'finish' fires after the synchronous run() scope has returned.
          const emit = () =>
            logger.info('http_request', { method, route, statusCode: status, durationMs });
          if (ctx) correlationStore.run(ctx, emit);
          else emit();

          // Bounded-cardinality labels only.
          bidRideMetrics.httpRequestsTotal.inc({ method, status: String(status) });
          bidRideMetrics.httpRequestDuration.observe(durationMs / 1000, { method });
          if (status >= 500) bidRideMetrics.httpErrors.inc({ method, status: String(status) });
        });
      }

      next();
    });
  }
}

/**
 * Prefer the matched route template (e.g. "/:id/accept") so metrics/logs never
 * carry raw IDs. Falls back to the path (without query string) for unmatched routes.
 */
function routeTemplate(req: any): string {
  const base = typeof req?.baseUrl === 'string' ? req.baseUrl : '';
  const path = req?.route?.path;
  if (path) return `${base}${path}` || '/';
  const raw =
    typeof req?.path === 'string'
      ? req.path
      : typeof req?.url === 'string'
        ? req.url
        : '/';
  return raw.split('?')[0];
}
