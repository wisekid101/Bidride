import {
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  privateEncrypt,
} from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { KmsJwtSigner, type KmsSignerPort } from './kms-jwt-signer';
import { resolveUserJwtVerification } from './user-jwt-verification';

/**
 * SEC-RS256-B2 — the KMS-backed RS256 JWT assembler.
 *
 * AWS is never contacted: KmsJwtSigner depends on the narrow KmsSignerPort, and
 * these tests supply a fake that signs with a locally generated key. That keeps
 * the suite offline while still producing REAL RSA signatures, so the round-trip
 * test below genuinely proves an issued token verifies through the untouched
 * SEC-RS256-A resolver.
 */

const KID = 'v1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/**
 * DER DigestInfo prefix for SHA-256, per RFC 8017 §9.2. RSASSA-PKCS1-v1_5 signs
 * DigestInfo(OID, digest) — not the bare digest — and KMS applies this wrapper
 * internally when MessageType=DIGEST. The fake must do the same or the signature
 * it produces would not be a valid RS256 signature.
 */
const SHA256_DIGEST_INFO_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex');

/** Signs exactly as kms:Sign(MessageType=DIGEST, RSASSA_PKCS1_V1_5_SHA_256) would. */
function kmsEquivalentSign(digest: Uint8Array): Uint8Array {
  return new Uint8Array(
    privateEncrypt(
      { key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.concat([SHA256_DIGEST_INFO_PREFIX, Buffer.from(digest)]),
    ),
  );
}

/** Fake KMS: real RSA signatures from a local key, zero network. */
function fakeKms(overrides: Partial<KmsSignerPort> = {}): KmsSignerPort {
  return {
    signDigest: async (digest: Uint8Array) => kmsEquivalentSign(digest),
    publicKeyDer: async () =>
      new Uint8Array(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })),
    ...overrides,
  };
}

const OPTS = { issuer: 'bidride-auth', audience: 'bidride-user', expiresInSeconds: 900 };

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('KmsJwtSigner — header', () => {
  it('stamps alg RS256, typ JWT and the configured kid', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign({ sub: 'user-1', role: 'rider' }, OPTS);

    expect(decodeSegment(token.split('.')[0])).toEqual({ alg: 'RS256', typ: 'JWT', kid: KID });
  });

  it('produces a three-segment compact JWS', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign({ sub: 'user-1' }, OPTS);

    expect(token.split('.')).toHaveLength(3);
    expect(token.split('.')[2].length).toBeGreaterThan(0);
  });
});

describe('KmsJwtSigner — claims', () => {
  it('preserves every caller claim and stamps iss, aud, iat and exp', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign(
      { sub: 'user-1', role: 'rider', jti: 'jti-abc' },
      OPTS,
    );
    const payload = decodeSegment(token.split('.')[1]);

    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('rider');
    expect(payload.jti).toBe('jti-abc');
    expect(payload.iss).toBe('bidride-auth');
    expect(payload.aud).toBe('bidride-user');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp).toBe((payload.iat as number) + 900);
  });

  it('honours a different expiry window', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign(
      { sub: 'admin-1' },
      { issuer: 'bidride-auth', audience: 'bidride-admin', expiresInSeconds: 28800 },
    );
    const payload = decodeSegment(token.split('.')[1]);

    expect(payload.exp).toBe((payload.iat as number) + 28800);
    expect(payload.aud).toBe('bidride-admin');
  });

  it('never places key material or a secret in the token', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign({ sub: 'user-1' }, OPTS);
    const payload = JSON.stringify(decodeSegment(token.split('.')[1]));

    expect(payload).not.toMatch(/PRIVATE KEY/);
    expect(payload).not.toMatch(/BEGIN/);
    expect(payload).not.toHaveProperty('secret');
  });
});

describe('KmsJwtSigner — signing input', () => {
  it('asks KMS to sign the SHA-256 digest of exactly "header.payload"', async () => {
    const seen: Uint8Array[] = [];
    const kms = fakeKms({
      signDigest: async (digest) => {
        seen.push(digest);
        return kmsEquivalentSign(digest);
      },
    });

    const token = await new KmsJwtSigner(kms, KID).sign({ sub: 'user-1' }, OPTS);

    const [header, payload] = token.split('.');
    const expected = createHash('sha256').update(`${header}.${payload}`).digest();
    expect(seen).toHaveLength(1);
    expect(Buffer.from(seen[0])).toEqual(expected);
  });
});

describe('KmsJwtSigner — RS256 round trip through the real resolver', () => {
  const jwt = new JwtService({});

  beforeEach(() => {
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [KID]: publicKey });
    process.env.JWT_SECRET = 'round-trip-hs-secret';
  });

  afterEach(() => {
    delete process.env.JWT_PUBLIC_KEYS;
    delete process.env.JWT_SECRET;
  });

  it('issues a token the SEC-RS256-A resolver accepts and jwt.verify validates', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign(
      { sub: 'user-1', role: 'rider', jti: 'jti-abc' },
      OPTS,
    );

    // The resolver picks the key by the header kid — the issuance/verification contract.
    const { verifyKey, algorithm } = resolveUserJwtVerification(token);
    expect(algorithm).toBe('RS256');
    expect(verifyKey).toBe(publicKey);

    const verified = jwt.verify(token, {
      secret: verifyKey,
      algorithms: [algorithm],
      issuer: 'bidride-auth',
      audience: 'bidride-user',
    }) as Record<string, unknown>;

    expect(verified.sub).toBe('user-1');
    expect(verified.role).toBe('rider');
    expect(verified.jti).toBe('jti-abc');
  });

  it('produces a token that fails verification if the signature is tampered with', async () => {
    const token = await new KmsJwtSigner(fakeKms(), KID).sign({ sub: 'user-1' }, OPTS);
    const [h, p] = token.split('.');
    const forged = `${h}.${p}.${Buffer.from('nope').toString('base64url')}`;

    const { verifyKey, algorithm } = resolveUserJwtVerification(forged);
    expect(() =>
      jwt.verify(forged, { secret: verifyKey, algorithms: [algorithm], issuer: 'bidride-auth', audience: 'bidride-user' }),
    ).toThrow();
  });

  it('is rejected when the issued kid is absent from the keyset', async () => {
    const token = await new KmsJwtSigner(fakeKms(), 'not-in-keyset').sign({ sub: 'user-1' }, OPTS);

    expect(() => resolveUserJwtVerification(token)).toThrow(/kid/i);
  });
});

describe('KmsJwtSigner — failure handling', () => {
  it('propagates a KMS signing failure instead of downgrading to HS256', async () => {
    const kms = fakeKms({
      signDigest: async () => {
        throw new Error('KMSInternalFailure');
      },
    });

    await expect(new KmsJwtSigner(kms, KID).sign({ sub: 'user-1' }, OPTS)).rejects.toThrow(
      /KMSInternalFailure/,
    );
  });

  it('rejects when KMS returns an empty signature rather than emitting an unsigned token', async () => {
    const kms = fakeKms({ signDigest: async () => new Uint8Array() });

    await expect(new KmsJwtSigner(kms, KID).sign({ sub: 'user-1' }, OPTS)).rejects.toThrow(
      /signature/i,
    );
  });

  it('refuses to construct without a kid, so no token can ever ship without one', () => {
    expect(() => new KmsJwtSigner(fakeKms(), '')).toThrow(/kid/i);
  });
});
