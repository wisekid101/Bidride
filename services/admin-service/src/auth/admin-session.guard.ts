import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService, AdminTokenPayload } from './admin-auth.service';
import { NO_ADMIN_SESSION } from './public-route.decorator';

const ADMIN_ROLES = new Set([
  'founder',
  'super_admin',
  'operations_admin',
  'safety_admin',
  'driver_approval_admin',
  'fraud_admin',
  'support_admin',
  'analytics_admin',
]);

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    // SEC-1: this guard is registered globally, so routes that legitimately
    // carry no admin session — the health probe, login/logout, and the
    // user-JWT ticket endpoints — opt out explicitly with @NoAdminSession().
    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(
      NO_ADMIN_SESSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (exempt) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = this.extractCookie(req, 'admin_session');

    if (!token) throw new UnauthorizedException('No admin session');

    let payload: AdminTokenPayload;
    try {
      payload = this.adminAuth.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired admin session');
    }

    if (!ADMIN_ROLES.has(payload.role)) {
      throw new UnauthorizedException('Insufficient role');
    }

    // Attach to request for use in controllers
    req.adminUser = payload;
    // Backward-compat headers consumed by ComplianceGuard and @Headers() decorators
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-role'] = payload.role;

    return true;
  }

  private extractCookie(req: Record<string, any>, name: string): string | undefined {
    const header: string = req.headers?.['cookie'] ?? '';
    for (const segment of header.split(';')) {
      const [rawKey, ...rest] = segment.trim().split('=');
      if (rawKey === name) {
        return decodeURIComponent(rest.join('='));
      }
    }
    return undefined;
  }
}
