import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminSessionGuard } from './admin-session.guard';
import { RolesGuard, ADMIN_ROLES_KEY } from './roles.guard';
import { NO_ADMIN_SESSION } from './public-route.decorator';

// The five controllers that were publicly reachable before SEC-1, plus the
// ones that were already guarded. Imported as the REAL classes so these tests
// read the metadata production actually carries — a spec that re-declares its
// own fixtures would keep passing after someone removes a decorator.
import { FinanceController } from '../finance/finance.controller';
import { OperationsController } from '../operations/operations.controller';
import { SafetyAdminController } from '../safety/safety-admin.controller';
import { MarketplaceAdminController } from '../marketplace/marketplace.controller';
import { AiMetricsController } from '../ai/ai-metrics.controller';
import { AnalyticsController } from '../analytics/analytics.controller';
import { FraudController } from '../fraud/fraud.controller';
import { RefundsController } from '../refunds/refunds.controller';
import { PlatformConfigController } from '../platform-config/platform-config.controller';
import { DriversAdminController } from '../drivers/drivers-admin.controller';
import { AuditController } from '../audit/audit.controller';
import { IntelligenceController } from '../intelligence/intelligence.controller';
import { AdminAuthController } from './admin-auth.controller';
import { HealthController } from '../health.controller';
import { UserTicketController, AdminTicketController } from '../support/support.controller';

// ─── SEC-1: admin authentication and role enforcement ───────────────────────
// AdminSessionGuard and RolesGuard are registered globally, so authentication
// is the default and a new controller is protected the moment it is written.
// These tests exercise the real guards against the real controller metadata.

/** Minimal ExecutionContext double — enough for both guards. */
const ctxFor = (
  target: Function,
  req: Record<string, unknown> = { headers: {} },
) => ({
  switchToHttp: () => ({ getRequest: () => req }),
  getHandler: () => target,
  getClass: () => target,
}) as never;

const withSession = (role: string) => ({
  headers: { cookie: 'admin_session=valid-token' },
  adminUser: { sub: 'admin-1', role },
});

const noSession = () => ({ headers: {} });

/** Every controller reachable under /admin/*, which the ALB routes publicly. */
const ADMIN_CONTROLLERS: Array<[string, Function]> = [
  ['finance', FinanceController],
  ['operations', OperationsController],
  ['safety', SafetyAdminController],
  ['marketplace', MarketplaceAdminController],
  ['ai-metrics', AiMetricsController],
  ['analytics', AnalyticsController],
  ['fraud', FraudController],
  ['refunds', RefundsController],
  ['platform-config', PlatformConfigController],
  ['drivers', DriversAdminController],
  ['audit', AuditController],
  ['intelligence', IntelligenceController],
];

describe('SEC-1 — admin authentication', () => {
  let reflector: Reflector;
  let sessionGuard: AdminSessionGuard;
  let rolesGuard: RolesGuard;
  let verifyToken: jest.Mock;

  beforeEach(() => {
    reflector = new Reflector();
    verifyToken = jest.fn().mockReturnValue({
      sub: 'admin-1', email: 'a@b.com', role: 'operations_admin',
    });
    sessionGuard = new AdminSessionGuard({ verifyToken } as never, reflector);
    rolesGuard = new RolesGuard(reflector);
  });

  // ── Authentication ────────────────────────────────────────────────────────

  it.each(ADMIN_CONTROLLERS)(
    'rejects an unauthenticated request to %s',
    (_name, controller) => {
      expect(() => sessionGuard.canActivate(ctxFor(controller, noSession())))
        .toThrow(UnauthorizedException);
    },
  );

  it.each(ADMIN_CONTROLLERS)('no /admin controller is marked public — %s', (_name, controller) => {
    const isPublic = reflector.getAllAndOverride(NO_ADMIN_SESSION, [controller, controller]);
    expect(isPublic).toBeFalsy();
  });

  it('accepts a valid session', () => {
    const req = { headers: { cookie: 'admin_session=good' } } as Record<string, unknown>;

    expect(sessionGuard.canActivate(ctxFor(FinanceController, req))).toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('good');
    expect((req as { adminUser?: { role: string } }).adminUser?.role).toBe('operations_admin');
  });

  it('rejects an invalid or expired session', () => {
    verifyToken.mockImplementation(() => { throw new Error('expired'); });

    expect(() => sessionGuard.canActivate(
      ctxFor(FinanceController, { headers: { cookie: 'admin_session=stale' } }),
    )).toThrow(UnauthorizedException);
  });

  it('rejects a token whose role is not an admin role at all', () => {
    verifyToken.mockReturnValue({ sub: 'u1', email: 'r@b.com', role: 'rider' });

    expect(() => sessionGuard.canActivate(
      ctxFor(FinanceController, { headers: { cookie: 'admin_session=rider' } }),
    )).toThrow(UnauthorizedException);
  });

  // ── Public exemptions — exactly three, and no more ────────────────────────

  it('the health probe is public', () => {
    expect(reflector.getAllAndOverride(NO_ADMIN_SESSION, [HealthController, HealthController]))
      .toBe(true);
    expect(sessionGuard.canActivate(ctxFor(HealthController, noSession()))).toBe(true);
  });

  it.each(['login', 'logout'])('%s is public — it cannot require the session it manages', (m) => {
    const handler = (AdminAuthController.prototype as unknown as Record<string, Function>)[m];
    expect(reflector.getAllAndOverride(NO_ADMIN_SESSION, [handler, AdminAuthController]))
      .toBe(true);
  });

  it('the auth controller itself is NOT public — only login and logout are', () => {
    expect(reflector.getAllAndOverride(NO_ADMIN_SESSION, [AdminAuthController]))
      .toBeFalsy();
  });

  it('the user-facing ticket controller is exempt — it uses a rider/driver JWT', () => {
    // Riders and drivers must still be able to raise tickets. A global admin
    // session here would 401 every one of them.
    expect(reflector.getAllAndOverride(NO_ADMIN_SESSION, [UserTicketController, UserTicketController]))
      .toBe(true);
  });

  it('the ADMIN ticket controller is not exempt', () => {
    expect(reflector.getAllAndOverride(NO_ADMIN_SESSION, [AdminTicketController, AdminTicketController]))
      .toBeFalsy();
    expect(() => sessionGuard.canActivate(ctxFor(AdminTicketController, noSession())))
      .toThrow(UnauthorizedException);
  });

  it('ws-token still requires a session', () => {
    const handler = (AdminAuthController.prototype as unknown as Record<string, Function>).wsToken;
    expect(reflector.getAllAndOverride(NO_ADMIN_SESSION, [handler, AdminAuthController]))
      .toBeFalsy();
  });
});

