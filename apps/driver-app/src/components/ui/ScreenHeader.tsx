import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Spacing, Typography } from '../../constants/theme';

// BidiRide in-screen header: [back] [centered title] [right accessory].
// Keep the rider-app and driver-app copies identical.
interface ScreenHeaderProps {
  title?: string;
  showBack?: boolean;
  // Overrides the default back behavior (router.back with a Home fallback
  // for screens reached via replace, which have no stack to pop).
  onBack?: () => void;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, showBack = true, onBack, right }: ScreenHeaderProps) {
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  };

  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {showBack && (
          <TouchableOpacity
            onPress={goBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  side: { minWidth: 48, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  title: {
    flex: 1,
    textAlign: 'center',
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
});
