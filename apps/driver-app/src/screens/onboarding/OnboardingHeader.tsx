import React from 'react';
import { StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography } from '../../constants/theme';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useDriverStore } from '../../store/driver.store';
import { useDriverSocketStore } from '../../store/socket.store';
import { ONBOARDING_ORDER, onboardingStepIndex } from '../../utils/onboardingRoute';

interface OnboardingHeaderProps {
  // The screen's own onboarding route, e.g. '/onboarding/vehicle-info'.
  // Used to resolve the previous step when there is no navigation stack
  // (cold-start resume lands on a step via router.replace).
  route: string;
  // Hidden on the terminal Under Review screen — there is no step to go back to.
  showBack?: boolean;
}

export function OnboardingHeader({ route, showBack = true }: OnboardingHeaderProps) {
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // Resumed mid-funnel with an empty stack — go to the previous step
    // directly. The onboarding skip-guard always allows revisiting earlier
    // steps; only skipping ahead is bounced.
    const idx = onboardingStepIndex(route);
    router.replace((idx > 0 ? ONBOARDING_ORDER[idx - 1] : '/onboarding') as never);
  };

  const signOut = () => {
    Alert.alert(
      'Sign out',
      'Your progress is saved. Sign back in any time to continue where you left off.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            useDriverSocketStore.getState().disconnect();
            await useDriverStore.getState().clearTokens();
            router.replace('/(auth)');
          },
        },
      ],
    );
  };

  return (
    <ScreenHeader
      showBack={showBack}
      onBack={goBack}
      right={
        <TouchableOpacity
          onPress={signOut}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      }
    />
  );
}

const styles = StyleSheet.create({
  signOutText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
});