describe('SEC-1 — admin role enforcement', () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  const allows = (controller: Function, role: string) =>
    rolesGuard.canActivate(ctxFor(controller, withSession(role)));

  const denies = (controller: Function, role: string) =>
    expect(() => rolesGuard.canActivate(ctxFor(controller, withSession(role))))
      .toThrow(ForbiddenException);

  // ── The role matrix ───────────────────────────────────────────────────────

  it.each([
    ['finance', FinanceController, 'operations_admin'],
    ['operations', OperationsController, 'operations_admin'],
    ['safety', SafetyAdminController, 'safety_admin'],
    ['marketplace', MarketplaceAdminController, 'operations_admin'],
    ['marketplace', MarketplaceAdminController, 'analytics_admin'],
    ['ai-metrics', AiMetricsController, 'analytics_admin'],
    ['ai-metrics', AiMetricsController, 'operations_admin'],
  ])('%s admits its designated role %s', (_n, controller, role) => {
    expect(allows(controller, role)).toBe(true);
  });

  it.each([
    ['finance', FinanceController, 'support_admin'],
    ['finance', FinanceController, 'analytics_admin'],
    ['operations', OperationsController, 'support_admin'],
    ['safety', SafetyAdminController, 'support_admin'],
    ['safety', SafetyAdminController, 'analytics_admin'],
    ['marketplace', MarketplaceAdminController, 'support_admin'],
    ['ai-metrics', AiMetricsController, 'support_admin'],
  ])('%s refuses insufficient role %s', (_n, controller, role) => {
    denies(controller, role);
  });

  it.each([
    ['founder'], ['super_admin'],
  ])('%s reaches every role-gated surface', (role) => {
    for (const controller of [
      FinanceController, OperationsController, SafetyAdminController,
      MarketplaceAdminController, AiMetricsController,
    ]) {
      expect(allows(controller, role)).toBe(true);
    }
  });

  // ── Fail closed ───────────────────────────────────────────────────────────

  it('refuses when no role is attached — never assumes authentication ran', () => {
    expect(() => rolesGuard.canActivate(ctxFor(FinanceController, { headers: {} })))
      .toThrow(ForbiddenException);
  });

  it('allows controllers that declare no roles — authentication still applies', () => {
    expect(rolesGuard.canActivate(ctxFor(AnalyticsController, withSession('analytics_admin'))))
      .toBe(true);
  });

  // ── The specific endpoints named in the audit ─────────────────────────────

  it('financial reads and capture-recovery mutation are role-gated', () => {
    const roles = reflector.getAllAndOverride<string[]>(ADMIN_ROLES_KEY, [FinanceController]);
    expect(roles).toContain('operations_admin');
    // support_admin can raise tickets but must not read revenue or close a
    // capture-recovery item.
    denies(FinanceController, 'support_admin');
  });

  it('SOS administration is gated to safety, not to operations', () => {
    expect(allows(SafetyAdminController, 'safety_admin')).toBe(true);
    denies(SafetyAdminController, 'operations_admin');
  });
});

// ─── SEC-1: adversarial — attempts to break RolesGuard ──────────────────────
// Everything here tries to reach a role-gated surface without the role. The
// guard must fail closed on every malformed, missing or unexpected shape.

