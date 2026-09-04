import { Logger, type Provider } from '@nestjs/common';
import { KmsJwtSigner } from './kms-jwt-signer';
import { AwsKmsSigner } from './aws-kms-signer';
import { assertSigningKeyMatchesKeyset, resolveJwtSigningConfig } from './jwt-signing.config';

/** DI token for the optional RS256 signer. Absent/null ⇒ issuance stays HS256. */
export const JWT_RSA_SIGNER = 'JWT_RSA_SIGNER';

/**
 * SEC-RS256-B2 — builds the RS256 signer, or resolves to null so TokenService
 * keeps using HS256.
 *
 * Boot validation runs HERE, inside the factory, so a misconfigured RS256 rollout
 * fails module initialisation — the service never starts and never issues a token
 * no verifier can check. With JWT_SIGNING_ALG unset this factory returns null
 * immediately and never contacts AWS, which is what keeps the default deployment
 * behaviourally identical to today.
 */
export const jwtRsaSignerProvider: Provider = {
  provide: JWT_RSA_SIGNER,
  useFactory: async (): Promise<KmsJwtSigner | null> => {
    const logger = new Logger('JwtSigning');
    const config = resolveJwtSigningConfig();

    if (config.algorithm === 'HS256') {
      logger.log('JWT issuance algorithm: HS256 (RS256 not enabled)');
      return null;
    }

    const kms = new AwsKmsSigner(config.keyId);
    await assertSigningKeyMatchesKeyset({
      kid: config.kid,
      kms,
      keysetRaw: process.env.JWT_PUBLIC_KEYS,
    });

    logger.log(`JWT issuance algorithm: RS256 (kid=${config.kid}, KMS key verified against keyset)`);
    return new KmsJwtSigner(kms, config.kid);
  },
};
