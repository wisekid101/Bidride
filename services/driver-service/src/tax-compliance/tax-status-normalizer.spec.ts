import { NormalizedTaxStatus } from './normalized-tax-status';
import {
  TaxStatusNormalizer,
  assertNormalized,
  normalizeProviderStatus,
} from './tax-status-normalizer';

// A representative adapter normalizer mapping provider-internal strings.
const stubNormalizer: TaxStatusNormalizer = {
  provider: 'stub',
  normalize(raw: string): NormalizedTaxStatus {
    switch (raw) {
      case 'identity.verified':
        return NormalizedTaxStatus.VERIFIED;
      case 'identity.pending':
        return NormalizedTaxStatus.PENDING_PROVIDER;
      case 'identity.failed':
        return NormalizedTaxStatus.REJECTED;
      default:
        throw new Error(`unknown provider status: ${raw}`);
    }
  },
};

describe('status normalization boundary', () => {
  it('maps known provider statuses to the manifest', () => {
    expect(normalizeProviderStatus(stubNormalizer, 'identity.verified')).toBe(
      NormalizedTaxStatus.VERIFIED,
    );
    expect(normalizeProviderStatus(stubNormalizer, 'identity.pending')).toBe(
      NormalizedTaxStatus.PENDING_PROVIDER,
    );
  });

  it('an unknown/unmapped provider status resolves to UNAVAILABLE (never leaks, never passes)', () => {
    const out = normalizeProviderStatus(stubNormalizer, 'identity.some_new_state');
    expect(out).toBe(NormalizedTaxStatus.UNAVAILABLE);
  });

  it('a normalizer that returns a non-manifest value is contained as UNAVAILABLE', () => {
    const rogue: TaxStatusNormalizer = {
      provider: 'rogue',
      normalize: () => 'stripe.raw.status' as any,
    };
    expect(normalizeProviderStatus(rogue, 'anything')).toBe(NormalizedTaxStatus.UNAVAILABLE);
  });

  it('assertNormalized throws if a non-manifest value tries to cross the boundary', () => {
    expect(() => assertNormalized('verified')).not.toThrow();
    expect(() => assertNormalized('stripe.identity.verified')).toThrow();
    expect(() => assertNormalized(undefined)).toThrow();
  });
});
