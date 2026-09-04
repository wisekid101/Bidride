import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { assertSigningKeyMatchesKeyset, resolveJwtSigningConfig } from './jwt-signing.config';
import type { KmsSignerPort } from './kms-jwt-signer';

/**
 * SEC-RS256-B2 — admin-side issuance configuration and boot validation.
 *
 * The generic behaviour is covered in auth-service; what is specific here is that
 * the admin issuer validates against the ADMIN keyset. A key that exists only in
 * the user keyset must fail admin startup, or admin-service would sign sessions
 * with a key its own verifier cannot resolve.
 */

const KID = 'admin-v1';

const adminPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const userPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const kmsReturning = (pem: string): KmsSignerPort => ({
  signDigest: async () => new Uint8Array([1]),
  publicKeyDer: async () =>
    new Uint8Array(createPublicKey(pem).export({ type: 'spki', format: 'der' })),
});

describe('admin resolveJwtSigningConfig', () => {
  it('defaults to HS256 so admin sessions are unchanged on deploy', () => {
    expect(resolveJwtSigningConfig({})).toEqual({ algorithm: 'HS256' });
  });

  it('requires kid and key id before admin RS256 can be enabled', () => {
    expect(() => resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'RS256' })).toThrow(/JWT_SIGNING_KID/);
    expect(() =>
      resolveJwtSigningConfig({ JWT_SIGNING_ALG: 'RS256', JWT_SIGNING_KID: KID }),
    ).toThrow(/JWT_KMS_KEY_ID/);
  });
});

describe('admin boot validation — keyset domain separation', () => {
  it('passes when the KMS admin key matches the admin keyset entry', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(adminPair.publicKey),
        keysetRaw: JSON.stringify({ [KID]: adminPair.publicKey }),
      }),
    ).resolves.toBeUndefined();
  });

  it('fails startup when the admin signing key is only present in the USER keyset', async () => {
    // Simulates the operator putting the admin key in the wrong secret: the admin
    // keyset holds a different (user) key under the same kid.
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(adminPair.publicKey),
        keysetRaw: JSON.stringify({ [KID]: userPair.publicKey }),
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it('fails startup when the admin keyset was never populated', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: kmsReturning(adminPair.publicKey),
        keysetRaw: undefined,
      }),
    ).rejects.toThrow(/keyset/i);
  });

  it('fails startup when KMS cannot be reached', async () => {
    await expect(
      assertSigningKeyMatchesKeyset({
        kid: KID,
        kms: {
          signDigest: async () => new Uint8Array([1]),
          publicKeyDer: async () => {
            throw new Error('AccessDeniedException');
          },
        },
        keysetRaw: JSON.stringify({ [KID]: adminPair.publicKey }),
      }),
    ).rejects.toThrow(/AccessDeniedException|KMS/);
  });
});
