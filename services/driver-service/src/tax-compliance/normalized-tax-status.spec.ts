import {
  NormalizedTaxStatus,
  ALL_NORMALIZED_TAX_STATUSES,
  PASSING_TAX_STATUSES,
  isPassingTaxStatus,
  missingKeyForTaxStatus,
  isNormalizedTaxStatus,
} from './normalized-tax-status';

describe('NormalizedTaxStatus manifest', () => {
  it('contains exactly the nine founder-approved statuses', () => {
    expect([...ALL_NORMALIZED_TAX_STATUSES].sort()).toEqual(
      [
        'needs_update',
        'not_started',
        'pending_provider',
        'provider_confirmed_exempt',
        'rejected',
        'session_created',
        'superseded',
        'unavailable',
        'verified',
      ].sort(),
    );
  });

  it('only verified and provider_confirmed_exempt pass', () => {
    expect([...PASSING_TAX_STATUSES].sort()).toEqual(
      ['provider_confirmed_exempt', 'verified'].sort(),
    );
    expect(isPassingTaxStatus(NormalizedTaxStatus.VERIFIED)).toBe(true);
    expect(isPassingTaxStatus(NormalizedTaxStatus.PROVIDER_CONFIRMED_EXEMPT)).toBe(true);
    for (const s of ALL_NORMALIZED_TAX_STATUSES) {
      if (s !== NormalizedTaxStatus.VERIFIED && s !== NormalizedTaxStatus.PROVIDER_CONFIRMED_EXEMPT) {
        expect(isPassingTaxStatus(s)).toBe(false);
      }
    }
  });

  it('maps every blocking status to a sanitized BidiRide-owned key; passing → null', () => {
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.VERIFIED)).toBeNull();
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.PROVIDER_CONFIRMED_EXEMPT)).toBeNull();
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.NOT_STARTED)).toBe('w9:not_started');
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.SESSION_CREATED)).toBe('w9:not_started');
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.PENDING_PROVIDER)).toBe('w9:pending');
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.REJECTED)).toBe('w9:rejected');
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.NEEDS_UPDATE)).toBe('w9:needs_update');
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.SUPERSEDED)).toBe('w9:needs_update');
    expect(missingKeyForTaxStatus(NormalizedTaxStatus.UNAVAILABLE)).toBe('w9:provider_unavailable');
  });

  it('every missing key is sanitized (w9:* namespace, no raw provider strings)', () => {
    for (const s of ALL_NORMALIZED_TAX_STATUSES) {
      const key = missingKeyForTaxStatus(s);
      if (key !== null) expect(key).toMatch(/^w9:[a-z_]+$/);
    }
  });

  it('isNormalizedTaxStatus rejects provider-specific / unknown strings', () => {
    expect(isNormalizedTaxStatus('verified')).toBe(true);
    expect(isNormalizedTaxStatus('stripe.identity.verified')).toBe(false);
    expect(isNormalizedTaxStatus('VERIFIED')).toBe(false);
    expect(isNormalizedTaxStatus(null)).toBe(false);
    expect(isNormalizedTaxStatus(42)).toBe(false);
  });
});
