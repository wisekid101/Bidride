import { useEffect, useState } from 'react';
import { Stack, usePathname, router } from 'expo-router';
import { api } from '../../src/api/client';
import { displayStepIndex, fetchHasVehicle, resolveOnboardingRoute } from '../../src/utils/onboardingPlan';

export default function OnboardingLayout() {
  const pathname = usePathname();
  const [allowedRoute, setAllowedRoute] = useState<string | null>(null);

  // Refetch on every navigation; null the gate while stale so a legitimate
  // forward step (screen advanced right after a successful submit) is never
  // bounced by an outdated snapshot. The allowed step is derived from the
  // VISIBLE order (onboardingPlan) so Vehicle-before-Documents isn't bounced.
  useEffect(() => {
    let cancelled = false;
    setAllowedRoute(null);
    (async () => {
      try {
        const me = await api.get<{ status: string; onboardingStep: string }>('/drivers/me');
        const hasVehicle = await fetchHasVehicle(api.get);
        if (!cancelled) setAllowedRoute(resolveOnboardingRoute(me, hasVehicle));
      } catch { /* ignore — auth/token flows handle failures */ }
    })();
    return () => { cancelled = true; };
  }, [pathname]);

  // Keep the driver on the right screen. Two cases:
  //  1. An approved / non-onboarding driver stranded in the onboarding group
  //     (e.g. a flaky resume dropped them here) is routed OUT — never trapped
  //     on the Welcome screen with no way forward.
  //  2. No skipping ahead in the VISIBLE order: deep links / stale navigation
  //     past the current step get bounced back. Revisiting earlier steps is OK.
  useEffect(() => {
    if (!allowedRoute) return;
    if (!allowedRoute.startsWith('/onboarding')) {
      router.replace(allowedRoute as never);
      return;
    }
    if (displayStepIndex(pathname) > displayStepIndex(allowedRoute)) {
      router.replace(allowedRoute as never);
    }
  }, [allowedRoute, pathname]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="personal-info" />
      <Stack.Screen name="vehicle-info" />
      <Stack.Screen name="document-upload" />
      <Stack.Screen name="bank-account" />
      <Stack.Screen name="background-check" />
      <Stack.Screen name="complete" />
    </Stack>
  );
}
