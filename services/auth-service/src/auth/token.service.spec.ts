import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@bidride/database/generated/client';
import { TokenService } from './token.service';
import { KmsJwtSigner, type KmsSignerPort } from './kms-jwt-signer';
import { resolveUserJwtVerification } from './user-jwt-verification';

/**
 * SEC-RS256-B2 — issuance wiring.
 *
 * Two contracts are under test and both matter equally:
 *   1. With no RS256 signer injected (the default, and what deploying this sprint
 *      produces), issuance is byte-for-byte today's HS256 behaviour.
 *   2. With a signer injected, the access token is RS256 while EVERY other aspect
 *      — claims, issuer, audience, expiry, and the opaque Redis refresh token —
 *      is unchanged.
 */

const KID = 'v1';
const SHA256_DIGEST_INFO_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function makeKms(): KmsSignerPort {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { constants, privateEncrypt } = require('node:crypto');
  return {
    signDigest: async (digest: Uint8Array) =>
      new Uint8Array(
        privateEncrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
          Buffer.concat([SHA256_DIGEST_INFO_PREFIX, Buffer.from(digest)]),
        ),
      ),
    publicKeyDer: async () =>
      new Uint8Array(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })),
  };
}

const makeRedis = () => ({
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(JSON.stringify({ jti: 'old-jti', role: 'rider' })),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
});

const makeConfig = () => ({ get: jest.fn(), getOrThrow: jest.fn() });

/** HS256 path: a real JwtService with the module's real signOptions. */
const hsJwt = () => new JwtService({ secret: 'token-service-test-secret', signOptions: { expiresIn: '15m' } });

describe('TokenService — HS256 (default, unchanged behaviour)', () => {
  it('issues an HS256 access token with the existing claims, issuer and audience', async () => {
    const jwt = hsJwt();
    const redis = makeRedis();
    const service = new TokenService(jwt as any, makeConfig() as any, redis as any);

    const { accessToken } = await service.issueTokenPair('user-1', 'rider' as UserRole);

    const header = JSON.parse(Buffer.from(accessToken.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
    expect(header.kid).toBeUndefined();

    const payload = jwt.verify(accessToken, {
      secret: 'token-service-test-secret',
      issuer: 'bidride-auth',
      audience: 'bidride-user',
    }) as Record<string, unknown>;
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('rider');
    expect(typeof payload.jti).toBe('string');
    expect(payload.exp).toBe((payload.iat as number) + 900);
  });

  it('stores an opaque refresh token in Redis with the 30-day TTL', async () => {
    const redis = makeRedis();
    const service = new TokenService(hsJwt() as any, makeConfig() as any, redis as any);

    const { refreshToken } = await service.issueTokenPair('user-1', 'rider' as UserRole);

    // Opaque UUID, never a JWT.
    expect(refreshToken.split('.')).toHaveLength(1);
    expect(redis.setex).toHaveBeenCalledWith(
      `refresh:user-1:${refreshToken}`,
      30 * 24 * 60 * 60,
      expect.any(String),
    );
  });
});

describe('TokenService — RS256 (signer injected)', () => {
  const build = () => {
    const jwt = hsJwt();
    jest.spyOn(jwt, 'sign');
    const redis = makeRedis();
    const signer = new KmsJwtSigner(makeKms(), KID);
    const service = new TokenService(jwt as any, makeConfig() as any, redis as any, signer);
    return { service, jwt, redis };
  };

  beforeEach(() => {
    process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [KID]: publicKey });
  });

  afterEach(() => {
    delete process.env.JWT_PUBLIC_KEYS;
    jest.restoreAllMocks();
  });

  it('issues an RS256 access token carrying the kid', async () => {
    const { service } = build();

    const { accessToken } = await service.issueTokenPair('user-1', 'rider' as UserRole);

    const header = JSON.parse(Buffer.from(accessToken.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(KID);
  });

  it('preserves every claim, the issuer, the audience and the 15-minute expiry', async () => {
    const { service } = build();

    const { accessToken } = await service.issueTokenPair('user-1', 'driver' as UserRole);

    const { verifyKey, algorithm } = resolveUserJwtVerification(accessToken);
    const payload = new JwtService({}).verify(accessToken, {
      secret: verifyKey,
      algorithms: [algorithm],
      issuer: 'bidride-auth',
      audience: 'bidride-user',
    }) as Record<string, unknown>;

    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('driver');
    expect(typeof payload.jti).toBe('string');
    expect(payload.exp).toBe((payload.iat as number) + 900);
  });

  it('does not use the HS256 JwtService signer at all', async () => {
    const { service, jwt } = build();

    await service.issueTokenPair('user-1', 'rider' as UserRole);

    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('leaves refresh-token behaviour untouched', async () => {
    const { service, redis } = build();

    const { refreshToken } = await service.issueTokenPair('user-1', 'rider' as UserRole);

    expect(refreshToken.split('.')).toHaveLength(1);
    expect(redis.setex).toHaveBeenCalledWith(
      `refresh:user-1:${refreshToken}`,
      30 * 24 * 60 * 60,
      expect.any(String),
    );
  });

  it('rotates into a fresh RS256 pair, revoking the old refresh key', async () => {
    const { service, redis } = build();

    const rotated = await service.rotateTokenPair('user-1', 'incoming-refresh');

    expect(redis.del).toHaveBeenCalledWith('refresh:user-1:incoming-refresh');
    const header = JSON.parse(Buffer.from(rotated.accessToken.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('RS256');
  });

  it('propagates a KMS failure instead of falling back to HS256', async () => {
    const jwt = hsJwt();
    jest.spyOn(jwt, 'sign');
    const brokenSigner = new KmsJwtSigner(
      { signDigest: async () => { throw new Error('KMSInternalFailure'); }, publicKeyDer: async () => new Uint8Array() },
      KID,
    );
    const service = new TokenService(jwt as any, makeConfig() as any, makeRedis() as any, brokenSigner);

    await expect(service.issueTokenPair('user-1', 'rider' as UserRole)).rejects.toThrow(
      /KMSInternalFailure/,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
