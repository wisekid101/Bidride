// Maps the server-side driver status + onboardingStep to the screen the driver
// must resume on. Single source of truth for login routing, cold-start resume,
// and the onboarding skip-guard.

export interface DriverRouteInput {
  status: string;
  onboardingStep: string;
}

// Onboarding screen order — used to prevent skipping ahead.
export const ONBOARDING_ORDER = [
  '/onboarding/personal-info',
  '/onboarding/document-upload',
  '/onboarding/background-check',
  '/onboarding/vehicle-info',
  '/onboarding/bank-account',
  '/onboarding/complete',
] as const;

export function resolveDriverRoute({ status, onboardingStep }: DriverRouteInput): string {
  if (status === 'approved') return '/(tabs)';

  switch (onboardingStep) {
    case 'personal_info':
      return '/onboarding/personal-info';
    case 'document_upload':
      return '/onboarding/document-upload';
    case 'background_check':
      return '/onboarding/background-check';
    case 'vehicle_info':
      return '/onboarding/vehicle-info';
    // vehicle_inspection is an admin-side action; the driver continues to the
    // bank step while the inspection is pending (matches the normal flow).
    case 'vehicle_inspection':
    case 'bank_account':
      return '/onboarding/bank-account';
    // review/complete (or anything unknown) while not approved → under review
    default:
      return '/onboarding/complete';
  }
}

export function onboardingStepIndex(route: string): number {
  const idx = ONBOARDING_ORDER.findIndex((r) => route.startsWith(r));
  return idx === -1 ? 0 : idx;
}
