import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

const KEYLESS_ALLOWED_ENVS = new Set(['development', 'test']);

@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const requiredKey = process.env.INTERNAL_SERVICE_KEY;
    if (!requiredKey) {
      // Fail CLOSED everywhere except explicit local development/test: a
      // missing key in production OR staging (or any unrecognized NODE_ENV)
      // must never silently expose internal endpoints. Bootstrap additionally
      // refuses production startup — this is defense in depth.
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
