import { useEffect, useState } from 'react';
import { Stack, usePathname, router } from 'expo-router';
import { api } from '../../src/api/client';
import {
  resolveDriverRoute,
  onboardingStepIndex,
} from '../../src/utils/onboardingRoute';

export default function OnboardingLayout() {
  const pathname = usePathname();
  const [allowedRoute, setAllowedRoute] = useState<string | null>(null);

  // Refetch on every navigation; null the gate while stale so a legitimate
  // forward step (screen advanced right after a successful submit) is never
  // bounced by an outdated snapshot.
  useEffect(() => {
    let cancelled = false;
    setAllowedRoute(null);
    api
      .get<{ status: string; onboardingStep: string }>('/drivers/me')
      .then((me) => { if (!cancelled) setAllowedRoute(resolveDriverRoute(me)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  // No skipping ahead: deep links / stale navigation past the server-side
  // current step get bounced back to it. Revisiting earlier steps is allowed.
  useEffect(() => {
    if (!allowedRoute || !allowedRoute.startsWith('/onboarding')) return;
    if (onboardingStepIndex(pathname) > onboardingStepIndex(allowedRoute)) {
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
