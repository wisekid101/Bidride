import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

// Founder Intelligence is Founder-eyes-only. Runs AFTER AdminSessionGuard
// (which authenticated the session and attached req.adminUser). Additional
// executive roles require an explicit Founder-approved code change here.
const INTELLIGENCE_ROLES = new Set(['founder']);

@Injectable()
export class FounderGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const role: string | undefined = req.adminUser?.role;
    if (!role || !INTELLIGENCE_ROLES.has(role)) {
      throw new ForbiddenException('Founder role required');
    }
    return true;
  }
}
