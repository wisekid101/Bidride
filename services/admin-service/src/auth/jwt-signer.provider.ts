import { Logger, type Provider } from '@nestjs/common';
import { KmsJwtSigner } from './kms-jwt-signer';
import { AwsKmsSigner } from './aws-kms-signer';
import { assertSigningKeyMatchesKeyset, resolveJwtSigningConfig } from './jwt-signing.config';

/** DI token for the optional RS256 admin-session signer. Absent/null ⇒ HS256. */
export const ADMIN_JWT_RSA_SIGNER = 'ADMIN_JWT_RSA_SIGNER';

/**
 * SEC-RS256-B2 — builds the RS256 signer for ADMIN SESSION tokens, or resolves to
 * null so AdminAuthService keeps issuing HS256.
 *
 * Boot validation runs here against JWT_ADMIN_PUBLIC_KEYS — the admin keyset, never
 * the user keyset — so a key placed in the wrong domain fails startup instead of
 * producing sessions no verifier accepts.
 *
 * SCOPE NOTE: this signer covers the 'bidride-admin' session token only. The two
 * other tokens admin-service mints (the WebSocket token in admin-auth.controller.ts
 * and the driver-service forwarding token in drivers-admin.service.ts) carry the
 * 'bidride-user' audience and are therefore verified against the USER keyset.
 * admin-service holds kms:Sign on the ADMIN key only, and the two keysets must not
 * share a kid, so signing those with this key would make them unverifiable. They
 * stay HS256 until they are re-homed behind auth-service.
 */
export const adminJwtRsaSignerProvider: Provider = {
  provide: ADMIN_JWT_RSA_SIGNER,
  useFactory: async (): Promise<KmsJwtSigner | null> => {
    const logger = new Logger('AdminJwtSigning');
    const config = resolveJwtSigningConfig();

    if (config.algorithm === 'HS256') {
      logger.log('Admin session issuance algorithm: HS256 (RS256 not enabled)');
      return null;
    }

    const kms = new AwsKmsSigner(config.keyId);
    await assertSigningKeyMatchesKeyset({
      kid: config.kid,
      kms,
      keysetRaw: process.env.JWT_ADMIN_PUBLIC_KEYS,
    });

    logger.log(
      `Admin session issuance algorithm: RS256 (kid=${config.kid}, KMS key verified against admin keyset)`,
    );
    return new KmsJwtSigner(kms, config.kid);
  },
};
