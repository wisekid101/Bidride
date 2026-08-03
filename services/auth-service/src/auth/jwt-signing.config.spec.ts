import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import {
  assertSigningKeyMatchesKeyset,
  derToSpkiPem,
  resolveJwtSigningConfig,
} from './jwt-signing.config';
import type { KmsSignerPort } from './kms-jwt-signer';

/**
 * SEC-RS256-B2 — issuance configuration and boot validation.
 *
 * The default MUST be HS256: merging this sprint may not change runtime
 * behaviour anywhere. RS256 is opt-in and, when opted into, must fail startup
 * rather than mint tokens no verifier can check — the mismatched-key-pair
 * failure mode is otherwise silent and only surfaces as a creeping outage as
 * old tokens expire.
 */

const KID = 'v1';

const signingPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const otherPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const derOf = (pem: string) =>
  new Uint8Array(createPublicKey(pem).export({ type: 'spki', format: 'der' }));

function kmsReturning(pem: string): KmsSignerPort {
  return {
    signDigest: async () => new Uint8Array([1]),
    publicKeyDer: async () => derOf(pem),
  };
}

describe('resolveJwtSigningConfig', () => {
  it('defaults to HS256 when JWT_SIGNING_ALG is unset', () => {
    expect(resolveJwtSigningConfig({})).toEqual({ algorithm: 'HS256' });
  });

  it('returns HS256 when explicitly configured', () => {
    expect(resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'HS256' })).toEqual({ algorithm: 'HS256' });
  });

  it('returns kid and keyId for RS256', () => {
    expect(
      resolveJwtSigningConfig({
        JWT_SIGNING_ALG: 'RS256',
        JWT_SIGNING_KID: KID,
        JWT_KMS_KEY_ID: 'alias/bidride-jwt-user-production',
      }),
    ).toEqual({
      algorithm: 'RS256',
      kid: KID,
      keyId: 'alias/bidride-jwt-user-production',
    });
  });

  it('fails closed when RS256 is requested without JWT_SIGNING_KID', () => {
    expect(() =>
      resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'RS256', JWT_KMS_KEY_ID: 'alias/k' }),
    ).toThrow(/JWT_SIGNING_KID/);
  });

  it('fails closed when RS256 is requested without JWT_KMS_KEY_ID', () => {
    expect(() =>
      resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'RS256', JWT_SIGNING_KID: KID }),
    ).toThrow(/JWT_KMS_KEY_ID/);
  });

  it('rejects an unsupported signing algorithm rather than silently defaulting', () => {
    expect(() => resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'RS512' })).toThrow(/RS512/);
  });

  it('ignores kid and keyId while HS256 is selected', () => {
    expect(
      resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'HS256', JWT_SIGNING_KID: KID }),
    ).toEqual({ algorithm: 'HS256' });
  });
});

describe('derToSpkiPem', () => {
  it('reproduces the same SPKI PEM node itself exports', () => {
    expect(derToSpkiPem(derOf(signingPair.publicKey)).replace(/\s+/g, '')).toBe(
      signingPair.publicKey.replace(/\s+/g, ''),
    );
  });

  it('emits a standard PEM envelope', () => {
    const pem = derToSpkiPem(derOf(signingPair.publicKey));
    expect(pem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    expect(pem.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true);
  });
});

describe('assertSigningKeyMatchesKeyset', () => {
  const keysetWith = (kid: string, pem: string) => JSON.stringify({ [kid]: pem });

  it('passes when the KMS public key matches the keyset entry for the kid', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(signingPair.publicKey),
        keysetRaw: keysetWith(KID, signingPair.publicKey),
      }),
    ).resolves.toBeUndefined();
  });

  it('tolerates line-ending and trailing-whitespace differences', async () => {
    const reflowed = signingPair.publicKey.replace(/\n/g, '\r\n') + '\n';
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(signingPair.publicKey),
        keysetRaw: keysetWith(KID, reflowed),
      }),
    ).resolves.toBeUndefined();
  });

  it('fails startup when the keyset is absent entirely', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(signingPair.publicKey),
        keysetRaw: undefined,
      }),
    ).rejects.toThrow(/keyset/i);
  });

  it('fails startup when the configured kid is missing from the keyset', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: 'v2',
        kms: kmsReturning(signingPair.publicKey),
        keysetRaw: keysetWith(KID, signingPair.publicKey),
      }),
    ).rejects.toThrow(/v2/);
  });

  it('fails startup on a mismatched key pair — the silent-outage failure mode', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(otherPair.publicKey),
        keysetRaw: keysetWith(KID, signingPair.publicKey),
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it('fails startup when KMS is unreachable', async () => {
    const brokenKms: KmsSignerPort = {
      signDigest: async () => new Uint8Array([1]),
      publicKeyDer: async () => {
        throw new Error('KMSInternalFailure');
      },
    };

    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: brokenKms,
        keysetRaw: keysetWith(KID, signingPair.publicKey),
      }),
    ).rejects.toThrow(/KMSInternalFailure|KMS/);
  });

  it('fails startup when the keyset holds a malformed value for the kid', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(signingPair.publicKey),
        keysetRaw: keysetWith(KID, 'not-a-pem'),
      }),
    ).rejects.toThrow();
  });
});
