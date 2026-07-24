// SB2A Phase 4A — Tax Compliance foundation.
//
// The NormalizedTaxStatus manifest is the ONLY tax-status language used inside
// BidiRide. Provider-specific status strings must be mapped to one of these
// values by a provider adapter's normalizer and must NEVER leave that adapter
// (never reach the Compliance Engine, DriverActivationService, Admin, or Mobile).
//
// Enum members use the founder manifest names (UPPER_SNAKE); the string values
// are lower_snake to match the codebase's other status enums and the sanitized
// missing-key convention (e.g. `w9:not_started`).
export enum NormalizedTaxStatus {
  NOT_STARTED = 'not_started',
  SESSION_CREATED = 'session_created',
  PENDING_PROVIDER = 'pending_provider',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  NEEDS_UPDATE = 'needs_update',
  PROVIDER_CONFIRMED_EXEMPT = 'provider_confirmed_exempt',
  UNAVAILABLE = 'unavailable',
  SUPERSEDED = 'superseded',
}

export const ALL_NORMALIZED_TAX_STATUSES: readonly NormalizedTaxStatus[] =
  Object.values(NormalizedTaxStatus);

// The ONLY statuses that satisfy a tax-compliance requirement. Both require
// provider confirmation — a client/admin can never reach them (see the state
// machine). This is NOT wired into activation in Phase 4A (foundation only).
export const PASSING_TAX_STATUSES: readonly NormalizedTaxStatus[] = [
  NormalizedTaxStatus.VERIFIED,
  NormalizedTaxStatus.PROVIDER_CONFIRMED_EXEMPT,
] as const;

export function isPassingTaxStatus(status: NormalizedTaxStatus): boolean {
  return PASSING_TAX_STATUSES.includes(status);
}

// Sanitized, BidiRide-owned blocking keys (never raw provider statuses/errors).
// Used by a future W9Requirement (Phase 4C) — defined here so the manifest owns
// the full status language. Passing statuses have no key.
const BLOCKING_MISSING_KEYS: Readonly<Record<NormalizedTaxStatus, string | null>> = {
  [NormalizedTaxStatus.VERIFIED]: null,
  [NormalizedTaxStatus.PROVIDER_CONFIRMED_EXEMPT]: null,
  [NormalizedTaxStatus.NOT_STARTED]: 'w9:not_started',
  [NormalizedTaxStatus.SESSION_CREATED]: 'w9:not_started',
  [NormalizedTaxStatus.PENDING_PROVIDER]: 'w9:pending',
  [NormalizedTaxStatus.REJECTED]: 'w9:rejected',
  [NormalizedTaxStatus.NEEDS_UPDATE]: 'w9:needs_update',
  [NormalizedTaxStatus.SUPERSEDED]: 'w9:needs_update',
  [NormalizedTaxStatus.UNAVAILABLE]: 'w9:provider_unavailable',
};

// Returns the sanitized blocking key for a status, or null if it passes.
export function missingKeyForTaxStatus(status: NormalizedTaxStatus): string | null {
  return BLOCKING_MISSING_KEYS[status];
}

// Type guard: is an arbitrary value a valid normalized status? Used as a defense
// so a provider-specific string can never masquerade as a normalized one.
export function isNormalizedTaxStatus(value: unknown): value is NormalizedTaxStatus {
  return (
    typeof value === 'string' &&
    (ALL_NORMALIZED_TAX_STATUSES as readonly string[]).includes(value)
  );
}
