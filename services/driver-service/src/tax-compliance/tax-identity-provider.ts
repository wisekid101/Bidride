// SB2A Phase 4A — TaxIdentityProvider contract (interface only; no adapter).
//
// Feeds the COMPLIANCE/activation side. Owns hosted-session lifecycle, applicable
// form determination, identity verification, status normalization, reconciliation
// and webhook ingestion. Its ONLY output into the rest of the system is a
// NormalizedTaxStatus — provider-specific values never leave the adapter.
//
// This phase defines the contract only. No Stripe, no external calls, no secrets.

import { NormalizedTaxStatus } from './normalized-tax-status';

export type TaxFormType = 'W9' | 'W8BEN' | 'W8BENE' | 'OTHER';

export interface HostedTaxSession {
  url: string; // short-lived / one-time
  sessionRef: string; // opaque provider reference
  expiresAt: Date;
}

export interface CreateHostedSessionInput {
  driverId: string;
  requiredFormType: TaxFormType;
  requiredVersion: string;
  taxYear: number;
  returnUrl: string;
}

// A verification snapshot pulled during reconciliation — already normalized and
// sanitized (no raw identifiers, no raw provider payloads).
export interface NormalizedVerificationState {
  status: NormalizedTaxStatus;
  providerReference: string; // opaque
  sanitizedReasonCode?: string | null;
}

// A parsed, signature-verified webhook event — sanitized. `providerEventId` is
// the idempotency key. `rawProviderStatus` is provider-internal and MUST be fed
// through the normalizer before use anywhere else.
export interface ParsedTaxWebhookEvent {
  providerEventId: string;
  providerReference: string;
  rawProviderStatus: string;
  occurredAt: Date;
}

export interface TaxIdentityProvider {
  readonly name: string; // 'stripe' | 'track1099' | ...
  createHostedSession(input: CreateHostedSessionInput): Promise<HostedTaxSession>;
  determineApplicableForm(input: { taxResidency?: string | null }): Promise<TaxFormType>;
  getVerificationState(providerReference: string): Promise<NormalizedVerificationState>;
  // Signature MUST be verified before the body is parsed.
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhookEvent(rawBody: string): ParsedTaxWebhookEvent;
  // Maps a provider-internal status string to the BidiRide manifest. The ONLY
  // place a provider status may be interpreted.
  normalizeStatus(rawProviderStatus: string): NormalizedTaxStatus;
}
