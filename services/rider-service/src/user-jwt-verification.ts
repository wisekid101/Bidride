/**
 * B8C — user-token verification key resolver (RS256 + legacy HS256).
 *
 * During the asymmetric-JWT migration every user-facing verifier must accept
 * BOTH the legacy HS256 access token (signed with JWT_SECRET) and the new
 * RS256 access token (KMS-signed in prod; verified with a public key from the
 * JWT_PUBLIC_KEYS keyset). The issuer still stamps HS256 today (token.service),
 * so RS256 is dormant until issuance flips — but the verify side trusts both now
 * so no token is ever rejected during the flip.
 *
 * Keyset schema (canonical — see infrastructure/JWT_PUBLIC_KEY_RUNBOOK.md):
 *   JWT_PUBLIC_KEYS = '{ "<kid>": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n" }'
 *
 * SECURITY — algorithm-confusion defense: the RS256 public key is, by
 * definition, public. If a verifier could ever be coerced into HMAC-verifying
 * with that public key as the secret, an attacker could forge tokens. This
 * resolver maps the token-header `alg` STRICTLY to a key source and never
 * crosses them: HS256 verifies ONLY with JWT_SECRET; RS256 verifies ONLY with a
 * public PEM. There is no code path where a PEM becomes an HMAC secret, or the
 * HMAC secret verifies an RS256 token.
 */

export type UserJwtAlg = 'HS256' | 'RS256';

export interface UserJwtVerification {
  /** secretOrPublicKey to hand to jsonwebtoken/@nestjs/jwt: HMAC secret or SPKI PEM. */
  verifyKey: string;
  /** The single algorithm the resolved key may be used with. */
  algorithm: UserJwtAlg;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

/** Decode a JWT header segment without verifying (dependency-free base64url). */
function decodeHeader(rawJwt: string): JwtHeader {
  const segment = typeof rawJwt === 'string' ? rawJwt.split('.')[0] : '';
  if (!segment) return {};
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as JwtHeader;
  } catch {
    return {};
  }
}

/**
 * Parse and sanitize the JWT_PUBLIC_KEYS keyset. Anything malformed yields an
 * empty keyset (RS256 then rejects; HS256 is unaffected) — never a throw, so a
 * bad keyset can't take verifiers down. Private key material is refused outright.
 */
export function parseUserPublicKeys(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const keyset: Record<string, string> = {};
  for (const [kid, pem] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof pem !== 'string') continue;
    // Refuse anything but an SPKI public key — a private key in the user keyset
    // is a misconfiguration we must never trust.
    if (pem.includes('PRIVATE KEY')) continue;
    if (!pem.includes('BEGIN PUBLIC KEY')) continue;
    keyset[kid] = pem;
  }
  return keyset;
}

// Cache the parsed keyset keyed on the raw env string so repeated verifications
// don't re-parse, while a changed env value (tests, rotation reload) re-parses.
let cachedRaw: string | undefined;
let cachedKeys: Record<string, string> = {};

function loadPublicKeys(): Record<string, string> {
  const raw = process.env.JWT_PUBLIC_KEYS;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedKeys = parseUserPublicKeys(raw);
  }
  return cachedKeys;
}

/**
 * Resolve the verification key + algorithm for a raw user access token.
 * Throws (⇒ verifier rejects the token) on any unsupported/unknown case:
 * missing/absent JWT_SECRET, RS256 without a kid, an unknown kid, alg:none,
 * or any algorithm other than HS256/RS256.
 */
export function resolveUserJwtVerification(rawJwt: string): UserJwtVerification {
  const { alg, kid } = decodeHeader(rawJwt);

  if (alg === 'HS256') {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured'); // fail closed
    return { verifyKey: secret, algorithm: 'HS256' };
  }

  if (alg === 'RS256') {
    if (!kid) throw new Error('RS256 token is missing a kid');
    const pem = loadPublicKeys()[kid];
    if (!pem) throw new Error(`No public key for kid "${kid}"`);
    return { verifyKey: pem, algorithm: 'RS256' };
  }

  throw new Error(`Unsupported JWT algorithm: ${alg ?? 'none'}`);
}
