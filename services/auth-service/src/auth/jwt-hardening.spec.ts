import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { JwtStrategy } from './jwt.strategy';

/**
 * B8A — proves the HS256 hardening contract:
 *  - issued access tokens carry iss/aud/iat/exp (+ existing sub/role/jti)
 *  - verifiers accept a correctly-issued token and reject wrong issuer,
 *    wrong audience, and non-HS256 (incl. alg:none)
 *  - a missing JWT_SECRET fails construction (fail-closed)
 *  - refresh tokens are unchanged (opaque UUID in Redis, not a JWT)
 */

const SECRET = 'b8a-test-secret';
const makeJwt = () => new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });

// The exact verify contract B8A applies in every user-facing verifier.
const USER_VERIFY: JwtVerifyOptions = { algorithms: ['HS256'], issuer: 'bidride-auth', audience: 'bidride-user' };

describe('B8A — access-token issuance (TokenService)', () => {
  it('stamps iss/aud/iat/exp and keeps sub/role/jti; refresh stays an opaque UUID', async () => {
    const jwt = makeJwt();
    const redis = { setex: jest.fn().mockResolvedValue('OK') } as any;
    const svc = new TokenService(jwt, {} as any, redis);

    const { accessToken, refreshToken } = await svc.issueTokenPair('user-1', 'rider' as any);

    const decoded: any = jwt.verify(accessToken, USER_VERIFY);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('rider');
    expect(decoded.jti).toBeDefined();
    expect(decoded.iss).toBe('bidride-auth');
    expect(decoded.aud).toBe('bidride-user');
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number'); // proves module expiresIn merged with iss/aud

    // Refresh token architecture is untouched: opaque UUID persisted in Redis.
    expect(refreshToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(redis.setex).toHaveBeenCalledTimes(1);
    expect(() => jwt.verify(refreshToken)).toThrow(); // not a JWT
  });
});

describe('B8A — verifier contract (algorithms/issuer/audience)', () => {
  const jwt = makeJwt();

  it('accepts a correctly-issued bidride-user token', () => {
    const t = jwt.sign({ sub: 'u', role: 'rider' }, { issuer: 'bidride-auth', audience: 'bidride-user' });
    expect(() => jwt.verify(t, USER_VERIFY)).not.toThrow();
  });

  it('rejects a wrong issuer', () => {
    const t = jwt.sign({ sub: 'u' }, { issuer: 'evil-issuer', audience: 'bidride-user' });
    expect(() => jwt.verify(t, USER_VERIFY)).toThrow();
  });

  it('rejects a wrong audience (e.g. an admin-audience token at a user verifier)', () => {
    const t = jwt.sign({ sub: 'u' }, { issuer: 'bidride-auth', audience: 'bidride-admin' });
    expect(() => jwt.verify(t, USER_VERIFY)).toThrow();
  });

  it('rejects a token signed with a different algorithm (HS512)', () => {
    const t = jwt.sign({ sub: 'u' }, { issuer: 'bidride-auth', audience: 'bidride-user', algorithm: 'HS512' });
    expect(() => jwt.verify(t, USER_VERIFY)).toThrow();
  });

  it('rejects an unsigned alg:none token', () => {
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u', iss: 'bidride-auth', aud: 'bidride-user' })}.`;
    expect(() => jwt.verify(noneToken, USER_VERIFY)).toThrow();
  });
});

describe('B8A — fail-closed on missing secret', () => {
  it('JwtStrategy construction throws when JWT_SECRET is absent', () => {
    const config = {
      getOrThrow: (k: string) => {
        throw new Error(`Configuration key "${k}" does not exist`);
      },
    } as any;
    expect(() => new JwtStrategy(config)).toThrow();
  });
});
