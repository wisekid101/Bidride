import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography } from '../../constants/theme';

// Bidiride brand button. Keep the rider-app and driver-app copies identical.
// primary   — Electric Teal fill with glow, navy text (never white on teal)
// secondary — outlined, for non-committal actions
// ghost     — text-only, for tertiary actions
// danger    — outlined red text (red FILL stays reserved for SOS/safety)
// Backward compatible: existing callers pass { title, onPress, variant?,
// loading?, disabled?, style? }. size/icon/fullWidth are additive.
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZE: Record<ButtonSize, { padV: number; font: number; icon: number; radius: number }> = {
  sm: { padV: 11, font: Typography.size.sm, icon: 16, radius: Radius.md },
  md: { padV: 16, font: Typography.size.md, icon: 19, radius: Radius.lg },
  lg: { padV: 18, font: Typography.size.lg, icon: 22, radius: Radius.lg },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  fullWidth = true,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const scale = useRef(new Animated.Value(1)).current;
  const s = SIZE[size];

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const tint = variant === 'primary' ? Colors.primaryText
    : variant === 'danger' ? Colors.safety
    : Colors.text;

  return (
    <Animated.View style={[fullWidth && styles.fullWidth, { transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        accessibilityLabel={title}
        style={[
          styles.base,
          { paddingVertical: s.padV, borderRadius: s.radius },
          variantStyles[variant],
          variant === 'primary' && !isDisabled && Shadow.button,
          isDisabled && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={tint} />
        ) : (
          <View style={styles.content}>
            {icon && iconPosition === 'left' && (
              <Ionicons name={icon} size={s.icon} color={tint} style={styles.iconLeft} />
            )}
            <Text style={[styles.text, { fontSize: s.font, color: tint }]} allowFontScaling={false}>
              {title}
            </Text>
            {icon && iconPosition === 'right' && (
              <Ionicons name={icon} size={s.icon} color={tint} style={styles.iconRight} />
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: 'stretch' },
  base: { alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  text: { fontFamily: Fonts.sansBold, fontWeight: Typography.weight.bold, letterSpacing: 0.2 },
  iconLeft: { marginRight: Spacing.sm },
  iconRight: { marginLeft: Spacing.sm },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.primary },
  secondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderStrong },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.safety + '66' },
});
