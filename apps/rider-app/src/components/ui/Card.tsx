import React, { useRef } from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Radius, Shadow, Spacing } from '../../constants/theme';

// Bidiride brand card surface. Keep the rider-app and driver-app copies identical.
// Backward compatible: existing callers pass { children, style?, padded? }.
// onPress (interactive w/ press-scale), elevated (drop shadow) and accent
// (teal left edge) are additive.
interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevated?: boolean;
  accent?: boolean;
  onPress?: () => void;
}

export function Card({ children, style, padded = true, elevated = false, accent = false, onPress }: CardProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const body = (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        elevated && Shadow.card,
        accent && styles.accent,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start()}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  padded: { padding: Spacing.base },
  accent: { borderLeftWidth: 3, borderLeftColor: Colors.primary },
});
