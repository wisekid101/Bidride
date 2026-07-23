// Maps the server-side driver status + onboardingStep to the screen the driver
// must resume on. Single source of truth for login routing, cold-start resume,
// and the onboarding skip-guard.

export interface DriverRouteInput {
  status: string;
  onboardingStep: string;
}

// Canonical onboarding screen order (SB2A Batch 1) — used to prevent skipping
// ahead and to size the progress bar (Step X of 6). The backend derives the
// current `onboardingStep` from completion facts, so the value routed here is
// always one of these canonical steps.
export const ONBOARDING_ORDER = [
  '/onboarding/personal-info',
  '/onboarding/vehicle-info',
  '/onboarding/document-upload',
  '/onboarding/bank-account',
  '/onboarding/background-check',
  '/onboarding/complete',
] as const;

export function resolveDriverRoute({ status, onboardingStep }: DriverRouteInput): string {
  if (status === 'approved') return '/(tabs)';

  switch (onboardingStep) {
    case 'personal_info':
      return '/onboarding/personal-info';
    case 'vehicle_info':
      return '/onboarding/vehicle-info';
    case 'document_upload':
      return '/onboarding/document-upload';
    case 'bank_account':
      return '/onboarding/bank-account';
    case 'background_check':
      return '/onboarding/background-check';
    case 'complete':
      return '/onboarding/complete';
    // Unknown/stale value (incl. the retired `vehicle_inspection`/`review`) →
    // the under-review screen. Never resets valid progress; the backend now
    // derives the canonical step, so this is only a safety net.
    default:
      return '/onboarding/complete';
  }
}

export function onboardingStepIndex(route: string): number {
  const idx = ONBOARDING_ORDER.findIndex((r) => route.startsWith(r));
  return idx === -1 ? 0 : idx;
}
