import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

// Audit logs are compliance-sensitive; only high-trust roles can access
const COMPLIANCE_ROLES = ['compliance', 'super_admin', 'founder'];

@Injectable()
export class ComplianceGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const role = req.headers['x-user-role'];
    if (!COMPLIANCE_ROLES.includes(role)) throw new ForbiddenException('Compliance role required');
    return true;
  }
}
