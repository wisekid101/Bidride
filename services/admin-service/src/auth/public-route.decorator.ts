import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as NOT requiring an admin session.
 *
 * SEC-1 makes AdminSessionGuard global, so an admin session is the default and
 * a new controller is protected the moment it is written — the previous
 * per-controller opt-in was how five surfaces ended up public. Exemption is now
 * the thing you have to type, and it is greppable.
 *
 * "No admin session" does NOT mean "no authentication". Three kinds of route
 * qualify:
 *
 *   1. the container/ALB health probe, which carries no credential at all;
 *   2. login and logout, which cannot present the session they create or clear;
 *   3. user-facing routes authenticated by a RIDER or DRIVER JWT — the support
 *      ticket endpoints — which have their own JwtAuthGuard.
 *
 * Every use is deliberate and every use is commented at the call site.
 */
export const NO_ADMIN_SESSION = 'noAdminSession';

export const NoAdminSession = () => SetMetadata(NO_ADMIN_SESSION, true);
