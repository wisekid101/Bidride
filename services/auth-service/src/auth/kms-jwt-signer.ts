import { createHash } from 'node:crypto';

/**
 * SEC-RS256-B2 — RS256 JWT issuance backed by AWS KMS.
 *
 * The signing private key lives in KMS and is never exported, never written to
 * disk, and never held in process memory (infrastructure/JWT_PUBLIC_KEY_RUNBOOK.md
 * §8). That rules out @nestjs/jwt for the RS256 path — it requires the key
 * material in-process — so this class assembles the compact JWS itself and
 * delegates only the signature to KMS.
 *
 * KmsSignerPort is a deliberately narrow seam: the JWT assembly logic below has
 * no AWS SDK dependency, so it is unit-testable offline with a fake that signs
 * using a local key. The concrete AWS adapter is aws-kms-signer.ts.
 *
 * HS256 issuance is untouched and still flows through @nestjs/jwt — this class
 * is only reached when JWT_SIGNING_ALG=RS256.
 */

/** The only two KMS operations issuance needs. */
export interface KmsSignerPort {
  /**
   * Sign a pre-computed SHA-256 digest with RSASSA_PKCS1_V1_5_SHA_256.
   * Corresponds to kms:Sign with MessageType=DIGEST.
   */
  signDigest(digest: Uint8Array): Promise<Uint8Array>;
  /** The signing key's public half, DER (SPKI). Corresponds to kms:GetPublicKey. */
  publicKeyDer(): Promise<Uint8Array>;
}

export interface JwtSignOptions {
  issuer: string;
  audience: string;
  expiresInSeconds: number;
}

function b64url(value: object | Uint8Array): string {
  const buf =
    value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(JSON.stringify(value), 'utf8');
  return buf.toString('base64url');
}

export class KmsJwtSigner {
  constructor(
    private readonly kms: KmsSignerPort,
    private readonly kid: string,
  ) {
    // A token without a kid is unverifiable: the resolver rejects RS256 with no
    // kid. Fail at construction rather than minting dead tokens at runtime.
    if (!kid) throw new Error('KmsJwtSigner requires a non-empty kid');
  }

  /**
   * Assemble and sign an RS256 JWT. Claim stamping mirrors what @nestjs/jwt does
   * on the HS256 path (iss/aud from options, iat now, exp = iat + ttl) so a token
   * is indistinguishable from today's apart from its algorithm and kid.
   */
  async sign(claims: Record<string, unknown>, opts: JwtSignOptions): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: this.kid };
    const payload = {
      ...claims,
      iss: opts.issuer,
      aud: opts.audience,
      iat,
      exp: iat + opts.expiresInSeconds,
    };

    const signingInput = `${b64url(header)}.${b64url(payload)}`;
    const digest = createHash('sha256').update(signingInput).digest();

    // Any KMS failure propagates. There is deliberately NO fallback to HS256:
    // a verifier-visible algorithm downgrade triggered by making KMS fail would
    // be an attack primitive, so unavailable KMS means no token is issued.
    const signature = await this.kms.signDigest(digest);
    if (!signature || signature.length === 0) {
      throw new Error('KMS returned an empty signature; refusing to emit an unsigned token');
    }

    return `${signingInput}.${b64url(signature)}`;
  }
}
