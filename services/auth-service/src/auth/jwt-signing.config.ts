import { createPublicKey } from 'node:crypto';
import type { KmsSignerPort } from './kms-jwt-signer';

/**
 * SEC-RS256-B2 — issuance algorithm selection and boot validation.
 *
 * The default is HS256. Deploying this sprint must not change behaviour anywhere:
 * with JWT_SIGNING_ALG unset, issuance is byte-for-byte what it is today and this
 * module's RS256 path is never reached.
 *
 * Enabling RS256 (JWT_SIGNING_ALG=RS256) is deliberately strict. The dangerous
 * failure mode is a mismatched key pair — signing with a KMS key whose public half
 * is not the one verifiers hold under that kid. Nothing detects that at issue time:
 * every new token is silently unverifiable while existing tokens keep working, so
 * it presents as a slow outage tracking token expiry. assertSigningKeyMatchesKeyset
 * turns that into a failed deploy instead, which is the whole point of validating
 * at boot rather than trusting configuration.
 */

export type JwtSigningAlgorithm = 'HS256' | 'RS256';

export type JwtSigningConfig =
  | { algorithm: 'HS256' }
  | { algorithm: 'RS256'; kid: string; keyId: string };

/**
 * Read the signing configuration from an environment bag (injectable for tests).
 * Throws on RS256 with incomplete configuration, and on any algorithm we cannot
 * sign — never silently falls back, since a silent fallback is an algorithm
 * downgrade an operator would not notice.
 */
export function resolveJwtSigningConfig(
  env: Record<string, string | undefined> = process.env,
): JwtSigningConfig {
  const requested = env.JWT_SIGNING_ALG ?? 'HS256';

  if (requested === 'HS256') return { algorithm: 'HS256' };

  if (requested === 'RS256') {
    const kid = env.JWT_SIGNING_KID;
    const keyId = env.JWT_KMS_KEY_ID;
    if (!kid) throw new Error('JWT_SIGNING_ALG=RS256 requires JWT_SIGNING_KID');
    if (!keyId) throw new Error('JWT_SIGNING_ALG=RS256 requires JWT_KMS_KEY_ID');
    return { algorithm: 'RS256', kid, keyId };
  }

  throw new Error(
    `Unsupported JWT_SIGNING_ALG "${requested}" — only HS256 and RS256 can be issued`,
  );
}

/** DER (SPKI) → PEM, matching the shape the keyset stores (runbook §1). */
export function derToSpkiPem(der: Uint8Array): string {
  const body = Buffer.from(der).toString('base64');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/** Compare PEMs by key material, ignoring line endings and trailing whitespace. */
function normalizePem(pem: string): string {
  return pem.replace(/\s+/g, '');
}

/**
 * Boot guard: assert the KMS signing key's public half is exactly what verifiers
 * will look up under this kid. Throws — and therefore refuses startup — on a
 * missing keyset, a missing kid, a malformed entry, a mismatched pair, or any
 * KMS failure.
 */
export async function assertSigningKeyMatchesKeyset(args: {
  kid: string;
  kms: KmsSignerPort;
  keysetRaw: string | undefined;
}): Promise<void> {
  const { kid, kms, keysetRaw } = args;

  if (!keysetRaw) {
    throw new Error(
      `RS256 issuance is enabled but no public-key keyset is configured; cannot verify kid "${kid}"`,
    );
  }

  let keyset: unknown;
  try {
    keyset = JSON.parse(keysetRaw);
  } catch {
    throw new Error('RS256 issuance is enabled but the public-key keyset is not valid JSON');
  }
  if (!keyset || typeof keyset !== 'object' || Array.isArray(keyset)) {
    throw new Error('RS256 issuance is enabled but the public-key keyset is not a JSON object');
  }

  const configured = (keyset as Record<string, unknown>)[kid];
  if (typeof configured !== 'string' || !configured) {
    throw new Error(
      `RS256 issuance is enabled but the keyset has no public key for kid "${kid}"; ` +
        'populate the keyset before enabling RS256 (see JWT_PUBLIC_KEY_RUNBOOK.md)',
    );
  }

  // Normalising through createPublicKey also rejects a malformed keyset entry.
  let configuredPem: string;
  try {
    configuredPem = createPublicKey(configured)
      .export({ type: 'spki', format: 'pem' })
      .toString();
  } catch {
    throw new Error(`The keyset entry for kid "${kid}" is not a usable SPKI public key`);
  }

  let kmsPem: string;
  try {
    kmsPem = derToSpkiPem(await kms.publicKeyDer());
  } catch (err) {
    throw new Error(
      `Could not fetch the KMS public key for RS256 issuance: ${(err as Error).message}`,
    );
  }

  if (normalizePem(kmsPem) !== normalizePem(configuredPem)) {
    throw new Error(
      `The KMS signing key does not match the keyset entry for kid "${kid}". ` +
        'Tokens signed with this key would be rejected by every verifier — refusing to start.',
    );
  }
}
