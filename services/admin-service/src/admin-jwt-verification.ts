/**
 * SEC-RS256-B1 — admin-token verification key resolver (RS256 + legacy HS256).
 *
 * The admin trust domain is deliberately SEPARATE from the user domain. This
 * resolver is the admin counterpart of user-jwt-verification.ts:
 *
 *   user  domain → JWT_PUBLIC_KEYS       (audience 'bidride-user')
 *   admin domain → JWT_ADMIN_PUBLIC_KEYS (audience 'bidride-admin')
 *
 * The two keysets are separate secrets and MUST NOT share kid or key material
 * (infrastructure/JWT_PUBLIC_KEY_RUNBOOK.md §8). This resolver therefore reads
 * ONLY JWT_ADMIN_PUBLIC_KEYS: a user-domain key admitted here would let a rider
 * or driver token be replayed as an admin session, which is exactly the
 * cross-domain replay the 'bidride-admin' audience exists to prevent.
 *
 * HS256 keeps the ADMIN_JWT_SECRET→JWT_SECRET precedence that AdminAuthModule
 * already applies, so admin sessions issued before RS256 keep verifying.
 *
 * SECURITY — algorithm-confusion defense: the RS256 public key is, by
 * definition, public. This resolver maps the token-header `alg` STRICTLY to a
 * key source and never crosses them: HS256 verifies ONLY with the admin/shared
 * HMAC secret; RS256 verifies ONLY with a public PEM from the admin keyset.
 * There is no code path where a PEM becomes an HMAC secret.
 */

export type AdminJwtAlg = 'HS256' | 'RS256';

export interface AdminJwtVerification {
  /** secretOrPublicKey to hand to @nestjs/jwt: HMAC secret or SPKI PEM. */
  verifyKey: string;
  /** The single algorithm the resolved key may be used with. */
  algorithm: AdminJwtAlg;
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
 * Parse and sanitize the JWT_ADMIN_PUBLIC_KEYS keyset. Anything malformed yields
 * an empty keyset (RS256 then rejects; HS256 is unaffected) — never a throw, so a
 * bad keyset can't lock every admin out of the portal. Private key material is
 * refused outright.
 */
export function parseAdminPublicKeys(raw: string | undefined): Record<string, string> {
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
    // Refuse anything but an SPKI public key — a private key in the admin keyset
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

function loadAdminPublicKeys(): Record<string, string> {
  const raw = process.env.JWT_ADMIN_PUBLIC_KEYS;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedKeys = parseAdminPublicKeys(raw);
  }
  return cachedKeys;
}

/**
 * Resolve the verification key + algorithm for a raw admin session token.
 * Throws (⇒ verifier rejects the token) on any unsupported/unknown case:
 * no admin/shared secret configured, RS256 without a kid, an unknown kid,
 * alg:none, or any algorithm other than HS256/RS256.
 */
export function resolveAdminJwtVerification(rawJwt: string): AdminJwtVerification {
  const { alg, kid } = decodeHeader(rawJwt);

  if (alg === 'HS256') {
    // Mirrors AdminAuthModule's ADMIN_JWT_SECRET ?? JWT_SECRET precedence.
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('ADMIN_JWT_SECRET/JWT_SECRET is not configured'); // fail closed
    return { verifyKey: secret, algorithm: 'HS256' };
  }

  if (alg === 'RS256') {
    if (!kid) throw new Error('RS256 admin token is missing a kid');
    const pem = loadAdminPublicKeys()[kid];
    if (!pem) throw new Error(`No admin public key for kid "${kid}"`);
    return { verifyKey: pem, algorithm: 'RS256' };
  }

  throw new Error(`Unsupported admin JWT algorithm: ${alg ?? 'none'}`);
}
