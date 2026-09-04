import { generateKeyPairSync } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * B8A-F1 — proves the admin support-ticket user JWT guard enforces the
 * user-domain contract (issuer bidride-auth + audience bidride-user), while
 * preserving the existing x-user-id / x-user-role header attachment.
 *
 * SEC-RS256-A — this guard was the one user-token verifier the original RS256
 * migration missed. The support-ticket routes are user-facing, so had issuance
 * flipped while this guard still pinned HS256, every rider would have lost
 * ticket access while the rest of the fleet kept working. The two RS256 cases
 * below are what prove the correction; the HS256 cases are what prove the
 * migration window is safe.
 *
 * Tokens are real — signed with a real secret and a real RSA key, then run
 * through the real resolver and a real jwt.verify.
 */

const SECRET = 'b8a-f1-test-secret';
const ISS = 'bidride-auth';
const AUD = 'bidride-user';
const KID = 'admin-v1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const jwt = new JwtService({});
const guard = new JwtAuthGuard(jwt);

function signHs(
  { iss = ISS, aud = AUD, algorithm }: { iss?: string; aud?: string; algorithm?: string } = {},
) {
  return jwt.sign(
    { sub: 'user-1', role: 'rider' },
    { secret: SECRET, issuer: iss, audience: aud, ...(algorithm ? { algorithm: algorithm as never } : {}) },
  );
}

function signRs({ kid = KID }: { kid?: string } = {}) {
  return jwt.sign(
    { sub: 'user-1', role: 'rider' },
    { privateKey, algorithm: 'RS256', keyid: kid, issuer: ISS, audience: AUD },
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
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [KID]: publicKey });
  });
  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_PUBLIC_KEYS;
  });

  it('accepts a valid HS256 user token (issuer bidride-auth, audience bidride-user)', () => {
    const { context, req } = ctx(signHs());
    expect(guard.canActivate(context)).toBe(true);
    // request-user attachment behavior preserved:
    expect(req.headers['x-user-id']).toBe('user-1');
    expect(req.headers['x-user-role']).toBe('rider');
  });

  it('accepts a valid RS256 user token signed with a known kid', () => {
    const { context, req } = ctx(signRs());
    expect(guard.canActivate(context)).toBe(true);
    expect(req.headers['x-user-id']).toBe('user-1');
    expect(req.headers['x-user-role']).toBe('rider');
  });

  it('rejects an RS256 token whose kid is not in the keyset', () => {
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ 'another-kid': publicKey });
    expect(() => guard.canActivate(ctx(signRs()).context)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong issuer', () => {
    const { context } = ctx(signHs({ iss: 'evil-issuer' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong audience', () => {
    const { context } = ctx(signHs({ aud: 'some-other-aud' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an admin-domain token (audience bidride-admin)', () => {
    const { context } = ctx(signHs({ aud: 'bidride-admin' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects HS384', () => {
    const { context } = ctx(signHs({ algorithm: 'HS384' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects HS512', () => {
    const { context } = ctx(signHs({ algorithm: 'HS512' }));
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an alg:none token', () => {
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'user-1', role: 'rider', iss: ISS, aud: AUD })}.`;
    const { context } = ctx(none);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects when no bearer token is present', () => {
    const { context } = ctx();
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('fails closed if the signing secret is unavailable (no fail-open)', () => {
    // The module supplies the secret via config.getOrThrow('JWT_SECRET') at
    // startup. Post-migration the guard reads it through the resolver, so the
    // fail-closed case is an absent JWT_SECRET rather than an empty JwtService.
    const token = signHs();
    delete process.env.JWT_SECRET;
    expect(() => guard.canActivate(ctx(token).context)).toThrow(UnauthorizedException);
  });
});
