// Canonical driver-onboarding cursor (SB2A Batch 1).
//
// The step a driver must resume on is DERIVED from completion facts, NOT read
// blindly from the stored `onboardingStep` cursor. This lets legacy stored
// values (including the obsolete `vehicle_inspection`) normalize forward with no
// database rewrite and no progress reset. Vehicle inspection is an
// administrative `Vehicle` attribute and is never an onboarding cursor.
//
// Canonical order (SB2A Batch 2): personal_info -> vehicle_info ->
// document_upload -> bank_account -> background_check -> zero_tolerance ->
// complete. `zero_tolerance` is a Zero Tolerance policy acknowledgement the
// driver must accept before onboarding can complete.

export type OnboardingStepValue =
  | 'personal_info'
  | 'vehicle_info'
  | 'document_upload'
  | 'bank_account'
  | 'background_check'
  | 'zero_tolerance'
  | 'complete';

// The single source of the canonical step-string set (also asserted by the
// backend<->mobile contract test).
export const CANONICAL_ONBOARDING_STEPS: readonly OnboardingStepValue[] = [
  'personal_info',
  'vehicle_info',
  'document_upload',
  'bank_account',
  'background_check',
  'zero_tolerance',
  'complete',
] as const;

export interface OnboardingFacts {
  status: string;
  legalFirstName: string | null;
  dateOfBirth: Date | null;
  licenseNumber: string | null;
  vehicleCount: number;
  documents: Array<{ documentType: string; status: string }>;
  stripeAccountId: string | null;
  backgroundCheckStatus: string;
  // True IFF the driver has an acceptance for the CURRENT Zero Tolerance policy
  // version. Computed by the caller (getProfile) by comparing the denormalized
  // Driver.zeroToleranceAcceptedVersion against the current policy version, so
  // the resolver stays a pure function that needs no policy lookup.
  zeroToleranceAccepted: boolean;
}

// Accepted documentType spellings per required document — the app uploads
// 'insurance'/'registration'; the schema enum names them
// 'insurance_card'/'vehicle_registration'.
const REQUIRED_DOCUMENTS: string[][] = [
  ['drivers_license'],
  ['insurance', 'insurance_card'],
  ['registration', 'vehicle_registration'],
];

export function isPersonalComplete(f: OnboardingFacts): boolean {
  return Boolean(f.legalFirstName && f.dateOfBirth && f.licenseNumber);
}

export function isVehicleAdded(f: OnboardingFacts): boolean {
  return f.vehicleCount > 0;
}

// All required documents present and none rejected. A rejected document makes
// this false, correctly routing the driver back to document upload.
export function areDocumentsComplete(f: OnboardingFacts): boolean {
  return REQUIRED_DOCUMENTS.every((types) =>
    f.documents.some((d) => types.includes(d.documentType) && d.status !== 'rejected'),
  );
}

export function isBankConnected(f: OnboardingFacts): boolean {
  return Boolean(f.stripeAccountId);
}

export function isBackgroundRequested(f: OnboardingFacts): boolean {
  return f.backgroundCheckStatus !== 'not_started';
}

export function isZeroToleranceAccepted(f: OnboardingFacts): boolean {
  return f.zeroToleranceAccepted;
}

// Fact-based canonical resolver. Forward-only: returns the FIRST unmet step in
// canonical order, so a driver is never routed backward and completed progress
// is never reset. NEVER returns `vehicle_inspection` (retired as a cursor).
export function resolveOnboardingStep(f: OnboardingFacts): OnboardingStepValue {
  if (f.status === 'approved') return 'complete';
  if (!isPersonalComplete(f)) return 'personal_info';
  if (!isVehicleAdded(f)) return 'vehicle_info';
  if (!areDocumentsComplete(f)) return 'document_upload';
  if (!isBankConnected(f)) return 'bank_account';
  if (!isBackgroundRequested(f)) return 'background_check';
  if (!isZeroToleranceAccepted(f)) return 'zero_tolerance';
  return 'complete';
}

// A stored cursor value that is no longer a canonical step (drift / obsolete /
// stale). Used only for non-sensitive observability logging.
export function isNonCanonicalCursor(stored: string | null | undefined): boolean {
  return !stored || !CANONICAL_ONBOARDING_STEPS.includes(stored as OnboardingStepValue);
}
