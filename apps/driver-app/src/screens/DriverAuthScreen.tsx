import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';
import { useDriverStore } from '../store/driver.store';
import { useDriverSocketStore } from '../store/socket.store';
import { resolveDriverRoute } from '../utils/onboardingRoute';

type AuthPhase = 'phone' | 'otp';

export function DriverAuthScreen() {
  const router = useRouter();
  const { setTokens } = useDriverStore();
  const connectSocket = useDriverSocketStore((s) => s.connect);
  const [phase, setPhase] = useState<AuthPhase>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const otpRef = useRef<TextInput>(null);

  const formatPhone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const e164Phone = `+1${phone.replace(/\D/g, '')}`;

  const sendOtp = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      Alert.alert('Invalid number', 'Please enter a valid US phone number.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/send-otp', { phone: e164Phone, role: 'driver' });
      setPhase('otp');
      setTimeout(() => otpRef.current?.focus(), 300);
      setResendCountdown(30);
      const interval = setInterval(() => {
        setResendCountdown((c) => {
          if (c <= 1) { clearInterval(interval); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch (err: any) {
      if (err.code === 'AUTH_OTP_RATE_LIMITED') {
        Alert.alert('Too many attempts', 'Please wait 10 minutes before requesting a new code.');
      } else {
        Alert.alert('Error', 'Could not send verification code. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length < 6) return;
    setLoading(true);
    try {
      const result = await api.post<{
        access_token: string;
        refresh_token: string;
        user: { id: string; role: string; isNew: boolean };
      }>('/auth/verify-otp', { phone: e164Phone, code: otp, role: 'driver' });

      await setTokens(result.access_token, result.refresh_token, result.user.id);
      connectSocket(result.access_token);

      if (result.user.isNew) {
        router.replace('/onboarding');
      } else {
        // Route by server-side onboarding progress — a returning driver who
        // never finished onboarding must resume it, never land on Home.
        try {
          const me = await api.get<{ status: string; onboardingStep: string }>('/drivers/me');
          router.replace(resolveDriverRoute(me) as never);
        } catch {
          router.replace('/onboarding');
        }
      }
    } catch (err: any) {
      if (err.code === 'AUTH_INVALID_OTP') {
        Alert.alert('Incorrect code', 'The code you entered is invalid or expired.');
        setOtp('');
      } else {
        Alert.alert('Error', 'Verification failed. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>BidiRide</Text>
        <Text style={styles.subtitle}>Driver App</Text>
        <Text style={styles.tagline}>Earn more. Drive smarter.</Text>

        {phase === 'phone' && (
          <>
            <Text style={styles.label}>Enter your phone number</Text>
            <View style={styles.phoneRow}>
              <Text style={styles.countryCode}>+1</Text>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(t) => setPhone(formatPhone(t))}
                placeholder="(201) 555-0100"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="phone-pad"
                maxLength={14}
                autoFocus
              />
            </View>
            <Text style={styles.disclaimer}>
              By continuing you agree to our Driver Terms of Service. Standard messaging rates apply.
            </Text>
            <TouchableOpacity
              style={[styles.button, (loading || phone.replace(/\D/g, '').length < 10) && styles.buttonDisabled]}
              onPress={sendOtp}
              disabled={loading || phone.replace(/\D/g, '').length < 10}
            >
              {loading ? (
                <ActivityIndicator color={Colors.primaryText} />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {phase === 'otp' && (
          <>
            <Text style={styles.label}>Enter verification code</Text>
            <Text style={styles.sublabel}>Sent to {phone}</Text>
            <TextInput
              ref={otpRef}
              style={styles.otpInput}
              value={otp}
              onChangeText={(t) => {
                const digits = t.replace(/\D/g, '').slice(0, 6);
                setOtp(digits);
                if (digits.length === 6) verifyOtp();
              }}
              placeholder="000000"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              textContentType="oneTimeCode"
            />
            <TouchableOpacity
              style={[styles.button, (loading || otp.length < 6) && styles.buttonDisabled]}
              onPress={verifyOtp}
              disabled={loading || otp.length < 6}
            >
              {loading ? (
                <ActivityIndicator color={Colors.primaryText} />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>
            <View style={styles.resendRow}>
              <TouchableOpacity onPress={resendCountdown > 0 ? undefined : sendOtp} disabled={resendCountdown > 0}>
                <Text style={[styles.resendText, resendCountdown > 0 && styles.resendDisabled]}>
                  {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.resendSep}> · </Text>
              <TouchableOpacity onPress={() => { setPhase('phone'); setOtp(''); }}>
                <Text style={styles.resendText}>Change number</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, padding: Spacing['2xl'], justifyContent: 'center' },
  logo: {
    color: Colors.primary,
    fontSize: 36,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: -1,
    marginBottom: 2,
  },
  subtitle: {
    color: Colors.gold,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    marginBottom: Spacing.xs,
  },
  tagline: { color: Colors.textSecondary, fontSize: Typography.size.base, marginBottom: Spacing['3xl'] },
  label: { color: Colors.text, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, marginBottom: Spacing.md },
  sublabel: { color: Colors.textSecondary, fontSize: Typography.size.base, marginBottom: Spacing.xl },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  countryCode: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    paddingHorizontal: Spacing.md,
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  phoneInput: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 16,
  },
  disclaimer: { color: Colors.textDisabled, fontSize: Typography.size.xs, lineHeight: 18, marginBottom: Spacing.xl },
  otpInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    color: Colors.text,
    fontSize: 32,
    fontWeight: Typography.weight.bold,
    textAlign: 'center',
    letterSpacing: 12,
    paddingVertical: Spacing.base,
    marginBottom: Spacing.xl,
    fontFamily: 'JetBrainsMono-Regular',
  },
  button: { backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Colors.primaryText, fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, gap: 4 },
  resendText: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  resendSep: { color: Colors.textDisabled, fontSize: Typography.size.sm },
  resendDisabled: { color: Colors.textDisabled },
});
