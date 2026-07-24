// SB2A Phase 4A — Webhook security framework (reusable infrastructure only).
//
// Interfaces + pure utilities for a future signed tax-provider webhook. There is
// NO live endpoint in Phase 4A. The framework enforces: verify-signature-before-
// parse, providerEventId idempotency, redaction of any raw identifiers, a
// dead-letter contract, and a safe-logging contract that structurally excludes
// raw provider payloads.

// Verify the raw request signature BEFORE the body is parsed. Implementations
// return false on any failure (never throw the raw body).
export interface WebhookSignatureVerifier {
  verify(rawBody: string, headers: Record<string, string>): boolean;
}

// Extracts the provider event id used as the idempotency key (dedup on replay).
export interface ProviderEventIdentifier {
  extractEventId(rawBody: string): string | null;
}

// Where unverifiable / unprocessable webhooks go — never silently dropped, never
// auto-applied. Entries carry no raw payload or identifiers.
export interface DeadLetterEntry {
  providerEventId: string | null;
  reason: string; // sanitized
  receivedAt: Date;
}
export interface DeadLetterSink {
  deadLetter(entry: DeadLetterEntry): Promise<void>;
}

// ── Redaction ────────────────────────────────────────────────────────────────
// Redacts anything that looks like a US TIN/SSN/EIN/ITIN before any string is
// logged or surfaced. Defense-in-depth: the model stores no raw identifiers, but
// provider payloads must never be logged, so redaction guards accidental paths.
const REDACTED = '[REDACTED]';
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN/ITIN dashed
  /\b\d{2}-\d{7}\b/g, // EIN dashed
  /\b\d{9}\b/g, // any bare 9-digit run (SSN/EIN/ITIN undashed)
];

export function redactSensitive(input: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), input);
}

// ── Safe logging contract ────────────────────────────────────────────────────
// The ONLY shape permitted for logging a tax webhook. It structurally cannot
// carry a raw body or identifiers — only sanitized, allowlisted fields.
export interface SafeWebhookLog {
  providerEventId: string | null;
  normalizedStatus: string | null; // a NormalizedTaxStatus value, or null
  providerReference: string | null; // opaque
  outcome: 'accepted' | 'deduped' | 'rejected' | 'dead_lettered';
}

export function buildSafeWebhookLog(fields: SafeWebhookLog): SafeWebhookLog {
  // Explicit allowlist — never spreads an arbitrary payload.
  return {
    providerEventId: fields.providerEventId ?? null,
    normalizedStatus: fields.normalizedStatus ?? null,
    providerReference: fields.providerReference ?? null,
    outcome: fields.outcome,
  };
}
