import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

const ADMIN_ROLES = ['support', 'operations', 'fraud_analyst', 'safety_officer', 'finance', 'compliance', 'super_admin', 'founder'];

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const role = req.headers['x-user-role'];
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Admin access required');
    return true;
  }
}
