import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '../../constants/theme';
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
    <View style={styles.row}>
      {showBack ? (
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backSpacer} />
      )}
      <TouchableOpacity
        onPress={signOut}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Sign out"
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backSpacer: { width: 24, height: 24 },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});
