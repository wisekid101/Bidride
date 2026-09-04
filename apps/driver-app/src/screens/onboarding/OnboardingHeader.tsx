import React from 'react';
import { StyleSheet, Text, TouchableOpacity, Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Fonts, Spacing, Typography } from '../../constants/theme';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { ProgressSteps } from '../../components/ui/ProgressSteps';
import { useDriverStore } from '../../store/driver.store';
import { useDriverSocketStore } from '../../store/socket.store';
import { DISPLAY_STEPS, DISPLAY_TOTAL, displayStepIndex, displayStepLabel } from '../../utils/onboardingPlan';

interface OnboardingHeaderProps {
  // The screen's own onboarding route, e.g. '/onboarding/vehicle-info'.
  // Used to resolve the previous step when there is no navigation stack
  // (cold-start resume lands on a step via router.replace).
  route: string;
  // Hidden on the terminal Under Review screen — there is no step to go back to.
  showBack?: boolean;
  // The progress bar is shown by default; the terminal Review screen hides it.
  showProgress?: boolean;
}

export function OnboardingHeader({ route, showBack = true, showProgress = true }: OnboardingHeaderProps) {
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // Resumed mid-funnel with an empty stack — go to the previous VISIBLE step
    // directly. The onboarding skip-guard always allows revisiting earlier
    // steps; only skipping ahead is bounced.
    const idx = displayStepIndex(route);
    router.replace((idx > 0 ? DISPLAY_STEPS[idx - 1].route : '/onboarding') as never);
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

  const stepIndex = displayStepIndex(route);

  return (
    <View>
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
      {showProgress && (
        <ProgressSteps
          current={stepIndex + 1}
          total={DISPLAY_TOTAL}
          label={displayStepLabel(route)}
          style={styles.progress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  signOutText: {
    fontSize: Typography.size.sm,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
  progress: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
});
