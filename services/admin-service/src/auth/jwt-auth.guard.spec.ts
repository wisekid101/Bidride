import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * B8A-F1 — proves the admin support-ticket user JWT guard now enforces the
 * user-domain contract (HS256 + issuer bidride-auth + audience bidride-user),
 * while preserving the existing x-user-id / x-user-role header attachment.
 */

const SECRET = 'b8a-f1-test-secret';
const makeJwt = () => new JwtService({ secret: SECRET });

// Sign a token with the given claims/options (defaults to a valid user token).
function sign(
  jwt: JwtService,
  { iss = 'bidride-auth', aud = 'bidride-user', algorithm }: { iss?: string; aud?: string; algorithm?: string } = {},
) {
  return jwt.sign(
    { sub: 'user-1', role: 'rider' },
    { issuer: iss, audience: aud, ...(algorithm ? { algorithm: algorithm as any } : {}) },
  );
}

// Minimal ExecutionContext exposing a mutable request with an auth header.
function ctx(token?: string): { context: ExecutionContext; req: any } {
  const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtAuthGuard (admin support-ticket user guard) — B8A-F1', () => {
  const jwt = makeJwt();
  const guard = new JwtAuthGuard(jwt);

  it('accepts a valid HS256 user token (issuer bidride-auth, audience bidride-user)', () => {
    const { context, req } = ctx(sign(jwt));
    expect(guard.canActivate(context)).toBe(true);
    // request-user attachment behavior preserved:
    expect(req.headers['x-user-id']).toBe('user-1');
    expect(req.headers['x-user-role']).toBe('rider');
  });

  it('rejects a wrong issuer', () => {
    const { context } = ctx(sign(jwt, { iss: 'evil-issuer' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong audience', () => {
    const { context } = ctx(sign(jwt, { aud: 'some-other-aud' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an admin-domain token (audience bidride-admin)', () => {
    const { context } = ctx(sign(jwt, { aud: 'bidride-admin' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects HS384', () => {
    const { context } = ctx(sign(jwt, { algorithm: 'HS384' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects HS512', () => {
    const { context } = ctx(sign(jwt, { algorithm: 'HS512' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an alg:none token', () => {
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'user-1', role: 'rider', iss: 'bidride-auth', aud: 'bidride-user' })}.`;
    const { context } = ctx(none);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects when no bearer token is present', () => {
    const { context } = ctx();
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('fails closed if the signing secret is unavailable (no fail-open)', () => {
    // The module supplies the secret via config.getOrThrow('JWT_SECRET') (startup
    // fail-closed). If a JwtService somehow had no usable secret, verification
    // must reject rather than allow.
    const guardNoSecret = new JwtAuthGuard(new JwtService({}));
    const { context } = ctx(sign(jwt));
    expect(() => guardNoSecret.canActivate(context)).toThrow(UnauthorizedException);
  });
});
