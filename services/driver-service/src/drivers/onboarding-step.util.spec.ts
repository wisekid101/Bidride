import {
  resolveOnboardingStep,
  isNonCanonicalCursor,
  CANONICAL_ONBOARDING_STEPS,
  OnboardingFacts,
} from './onboarding-step.util';

// A fully-complete, not-yet-approved driver (everything done, awaiting review).
function facts(overrides: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    status: 'under_review',
    legalFirstName: 'Sam',
    dateOfBirth: new Date('1990-01-01'),
    licenseNumber: 'D123',
    vehicleCount: 1,
    documents: [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance', status: 'pending' },
      { documentType: 'registration', status: 'pending' },
    ],
    stripeAccountId: 'acct_1',
    backgroundCheckStatus: 'pending',
    zeroToleranceAccepted: true,
    ...overrides,
  };
}

describe('resolveOnboardingStep — canonical order (personal→vehicle→documents→bank→background→complete)', () => {
  it('approved driver → complete', () => {
    expect(resolveOnboardingStep(facts({ status: 'approved' }))).toBe('complete');
  });

  it('incomplete personal info → personal_info', () => {
    expect(resolveOnboardingStep(facts({ legalFirstName: null }))).toBe('personal_info');
    expect(resolveOnboardingStep(facts({ dateOfBirth: null }))).toBe('personal_info');
    expect(resolveOnboardingStep(facts({ licenseNumber: null }))).toBe('personal_info');
  });

  it('VEHICLE BEFORE DOCUMENTS: personal done, no vehicle → vehicle_info', () => {
    expect(resolveOnboardingStep(facts({ vehicleCount: 0 }))).toBe('vehicle_info');
  });

  it('documents incomplete (missing a required doc) → document_upload', () => {
    expect(
      resolveOnboardingStep(
        facts({ documents: [{ documentType: 'drivers_license', status: 'approved' }] }),
      ),
    ).toBe('document_upload');
  });

  it('accepts schema-enum doc spellings (insurance_card, vehicle_registration) as complete', () => {
    // The required-doc groups accept both the app spelling and the DB enum
    // spelling. With docs complete via the enum aliases and no bank connected,
    // the resolver must advance PAST document_upload to bank_account.
    expect(
      resolveOnboardingStep(
        facts({
          stripeAccountId: null,
          documents: [
            { documentType: 'drivers_license', status: 'approved' },
            { documentType: 'insurance_card', status: 'approved' },
            { documentType: 'vehicle_registration', status: 'approved' },
          ],
        }),
      ),
    ).toBe('bank_account');
  });

  it('a REJECTED document → document_upload (fix required)', () => {
    expect(
      resolveOnboardingStep(
        facts({
          documents: [
            { documentType: 'drivers_license', status: 'rejected' },
            { documentType: 'insurance', status: 'approved' },
            { documentType: 'registration', status: 'approved' },
          ],
        }),
      ),
    ).toBe('document_upload');
  });

  it('BANK BEFORE BACKGROUND: docs done, no bank → bank_account', () => {
    expect(resolveOnboardingStep(facts({ stripeAccountId: null }))).toBe('bank_account');
  });

  it('bank done, background not requested → background_check', () => {
    expect(resolveOnboardingStep(facts({ backgroundCheckStatus: 'not_started' }))).toBe(
      'background_check',
    );
  });

  it('ZERO TOLERANCE AFTER BACKGROUND: background requested but ZT not accepted → zero_tolerance', () => {
    expect(resolveOnboardingStep(facts({ zeroToleranceAccepted: false }))).toBe('zero_tolerance');
  });

  it('background requested and ZT accepted, awaiting decision → complete', () => {
    expect(resolveOnboardingStep(facts({ zeroToleranceAccepted: true }))).toBe('complete');
  });

  it('ZT is the LAST gate: everything else done but ZT not accepted → zero_tolerance (not complete)', () => {
    expect(resolveOnboardingStep(facts())).toBe('complete'); // default accepts ZT
    expect(resolveOnboardingStep(facts({ zeroToleranceAccepted: false }))).toBe('zero_tolerance');
  });

  it('ZT not accepted does NOT mask an earlier unmet step (no bank → bank_account first)', () => {
    expect(
      resolveOnboardingStep(facts({ stripeAccountId: null, zeroToleranceAccepted: false })),
    ).toBe('bank_account');
  });

  it('approved driver → complete even if ZT flag is false (grandfathered/short-circuit)', () => {
    expect(resolveOnboardingStep(facts({ status: 'approved', zeroToleranceAccepted: false }))).toBe(
      'complete',
    );
  });

  it('everything submitted incl. ZT, awaiting decision → complete', () => {
    expect(resolveOnboardingStep(facts())).toBe('complete');
  });

  it('never returns vehicle_inspection (retired as a cursor)', () => {
    // A driver whose only "vehicle work" is a pending inspection still counts as
    // vehicle-added; the resolver moves on to documents/bank, never inspection.
    const out = resolveOnboardingStep(facts({ vehicleCount: 1, documents: [] }));
    expect(out).toBe('document_upload');
    expect(out).not.toBe('vehicle_inspection' as any);
  });

  describe('legacy stored values normalize forward (no reset) — derived purely from facts', () => {
    // The stored cursor is irrelevant to the resolver; these show a driver who,
    // under the OLD order, was parked at each legacy value resolves to the right
    // canonical remaining step based on what they actually completed.
    it('legacy vehicle_inspection (vehicle+docs+bg done, no bank) → bank_account', () => {
      expect(
        resolveOnboardingStep(
          facts({
            vehicleCount: 1,
            documents: [
              { documentType: 'drivers_license', status: 'approved' },
              { documentType: 'insurance', status: 'approved' },
              { documentType: 'registration', status: 'approved' },
            ],
            backgroundCheckStatus: 'pending',
            stripeAccountId: null,
          }),
        ),
      ).toBe('bank_account');
    });

    it('legacy background_check (docs done, no vehicle) → vehicle_info (vehicle inserted first)', () => {
      expect(
        resolveOnboardingStep(
          facts({
            vehicleCount: 0,
            documents: [
              { documentType: 'drivers_license', status: 'approved' },
              { documentType: 'insurance', status: 'approved' },
              { documentType: 'registration', status: 'approved' },
            ],
          }),
        ),
      ).toBe('vehicle_info');
    });
  });
});

describe('isNonCanonicalCursor — observability helper', () => {
  it('flags null / unknown / obsolete cursors', () => {
    expect(isNonCanonicalCursor(null)).toBe(true);
    expect(isNonCanonicalCursor('vehicle_inspection')).toBe(true);
    expect(isNonCanonicalCursor('review')).toBe(true);
    expect(isNonCanonicalCursor('totally_unknown')).toBe(true);
  });
  it('accepts canonical cursors', () => {
    for (const s of CANONICAL_ONBOARDING_STEPS) expect(isNonCanonicalCursor(s)).toBe(false);
  });
});

describe('CANONICAL_ONBOARDING_STEPS — backend↔mobile contract (order-sensitive)', () => {
  it('is exactly the shared canonical list (mirror of the driver-app onboardingRoute contract test)', () => {
    expect([...CANONICAL_ONBOARDING_STEPS]).toEqual([
      'personal_info',
      'vehicle_info',
      'document_upload',
      'bank_account',
      'background_check',
      'zero_tolerance',
      'complete',
    ]);
  });
});
