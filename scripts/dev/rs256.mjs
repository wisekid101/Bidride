#!/usr/bin/env node
/**
 * BidRide — local RS256 developer workflow (Phase P1).  `pnpm dev:rs256`
 *
 * Generates an ephemeral RS256 keypair and prints the values needed to exercise
 * the FUTURE asymmetric-JWT path (B8C) locally, in the exact canonical keyset
 * schema documented in infrastructure/JWT_PUBLIC_KEY_RUNBOOK.md:
 *
 *     JWT_PUBLIC_KEYS = { "<kid>": "<SPKI public-key PEM>" }
 *
 * This does NOT implement RS256 verification (that is Phase P9 / B8C). It only
 * produces dev key material so that, once B8C lands, `pnpm dev:rs256` gives a
 * laptop a working local RS256 setup. Keys are ephemeral — never commit them.
 * Nothing here touches AWS or production.
 */
import { generateKeyPairSync } from 'node:crypto';

const kid = process.argv[2] || 'dev1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const keyset = JSON.stringify({ [kid]: publicKey });

console.log(`
# BidRide local RS256 dev material (kid=${kid}) — EPHEMERAL, do not commit.
# Add these to your .env to exercise the future RS256 path locally.

# Public keyset (what verifiers consume — canonical {kid: PEM} schema):
JWT_PUBLIC_KEYS='${keyset}'
JWT_ADMIN_PUBLIC_KEYS='${keyset}'

# Private key (local dev issuer only; in production auth/admin sign via KMS):
# store as a single line, e.g. JWT_DEV_PRIVATE_KEY, when B8C dev signing lands.
`);
console.log('----- BEGIN DEV PRIVATE KEY (ephemeral) -----');
console.log(privateKey.trim());
console.log('----- END DEV PRIVATE KEY (ephemeral) -----');
