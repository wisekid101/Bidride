import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const requiredKey = process.env.INTERNAL_SERVICE_KEY;
    // Not enforced when key is not configured (local dev / alpha without key set)
    if (!requiredKey) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (req.headers['x-internal-key'] !== requiredKey) {
      throw new UnauthorizedException('Invalid internal service key');
    }
    return true;
  }
}
