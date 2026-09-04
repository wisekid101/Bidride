import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Colors, Fonts, Radius, Spacing, Typography } from '../../constants/theme';

// Bidiride onboarding progress indicator. Keep rider-app / driver-app copies
// identical. Shows "Step X of Y" + a label and an animated fill bar so a user
// always knows how far through a multi-step flow they are.
interface ProgressStepsProps {
  current: number; // 1-based
  total: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function ProgressSteps({ current, total, label, style }: ProgressStepsProps) {
  const pct = Math.max(0, Math.min(1, total > 0 ? current / total : 0));
  const width = useRef(new Animated.Value(pct)).current;

  useEffect(() => {
    Animated.spring(width, { toValue: pct, useNativeDriver: false, friction: 10, tension: 60 }).start();
  }, [pct, width]);

  return (
    <View style={style} accessibilityLabel={`Step ${current} of ${total}${label ? `: ${label}` : ''}`}>
      <View style={styles.headerRow}>
        <Text style={styles.step}>
          Step {current} <Text style={styles.stepMuted}>of {total}</Text>
        </Text>
        {label && <Text style={styles.label}>{label}</Text>}
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            { width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  step: { color: Colors.text, fontSize: Typography.size.sm, fontFamily: Fonts.sansSemiBold },
  stepMuted: { color: Colors.textTertiary, fontFamily: Fonts.sans },
  label: { color: Colors.primary, fontSize: Typography.size.sm, fontFamily: Fonts.sansSemiBold },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
});
