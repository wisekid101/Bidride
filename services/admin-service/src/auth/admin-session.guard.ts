import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminAuthService, AdminTokenPayload } from './admin-auth.service';

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
  constructor(private readonly adminAuth: AdminAuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
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
