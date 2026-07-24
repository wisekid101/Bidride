import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

const KEYLESS_ALLOWED_ENVS = new Set(['development', 'test']);

// Authenticates internal service-to-service calls to /internal/notifications/*.
// Replicated verbatim from the proven ai-service/payment-service/trust-service
// guard (no shared guard package exists). Fail CLOSED in production, keyless-
// allowed only in development/test, constant-time comparison.
@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const requiredKey = process.env.INTERNAL_SERVICE_KEY;
    if (!requiredKey) {
      // A missing key in production OR staging (or any unrecognized NODE_ENV)
      // must never silently expose internal endpoints. Bootstrap additionally
      // refuses production startup — defense in depth.
      if (!KEYLESS_ALLOWED_ENVS.has(process.env.NODE_ENV ?? '')) {
        throw new UnauthorizedException('INTERNAL_SERVICE_KEY is not configured');
      }
      return true;
    }

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const presented = req.headers['x-internal-key'];
    if (typeof presented !== 'string' || !constantTimeEquals(presented, requiredKey)) {
      throw new UnauthorizedException('Invalid internal service key');
    }
    return true;
  }
}

// Constant-time comparison — key checks must not leak match length/prefix
// through response timing.
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
