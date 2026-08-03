import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import {
  parseUserPublicKeys,
  resolveUserJwtVerification,
} from './user-jwt-verification';

/**
 * B8C — proves the dual HS256/RS256 user-token verification contract:
 *  - HS256 tokens resolve to (and verify with) JWT_SECRET only
 *  - RS256 tokens resolve to (and verify with) the keyset public PEM by `kid`
 *  - unknown kid / missing kid / alg:none / foreign alg are rejected
 *  - the RS256→HS256 algorithm-confusion attack (public key used as HMAC
 *    secret) is defeated: the resolver never HMACs with a public key
 *  - a bad/absent keyset degrades to HS256-only, never a throw at parse
 *  - a missing JWT_SECRET fails closed on the HS256 path
 */

const HS_SECRET = 'b8c-test-secret';
const ISS = 'bidride-auth';
const AUD = 'bidride-user';

// A stable RS256 keypair + kid for the suite.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const KID = 'v1';

const signer = new JwtService({});
const signHs256 = (secret: string) =>
  signer.sign({ sub: 'u', role: 'rider' }, { secret, issuer: ISS, audience: AUD, expiresIn: '15m' });
const signRs256 = (kid?: string) =>
  signer.sign(
    { sub: 'u', role: 'rider' },
    {
      privateKey,
      algorithm: 'RS256',
      ...(kid ? { keyid: kid } : {}), // jsonwebtoken rejects keyid:undefined; omit for the no-kid case
      issuer: ISS,
      audience: AUD,
      expiresIn: '15m',
    },
  );

/** End-to-end: resolve then actually verify, exactly as a verifier would. */
const verifyWithResolver = (token: string) => {
  const { verifyKey, algorithm } = resolveUserJwtVerification(token);
  return signer.verify(token, { secret: verifyKey, algorithms: [algorithm], issuer: ISS, audience: AUD });
};

describe('B8C — resolveUserJwtVerification', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = HS_SECRET;
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [KID]: publicKey });
  });
  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_PUBLIC_KEYS;
  });

  it('resolves a legacy HS256 token to JWT_SECRET and verifies it', () => {
    const token = signHs256(HS_SECRET);
    const { verifyKey, algorithm } = resolveUserJwtVerification(token);
    expect(algorithm).toBe('HS256');
    expect(verifyKey).toBe(HS_SECRET);
    const decoded: any = verifyWithResolver(token);
    expect(decoded.sub).toBe('u');
  });

  it('resolves an RS256 token by kid to the keyset public PEM and verifies it', () => {
    const token = signRs256(KID);
    const { verifyKey, algorithm } = resolveUserJwtVerification(token);
    expect(algorithm).toBe('RS256');
    expect(verifyKey).toBe(publicKey);
    const decoded: any = verifyWithResolver(token);
    expect(decoded.sub).toBe('u');
  });

  it('rejects an RS256 token whose kid is not in the keyset', () => {
    const token = signRs256('v2-unknown');
    expect(() => resolveUserJwtVerification(token)).toThrow(/kid/i);
  });

  it('rejects an RS256 token with no kid header', () => {
    const token = signRs256(undefined);
    expect(() => resolveUserJwtVerification(token)).toThrow(/kid/i);
  });

  it('rejects an unsigned alg:none token', () => {
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u', iss: ISS, aud: AUD })}.`;
    expect(() => resolveUserJwtVerification(none)).toThrow(/algorithm/i);
  });

  it('rejects a foreign algorithm (HS512)', () => {
    const token = signer.sign({ sub: 'u' }, { secret: HS_SECRET, algorithm: 'HS512', issuer: ISS, audience: AUD });
    expect(() => resolveUserJwtVerification(token)).toThrow(/algorithm/i);
  });

  it('defeats the RS256→HS256 confusion attack (public key forged as HMAC secret)', () => {
    // Attacker signs an HS256 token using the PUBLIC key PEM as the HMAC secret.
    const forged = signHs256(publicKey);
    // The resolver must map HS256 to the real JWT_SECRET, never to the public key.
    const { verifyKey, algorithm } = resolveUserJwtVerification(forged);
    expect(algorithm).toBe('HS256');
    expect(verifyKey).toBe(HS_SECRET);
    expect(verifyKey).not.toBe(publicKey);
    // ...so verifying with the resolved key fails: the forgery is rejected.
    expect(() => verifyWithResolver(forged)).toThrow();
  });

  it('fails closed on the HS256 path when JWT_SECRET is absent', () => {
    delete process.env.JWT_SECRET;
    const token = signHs256(HS_SECRET);
    expect(() => resolveUserJwtVerification(token)).toThrow(/JWT_SECRET/);
  });

  it('degrades to HS256-only (RS256 rejected) when the keyset is absent', () => {
    delete process.env.JWT_PUBLIC_KEYS;
    expect(() => verifyWithResolver(signHs256(HS_SECRET))).not.toThrow();
    expect(() => resolveUserJwtVerification(signRs256(KID))).toThrow(/kid/i);
  });
});

describe('B8C — parseUserPublicKeys sanitization', () => {
  it('returns an empty keyset for undefined/malformed/array input', () => {
    expect(parseUserPublicKeys(undefined)).toEqual({});
    expect(parseUserPublicKeys('not json')).toEqual({});
    expect(parseUserPublicKeys('["a","b"]')).toEqual({});
  });

  it('excludes private-key material and non-PEM values, keeps valid public PEMs', () => {
    const keyset = parseUserPublicKeys(
      JSON.stringify({
        good: publicKey,
        priv: privateKey, // contains "PRIVATE KEY" — must be refused
        junk: 'not-a-pem',
      }),
    );
    expect(keyset.good).toBe(publicKey);
    expect(keyset.priv).toBeUndefined();
    expect(keyset.junk).toBeUndefined();
  });
});
