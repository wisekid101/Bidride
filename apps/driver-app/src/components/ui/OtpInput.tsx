import React, { forwardRef, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../../constants/theme';

// Bidiride segmented OTP field. Keep rider-app / driver-app copies identical.
// A single hidden TextInput owns the value (so paste + OS autofill of the
// one-time code keep working); the visible cells mirror each digit. The active
// cell shows a pulsing caret. Error state tints all cells red.
interface OtpInputProps {
  value: string;
  onChangeText: (v: string) => void;
  length?: number;
  error?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
}

export const OtpInput = forwardRef<TextInput, OtpInputProps>(function OtpInput(
  { value, onChangeText, length = 6, error = false, autoFocus = false, editable = true },
  ref,
) {
  const localRef = useRef<TextInput>(null);
  const inputRef = (ref as React.RefObject<TextInput>) ?? localRef;
  const caret = useRef(new Animated.Value(1)).current;

  const startCaret = () => {
    caret.setValue(1);
    Animated.loop(
      Animated.sequence([
        Animated.timing(caret, { toValue: 0, duration: 500, delay: 350, useNativeDriver: true }),
        Animated.timing(caret, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    ).start();
  };

  const focus = () => inputRef.current?.focus();
  const cells = Array.from({ length });

  return (
    <Pressable onPress={focus} accessibilityLabel="Verification code" accessibilityRole="none">
      <View style={styles.row}>
        {cells.map((_, i) => {
          const char = value[i] ?? '';
          const isActive = editable && i === value.length;
          const isFilled = !!char;
          return (
            <View
              key={i}
              style={[
                styles.cell,
                isFilled && styles.cellFilled,
                isActive && styles.cellActive,
                error && styles.cellError,
              ]}
            >
              {char ? (
                <Text style={styles.digit} allowFontScaling={false}>
                  {char}
                </Text>
              ) : isActive ? (
                <Animated.View style={[styles.caret, { opacity: caret }]} />
              ) : null}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        style={styles.hidden}
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        editable={editable}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        caretHidden
        onFocus={startCaret}
      />
    </Pressable>
  );
});

const CELL = 52;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  cell: {
    flex: 1,
    height: CELL + 8,
    maxWidth: CELL + 6,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: Colors.borderStrong, backgroundColor: Colors.surfaceHover },
  cellActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceHover,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 2,
  },
  cellError: { borderColor: Colors.error, backgroundColor: Colors.errorSoft },
  digit: {
    color: Colors.text,
    fontSize: 26,
    fontFamily: Fonts.monoBold,
  },
  caret: { width: 2, height: 26, borderRadius: 1, backgroundColor: Colors.primary },
  hidden: { position: 'absolute', opacity: 0, height: CELL + 8, width: '100%' },
});
