// SB2A Phase 4A — Status normalization layer.
//
// The boundary that guarantees provider-specific status strings never enter the
// Compliance Engine, DriverActivationService, Admin, or Mobile. Every provider
// adapter supplies a TaxStatusNormalizer; the ONLY value that crosses this
// boundary is a NormalizedTaxStatus.

import { NormalizedTaxStatus, isNormalizedTaxStatus } from './normalized-tax-status';

export interface TaxStatusNormalizer {
  readonly provider: string;
  // Maps a provider-internal status to the BidiRide manifest. An unknown or
  // unmappable value MUST resolve to a safe normalized status (never leak the
  // raw value, never guess a passing status).
  normalize(rawProviderStatus: string): NormalizedTaxStatus;
}

// Defensive guard applied at the boundary: assert a value is a normalized status
// before it is allowed to leave the tax-compliance context. Throws on anything
// that is not part of the manifest — a provider string can never masquerade as a
// normalized one.
export function assertNormalized(value: unknown): NormalizedTaxStatus {
  if (!isNormalizedTaxStatus(value)) {
    throw new Error('Non-normalized tax status crossed the provider boundary');
  }
  return value;
}

// Runs an adapter's normalizer and enforces the boundary guarantee. An unknown
// provider value that the adapter does not map is treated as UNAVAILABLE
// (fail-safe, never a passing status), keeping the raw value contained.
export function normalizeProviderStatus(
  normalizer: TaxStatusNormalizer,
  rawProviderStatus: string,
): NormalizedTaxStatus {
  let result: NormalizedTaxStatus;
  try {
    result = normalizer.normalize(rawProviderStatus);
  } catch {
    // A throwing/unknown mapping never leaks a raw status or a passing state.
    return NormalizedTaxStatus.UNAVAILABLE;
  }
  return isNormalizedTaxStatus(result) ? result : NormalizedTaxStatus.UNAVAILABLE;
}