describe('SEC-1 — RolesGuard, adversarial', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const attempt = (adminUser: unknown) =>
    guard.canActivate(ctxFor(FinanceController, { headers: {}, adminUser } as Record<string, unknown>));

  it.each([
    ['undefined adminUser', undefined],
    ['null adminUser', null],
    ['empty object', {}],
    ['role undefined', { role: undefined }],
    ['role null', { role: null }],
    ['role empty string', { role: '' }],
    ['role numeric', { role: 1 }],
    ['role boolean true', { role: true }],
    ['role as array', { role: ['founder'] }],
    ['role as object', { role: { name: 'founder' } }],
    ['role wrong case', { role: 'FOUNDER' }],
    ['role with whitespace', { role: ' founder ' }],
    ['role near-miss', { role: 'founder_admin' }],
    ['role prototype key', { role: 'constructor' }],
    ['role prototype key 2', { role: '__proto__' }],
    ['role toString', { role: 'toString' }],
    ['unauthorized admin role', { role: 'support_admin' }],
  ])('refuses %s', (_label, adminUser) => {
    expect(() => attempt(adminUser)).toThrow(ForbiddenException);
  });

  it('a forged x-user-role header cannot satisfy the guard — only req.adminUser counts', () => {
    const req = { headers: { 'x-user-role': 'founder' } } as Record<string, unknown>;

    expect(() => guard.canActivate(ctxFor(FinanceController, req))).toThrow(ForbiddenException);
  });

  it('a forged body or query role cannot satisfy the guard', () => {
    const req = {
      headers: {}, body: { role: 'founder' }, query: { role: 'founder' },
    } as Record<string, unknown>;

    expect(() => guard.canActivate(ctxFor(FinanceController, req))).toThrow(ForbiddenException);
  });

  it.each([['founder'], ['super_admin']])('%s is accepted exactly', (role) => {
    expect(guard.canActivate(ctxFor(FinanceController, { headers: {}, adminUser: { role } })))
      .toBe(true);
  });

  it('an exempt route carrying @Roles still fails closed when no session ran', () => {
    // AdminSessionGuard attaches nothing on an exempt route, so a role-gated
    // route that is ALSO exempt must be refused rather than waved through.
    expect(() => guard.canActivate(ctxFor(FinanceController, { headers: {} })))
      .toThrow(ForbiddenException);
  });

  it('handler metadata overrides class metadata, and still enforces', () => {
    class Probe { handler() { /* no-op */ } }
    Reflect.defineMetadata(ADMIN_ROLES_KEY, ['safety_admin'], Probe);
    Reflect.defineMetadata(ADMIN_ROLES_KEY, ['fraud_admin'], Probe.prototype.handler);

    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, adminUser: { role: 'safety_admin' } }) }),
      getHandler: () => Probe.prototype.handler,
      getClass: () => Probe,
    } as never;

    // The handler's narrower list wins: safety_admin is refused here.
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ─── SEC-1: adversarial — attempts to break AdminSessionGuard ───────────────

describe('SEC-1 — AdminSessionGuard, adversarial', () => {
  let reflector: Reflector;
  let guard: AdminSessionGuard;
  let verifyToken: jest.Mock;

  beforeEach(() => {
    reflector = new Reflector();
    verifyToken = jest.fn().mockReturnValue({ sub: 'a', email: 'a@b.c', role: 'operations_admin' });
    guard = new AdminSessionGuard({ verifyToken } as never, reflector);
  });

  const reject = (headers: Record<string, unknown>) =>
    expect(() => guard.canActivate(ctxFor(FinanceController, { headers })))
      .toThrow(UnauthorizedException);

  it.each([
    ['no headers at all', {}],
    ['empty cookie header', { cookie: '' }],
    ['unrelated cookie', { cookie: 'session=abc' }],
    ['similar cookie name', { cookie: 'admin_session_x=abc' }],
    ['cookie with empty value', { cookie: 'admin_session=' }],
    ['bearer token instead of cookie', { authorization: 'Bearer abc' }],
    ['forged identity headers only', { 'x-user-id': 'a', 'x-user-role': 'founder' }],
  ])('refuses %s', (_label, headers) => {
    reject(headers as Record<string, unknown>);
  });

  it('overwrites forged identity headers with the verified payload', () => {
    // ComplianceGuard and several @Headers() handlers read x-user-role. Because
    // this guard is global it runs BEFORE controller guards and handlers, so a
    // forged header is replaced by the token's own claims.
    const req = {
      headers: { cookie: 'admin_session=t', 'x-user-role': 'founder', 'x-user-id': 'attacker' },
    } as Record<string, Record<string, string>>;

    guard.canActivate(ctxFor(FinanceController, req as never));

    expect(req.headers['x-user-role']).toBe('operations_admin');
    expect(req.headers['x-user-id']).toBe('a');
  });

  it('a non-admin role in a validly signed token is refused', () => {
    verifyToken.mockReturnValue({ sub: 'u', email: 'u@b.c', role: 'driver' });

    reject({ cookie: 'admin_session=valid-but-driver' });
  });
});
