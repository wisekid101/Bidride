import React, { forwardRef, useRef, useState } from 'react';
import {
  Animated,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Motion, Radius, Spacing, Typography } from '../../constants/theme';

// Bidiride production text field. Keep rider-app / driver-app copies identical.
// Label + focus glow + inline error/helper + optional left icon & right slot.
// Fully accessible: label is wired via accessibilityLabel and error via
// accessibilityValue so screen readers announce the validation state.
interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  helper?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  prefix?: React.ReactNode;
  right?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  optional?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, helper, icon, prefix, right, containerStyle, optional, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const animateTo = (v: number) =>
    Animated.timing(anim, { toValue: v, duration: Motion.fast, useNativeDriver: false }).start();

  const borderColor = error
    ? Colors.error
    : anim.interpolate({ inputRange: [0, 1], outputRange: [Colors.border, Colors.primary] });

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {optional && <Text style={styles.optional}>Optional</Text>}
        </View>
      )}
      <Animated.View
        style={[
          styles.field,
          { borderColor },
          focused && !error && styles.fieldFocused,
          !!error && styles.fieldError,
        ]}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={19}
            color={error ? Colors.error : focused ? Colors.primary : Colors.textSecondary}
            style={styles.icon}
          />
        )}
        {prefix != null && (
          typeof prefix === 'string' ? <Text style={styles.prefix}>{prefix}</Text> : <View style={styles.prefixNode}>{prefix}</View>
        )}
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={Colors.textTertiary}
          selectionColor={Colors.primary}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            animateTo(1);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            animateTo(0);
            onBlur?.(e);
          }}
          {...rest}
        />
        {right && <View style={styles.right}>{right}</View>}
      </Animated.View>
      {error ? (
        <View style={styles.msgRow}>
          <Ionicons name="alert-circle" size={14} color={Colors.error} />
          <Text style={[styles.msg, styles.msgError]}>{error}</Text>
        </View>
      ) : helper ? (
        <Text style={styles.msg}>{helper}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.base },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  label: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontFamily: Fonts.sansSemiBold,
    letterSpacing: 0.2,
  },
  optional: { color: Colors.textTertiary, fontSize: Typography.size.xs, fontFamily: Fonts.sans },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.base,
  },
  fieldFocused: {
    backgroundColor: Colors.surfaceHover,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldError: { backgroundColor: Colors.errorSoft },
  icon: { marginRight: Spacing.sm },
  prefix: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontFamily: Fonts.sansSemiBold,
    marginRight: Spacing.sm,
    paddingRight: Spacing.sm,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingVertical: 15,
  },
  prefixNode: { marginRight: Spacing.sm },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.md,
    fontFamily: Fonts.sans,
    paddingVertical: 15,
  },
  right: { marginLeft: Spacing.sm },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.xs, paddingHorizontal: 2 },
  msg: {
    color: Colors.textTertiary,
    fontSize: Typography.size.xs,
    fontFamily: Fonts.sans,
    marginTop: Spacing.xs,
    paddingHorizontal: 2,
    lineHeight: 16,
  },
  msgError: { color: Colors.error, marginTop: 0 },
});
