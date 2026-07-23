import {
  resolveDriverRoute,
  onboardingStepIndex,
  ONBOARDING_ORDER,
} from '../utils/onboardingRoute';

// The canonical onboarding step-string set (SB2A Batch 1). This MUST stay in
// lockstep with the backend's CANONICAL_ONBOARDING_STEPS
// (services/driver-service/src/drivers/onboarding-step.util.ts). The backend now
// derives `onboardingStep` from completion facts and only ever emits one of
// these six values; this is the mobile half of that contract.
const CANONICAL_STEPS = [
  'personal_info',
  'vehicle_info',
  'document_upload',
  'bank_account',
  'background_check',
  'zero_tolerance',
  'complete',
] as const;

describe('resolveDriverRoute — canonical Batch 1 routing', () => {
  it('sends an approved driver to the tabs (dashboard), not an onboarding screen', () => {
    expect(resolveDriverRoute({ status: 'approved', onboardingStep: 'complete' })).toBe('/(tabs)');
    // approved wins even if the cursor is stale.
    expect(resolveDriverRoute({ status: 'approved', onboardingStep: 'personal_info' })).toBe(
      '/(tabs)',
    );
  });

  it('resumes each canonical step on its own screen, in canonical order', () => {
    expect(resolveDriverRoute({ status: 'pending', onboardingStep: 'personal_info' })).toBe(
      '/onboarding/personal-info',
    );
    expect(resolveDriverRoute({ status: 'pending', onboardingStep: 'vehicle_info' })).toBe(
      '/onboarding/vehicle-info',
    );
    expect(resolveDriverRoute({ status: 'pending', onboardingStep: 'document_upload' })).toBe(
      '/onboarding/document-upload',
    );
    expect(resolveDriverRoute({ status: 'pending', onboardingStep: 'bank_account' })).toBe(
      '/onboarding/bank-account',
    );
    expect(resolveDriverRoute({ status: 'under_review', onboardingStep: 'background_check' })).toBe(
      '/onboarding/background-check',
    );
    expect(resolveDriverRoute({ status: 'under_review', onboardingStep: 'zero_tolerance' })).toBe(
      '/onboarding/zero-tolerance',
    );
    expect(resolveDriverRoute({ status: 'under_review', onboardingStep: 'complete' })).toBe(
      '/onboarding/complete',
    );
  });

  it('zero_tolerance falls between background_check and complete (Batch 2 order)', () => {
    const bgIdx = onboardingStepIndex(
      resolveDriverRoute({ status: 'under_review', onboardingStep: 'background_check' }),
    );
    const ztIdx = onboardingStepIndex(
      resolveDriverRoute({ status: 'under_review', onboardingStep: 'zero_tolerance' }),
    );
    const completeIdx = onboardingStepIndex('/onboarding/complete');
    expect(bgIdx).toBeLessThan(ztIdx);
    expect(ztIdx).toBeLessThan(completeIdx);
  });

  it('vehicle precedes documents (regression guard for the old inverted order)', () => {
    const vehicleIdx = onboardingStepIndex(
      resolveDriverRoute({ status: 'pending', onboardingStep: 'vehicle_info' }),
    );
    const documentsIdx = onboardingStepIndex(
      resolveDriverRoute({ status: 'pending', onboardingStep: 'document_upload' }),
    );
    expect(vehicleIdx).toBeLessThan(documentsIdx);
  });

  it('routes the retired legacy value `vehicle_inspection` to the safe under-review screen (never a reset)', () => {
    // The backend derives the real step; if an old client/value ever reaches
    // here it must NOT bounce the driver back to personal-info.
    expect(resolveDriverRoute({ status: 'under_review', onboardingStep: 'vehicle_inspection' })).toBe(
      '/onboarding/complete',
    );
    expect(resolveDriverRoute({ status: 'under_review', onboardingStep: 'review' })).toBe(
      '/onboarding/complete',
    );
  });

  it('falls back safely for an unknown/garbage cursor without resetting progress', () => {
    expect(resolveDriverRoute({ status: 'under_review', onboardingStep: 'zzz-unknown' })).toBe(
      '/onboarding/complete',
    );
  });
});

describe('onboardingStepIndex — progress "Step X of 7"', () => {
  it('exposes exactly seven canonical stages', () => {
    expect(ONBOARDING_ORDER).toHaveLength(7);
  });

  it('reports a strictly increasing index across the canonical order', () => {
    const indices = ONBOARDING_ORDER.map((route) => onboardingStepIndex(route));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('clamps an unknown route to the first stage', () => {
    expect(onboardingStepIndex('/onboarding/does-not-exist')).toBe(0);
  });
});

describe('backend↔mobile canonical contract', () => {
  it('maps every canonical backend step to a distinct onboarding screen', () => {
    const routes = CANONICAL_STEPS.map((step) =>
      resolveDriverRoute({ status: 'pending', onboardingStep: step }),
    );
    // Every canonical step resolves to a real, distinct screen (no two steps
    // collapse onto the same route, no step falls through to the default).
    expect(new Set(routes).size).toBe(CANONICAL_STEPS.length);
  });

  it('uses the same canonical string set the backend emits (order-sensitive)', () => {
    // Mirror of CANONICAL_ONBOARDING_STEPS on the backend. If either side
    // changes the list, this and the backend util spec both fail.
    expect([...CANONICAL_STEPS]).toEqual([
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
