import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import {
  parseAdminPublicKeys,
  resolveAdminJwtVerification,
} from './admin-jwt-verification';

/**
 * SEC-RS256-B1 — the admin trust domain's verification-key resolver.
 *
 * The user-domain resolver (user-jwt-verification.ts) reads JWT_PUBLIC_KEYS.
 * This one reads JWT_ADMIN_PUBLIC_KEYS and must NEVER consult the user keyset:
 * the two domains are separate secrets that must not share kid or key material
 * (infrastructure/JWT_PUBLIC_KEY_RUNBOOK.md §8). A user key admitted here would
 * let a rider token be replayed as an admin session.
 *
 * HS256 keeps the ADMIN_JWT_SECRET→JWT_SECRET fallback that AdminAuthModule
 * already uses, so existing admin sessions keep verifying unchanged.
 */

const ADMIN_SECRET = 'b1-admin-secret';
const SHARED_SECRET = 'b1-shared-jwt-secret';
const KID = 'admin-v1';

const { publicKey: adminPublicKey, privateKey: adminPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const { publicKey: userPublicKey, privateKey: userPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const jwt = new JwtService({});

function signAdminRs({ kid = KID, privateKey = adminPrivateKey }: { kid?: string; privateKey?: string } = {}) {
  return jwt.sign(
    { sub: 'admin-1', role: 'founder' },
    { privateKey, algorithm: 'RS256', keyid: kid, issuer: 'bidride-auth', audience: 'bidride-admin' },
  );
}

function signAdminHs({ algorithm }: { algorithm?: string } = {}) {
  return jwt.sign(
    { sub: 'admin-1', role: 'founder' },
    {
      secret: ADMIN_SECRET,
      issuer: 'bidride-auth',
      audience: 'bidride-admin',
      ...(algorithm ? { algorithm: algorithm as never } : {}),
    },
  );
}

beforeEach(() => {
  delete process.env.ADMIN_JWT_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_ADMIN_PUBLIC_KEYS;
  delete process.env.JWT_PUBLIC_KEYS;
});

afterEach(() => {
  delete process.env.ADMIN_JWT_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_ADMIN_PUBLIC_KEYS;
  delete process.env.JWT_PUBLIC_KEYS;
});

describe('resolveAdminJwtVerification — HS256 (legacy admin sessions)', () => {
  it('resolves ADMIN_JWT_SECRET when it is configured', () => {
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.JWT_SECRET = SHARED_SECRET;

    expect(resolveAdminJwtVerification(signAdminHs())).toEqual({
      verifyKey: ADMIN_SECRET,
      algorithm: 'HS256',
    });
  });

  it('falls back to JWT_SECRET when ADMIN_JWT_SECRET is absent', () => {
    process.env.JWT_SECRET = SHARED_SECRET;

    expect(resolveAdminJwtVerification(signAdminHs())).toEqual({
      verifyKey: SHARED_SECRET,
      algorithm: 'HS256',
    });
  });

  it('fails closed when neither admin nor shared secret is configured', () => {
    expect(() => resolveAdminJwtVerification(signAdminHs())).toThrow(/not configured/i);
  });
});

describe('resolveAdminJwtVerification — RS256 (admin keyset)', () => {
  it('resolves the admin public key for a known kid', () => {
    process.env.JWT_ADMIN_PUBLIC_KEYS = JSON.stringify({ [KID]: adminPublicKey });

    expect(resolveAdminJwtVerification(signAdminRs())).toEqual({
      verifyKey: adminPublicKey,
      algorithm: 'RS256',
    });
  });

  it('rejects a kid that is not in the admin keyset', () => {
    process.env.JWT_ADMIN_PUBLIC_KEYS = JSON.stringify({ 'other-kid': adminPublicKey });

    expect(() => resolveAdminJwtVerification(signAdminRs())).toThrow(/kid/i);
  });

  it('rejects an RS256 token carrying no kid', () => {
    process.env.JWT_ADMIN_PUBLIC_KEYS = JSON.stringify({ [KID]: adminPublicKey });
    const noKid = jwt.sign(
      { sub: 'admin-1' },
      { privateKey: adminPrivateKey, algorithm: 'RS256', issuer: 'bidride-auth', audience: 'bidride-admin' },
    );

    expect(() => resolveAdminJwtVerification(noKid)).toThrow(/kid/i);
  });

  it('rejects RS256 when the admin keyset is absent entirely', () => {
    expect(() => resolveAdminJwtVerification(signAdminRs())).toThrow(/kid/i);
  });
});

describe('resolveAdminJwtVerification — trust-domain isolation', () => {
  it('never resolves a key from the user keyset, even on a matching kid', () => {
    // The kid the token names exists ONLY in the user keyset. Admitting it would
    // let a user-domain key authenticate an admin session.
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [KID]: userPublicKey });

    expect(() => resolveAdminJwtVerification(signAdminRs())).toThrow(/kid/i);
  });

  it('does not resolve a user-signed RS256 token when only the user keyset holds its kid', () => {
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [KID]: userPublicKey });
    const userSigned = signAdminRs({ privateKey: userPrivateKey });

    expect(() => resolveAdminJwtVerification(userSigned)).toThrow(/kid/i);
  });
});

describe('resolveAdminJwtVerification — unsupported algorithms', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.JWT_ADMIN_PUBLIC_KEYS = JSON.stringify({ [KID]: adminPublicKey });
  });

  it.each(['HS384', 'HS512'])('rejects %s', (algorithm) => {
    expect(() => resolveAdminJwtVerification(signAdminHs({ algorithm }))).toThrow(/unsupported/i);
  });

  it('rejects an alg:none token', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'admin-1' })}.`;

    expect(() => resolveAdminJwtVerification(none)).toThrow(/unsupported/i);
  });

  it('rejects a malformed token with no decodable header', () => {
    expect(() => resolveAdminJwtVerification('not-a-jwt')).toThrow(/unsupported/i);
  });
});

describe('parseAdminPublicKeys', () => {
  it('returns an empty keyset for undefined, so RS256 rejects without throwing at load', () => {
    expect(parseAdminPublicKeys(undefined)).toEqual({});
  });

  it('returns an empty keyset for malformed JSON rather than throwing', () => {
    expect(parseAdminPublicKeys('{not json')).toEqual({});
  });

  it('refuses private key material', () => {
    expect(parseAdminPublicKeys(JSON.stringify({ [KID]: adminPrivateKey }))).toEqual({});
  });

  it('refuses a value that is not an SPKI public key', () => {
    expect(parseAdminPublicKeys(JSON.stringify({ [KID]: 'just-a-string' }))).toEqual({});
  });

  it('accepts a well-formed keyset', () => {
    expect(parseAdminPublicKeys(JSON.stringify({ [KID]: adminPublicKey }))).toEqual({
      [KID]: adminPublicKey,
    });
  });
});
