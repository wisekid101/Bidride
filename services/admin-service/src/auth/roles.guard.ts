import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Admin role enforcement (SEC-1).
 *
 * Runs AFTER AdminSessionGuard, which authenticates the session and attaches
 * `req.adminUser` — exactly the pattern FounderGuard already uses. This guard
 * answers "may THIS admin do this?", never "is this an admin?".
 *
 * Authentication and authorization stay separate on purpose: a missing session
 * is a 401 from AdminSessionGuard, an insufficient role is a 403 from here.
 */

export const ADMIN_ROLES_KEY = 'adminRoles';

/**
 * Roles that may reach the decorated controller or handler.
 *
 * `founder` and `super_admin` are added implicitly — they are the top of the
 * hierarchy in CLAUDE.md and are never excluded by a narrower functional role.
 */
export const Roles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

/** Always permitted. Listing them on every route would only invite omissions. */
const ELEVATED_ROLES = new Set(['founder', 'super_admin']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ADMIN_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const role: string | undefined = ctx.switchToHttp().getRequest().adminUser?.role;

    // No role on the request means AdminSessionGuard did not run, or ran and
    // attached nothing. Fail closed rather than assume authentication happened.
    if (!role) throw new ForbiddenException('Admin role required');

    if (ELEVATED_ROLES.has(role) || required.includes(role)) return true;

    throw new ForbiddenException('Insufficient admin role');
  }
}
