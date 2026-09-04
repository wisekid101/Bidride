import { KMSClient, SignCommand, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import type { KmsSignerPort } from './kms-jwt-signer';

/**
 * SEC-RS256-B2 — the only place the AWS SDK is touched for JWT signing.
 *
 * Kept as a thin adapter so KmsJwtSigner (and its tests) stay free of any AWS
 * dependency and never need the network. Credentials come from the ECS task role;
 * auth-service's role grants kms:Sign / kms:GetPublicKey on the user JWT key only
 * (infrastructure/terraform/ecs-services.tf).
 *
 * The private key never leaves KMS: we send a digest and receive a signature.
 */
export class AwsKmsSigner implements KmsSignerPort {
  private readonly client: KMSClient;

  constructor(
    private readonly keyId: string,
    client?: KMSClient,
  ) {
    this.client = client ?? new KMSClient({});
  }

  async signDigest(digest: Uint8Array): Promise<Uint8Array> {
    const res = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: digest,
        // The message we send IS the digest — KMS must not hash it again.
        MessageType: 'DIGEST',
        // The JWA "RS256" primitive.
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      }),
    );
    if (!res.Signature) throw new Error('kms:Sign returned no signature');
    return res.Signature;
  }

  async publicKeyDer(): Promise<Uint8Array> {
    const res = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!res.PublicKey) throw new Error('kms:GetPublicKey returned no key');
    return res.PublicKey;
  }
}
