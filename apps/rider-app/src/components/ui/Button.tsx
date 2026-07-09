import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Colors, Radius, Typography } from '../../constants/theme';

// BidiRide brand button. Keep the rider-app and driver-app copies identical.
// primary   — Electric Teal fill, navy text (never white on teal)
// secondary — ghost with border, for non-committal actions
// danger    — ghost with red text, for destructive actions (red FILL stays
//             reserved for SOS/safety surfaces)
type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[styles.base, variantStyles[variant], isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? Colors.primaryText : Colors.primary}
        />
      ) : (
        <Text style={[styles.text, textStyles[variant]]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  text: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.primary },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.safety + '66',
  },
});

const textStyles = StyleSheet.create({
  primary: { color: Colors.primaryText },
  secondary: { color: Colors.text },
  danger: { color: Colors.safety },
});
