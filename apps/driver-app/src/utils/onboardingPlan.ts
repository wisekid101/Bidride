// Onboarding DISPLAY compatibility layer (SB2A).
//
// The canonical backend onboarding state machine (see onboardingRoute.ts) is
// LEFT UNCHANGED — saved progress, routing, admin review and tests still depend
// on it. This module defines only the *visible* onboarding order and a
// completion-derived resume that inserts Vehicle Information between Personal
// Information and Documents WITHOUT touching the backend enum.
//
// The backend advances `personal_info → document_upload`. The founder-approved
// visible order is Personal → Vehicle → Documents → …, so when personal info is
// done but no vehicle exists yet, we resume on Vehicle. Everything else
// delegates to the canonical resolver, so existing drivers resume exactly as
// before and no onboarding records are invalidated.

import { DriverRouteInput, resolveDriverRoute } from './onboardingRoute';

// Visible order + labels. This is the founder-approved 10-stage journey; only
// the stages with a built screen are reachable today (the rest arrive in 2B).
export const DISPLAY_STEPS = [
  { route: '/onboarding/personal-info', label: 'Your details' },
  { route: '/onboarding/vehicle-info', label: 'Your vehicle' },
  { route: '/onboarding/document-upload', label: 'Documents' },
  { route: '/onboarding/government-id', label: 'Government ID' },
  { route: '/onboarding/selfie', label: 'Selfie' },
  { route: '/onboarding/background-check', label: 'Background check' },
  { route: '/onboarding/bank-account', label: 'Get paid' },
  { route: '/onboarding/wallet', label: 'Wallet' },
  { route: '/onboarding/trust', label: 'Trust' },
  { route: '/onboarding/complete', label: 'Review' },
] as const;

export const DISPLAY_TOTAL = DISPLAY_STEPS.length;

export function displayStepIndex(route: string): number {
  const i = DISPLAY_STEPS.findIndex((s) => route.startsWith(s.route));
  return i === -1 ? 0 : i;
}

export function displayStepLabel(route: string): string {
  return DISPLAY_STEPS[displayStepIndex(route)]?.label ?? '';
}

/**
 * Completion-derived resume for the Personal↔Vehicle slice. Delegates every
 * other state to the canonical resolver so existing drivers are unaffected.
 *
 * `hasVehicle` comes from GET /vehicles/me: `true`/`false` when known, or
 * `undefined` when the check could not be completed (network/timeout). On an
 * unknown result we deliberately DO NOT insert Vehicle — treating "unknown" as
 * "no vehicle" would send a driver who already has one backward. Instead we
 * fall back to the canonical (forward-only) resolver, so a transient failure
 * never moves a driver backward and never loops the skip-guard.
 */
export function resolveOnboardingRoute(me: DriverRouteInput, hasVehicle: boolean | undefined): string {
  if (me.status === 'approved') return '/(tabs)';
  // Only insert Vehicle when we DEFINITIVELY know there is no vehicle yet.
  if (me.onboardingStep === 'document_upload' && hasVehicle === false) {
    return '/onboarding/vehicle-info';
  }
  return resolveDriverRoute(me);
}

/**
 * GET /vehicles/me → `true`/`false` (known) or `undefined` (check failed).
 * Never throws: callers use the tri-state so an unknown result is handled
 * distinctly from a confirmed empty list.
 */
export async function fetchHasVehicle(
  get: <T>(path: string) => Promise<T>,
): Promise<boolean | undefined> {
  try {
    const vehicles = await get<unknown[]>('/vehicles/me');
    return Array.isArray(vehicles) && vehicles.length > 0;
  } catch {
    return undefined; // unknown — do not treat as "no vehicle"
  }
}

/**
 * Shared resume resolver used by BOTH cold-start and post-login routing so they
 * behave identically. Retries GET /drivers/me a few times to ride out a
 * transient failure (never dropping a returning driver into the wrong place on
 * one flaky call), then returns the destination route — or `null` if the
 * profile is unreachable or the session expired (caller handles that).
 */
export async function resolveResumeRoute(
  get: <T>(path: string) => Promise<T>,
): Promise<string | null> {
  let me: DriverRouteInput | null = null;
  for (let attempt = 0; attempt < 3 && !me; attempt++) {
    try {
      me = await get<DriverRouteInput>('/drivers/me');
    } catch (err) {
      if ((err as { code?: string })?.code === 'SESSION_EXPIRED') return null;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
    }
  }
  if (!me) return null;
  const hasVehicle = await fetchHasVehicle(get);
  return resolveOnboardingRoute(me, hasVehicle);
}
