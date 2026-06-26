import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'stripe-signature']);
const HEADER_IN  = 'x-correlation-id';
const HEADER_OUT = 'x-correlation-id';

export const correlationMap = new Map<string, { startedAt: number }>();

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void): void {
    const id =
      (req.headers[HEADER_IN] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    (req as any).correlationId = id;
    correlationMap.set(id, { startedAt: Date.now() });

    res.setHeader(HEADER_OUT, id);

    res.on('finish', () => {
      const ctx = correlationMap.get(id);
      if (ctx) {
        const duration = Date.now() - ctx.startedAt;
        const redactedHeaders = Object.fromEntries(
          Object.entries(req.headers).filter(([k]) => !SENSITIVE_HEADERS.has(k.toLowerCase())),
        );
        process.stdout.write(JSON.stringify({
          level: 'info',
          message: 'http_request',
          correlationId: id,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: duration,
          userAgent: req.headers['user-agent'],
          headers: redactedHeaders,
          timestamp: new Date().toISOString(),
        }) + '\n');
        correlationMap.delete(id);
      }
    });

    next();
  }
}
