import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Typography, Spacing } from '../constants/theme';
import { BrandMark } from '../components/ui/BrandMark';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { OtpInput } from '../components/ui/OtpInput';
import { InlineBanner } from '../components/ui/Feedback';
import { api } from '../api/client';
import { useDriverStore } from '../store/driver.store';
import { useDriverSocketStore } from '../store/socket.store';
import { resolveResumeRoute } from '../utils/onboardingPlan';

type AuthPhase = 'phone' | 'otp';

export function DriverAuthScreen() {
  const router = useRouter();
  const { setTokens } = useDriverStore();
  const sessionExpired = useDriverStore((s) => s.sessionExpired);
  const connectSocket = useDriverSocketStore((s) => s.connect);
  const [phase, setPhase] = useState<AuthPhase>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const otpRef = useRef<TextInput>(null);

  const formatPhone = (raw: string): string => {
    const d = raw.replace(/\D/g, '');
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  };

  const digits = phone.replace(/\D/g, '');
  const phoneValid = digits.length === 10;
  const e164Phone = `+1${digits}`;

  const startResendTimer = () => {
    setResendCountdown(30);
    const interval = setInterval(() => {
      setResendCountdown((c) => {
        if (c <= 1) { clearInterval(interval); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    if (!phoneValid) {
      setError('Please enter a valid 10-digit US phone number.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/send-otp', { phone: e164Phone, role: 'driver' });
      setPhase('otp');
      setTimeout(() => otpRef.current?.focus(), 300);
      startResendTimer();
    } catch (err: any) {
      if (err.code === 'AUTH_OTP_RATE_LIMITED') {
        setError('Too many attempts. Please wait 10 minutes before requesting a new code.');
      } else {
        setError('Could not send your verification code. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (code = otp) => {
    if (code.length < 6) return;
    setError(null);
    setLoading(true);
    try {
      const result = await api.post<{
        access_token: string;
        refresh_token: string;
        user: { id: string; role: string; isNew: boolean };
      }>('/auth/verify-otp', { phone: e164Phone, code, role: 'driver' });

      await setTokens(result.access_token, result.refresh_token, result.user.id);
      connectSocket(result.access_token);

      if (result.user.isNew) {
        router.replace('/onboarding');
      } else {
        // Route by server-side onboarding progress — a returning driver who
        // never finished onboarding must resume it, never land on Home. Uses
        // the shared retrying resolver so a single flaky /drivers/me right after
        // OTP never mis-routes an approved or in-progress driver.
        const route = await resolveResumeRoute(api.get);
        router.replace((route ?? '/onboarding') as never);
      }
    } catch (err: any) {
      if (err.code === 'AUTH_INVALID_OTP') {
        setError('That code is invalid or expired. Please try again.');
        setOtp('');
      } else {
        setError('Verification failed. Please try again.');
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
      <SafeAreaView style={styles.flex}>
        <View style={styles.inner}>
          <View style={styles.brandRow}>
            <BrandMark layout="horizontal" size="sm" />
            <View style={styles.driverBadge}>
              <Text style={styles.driverBadgeText}>DRIVER</Text>
            </View>
          </View>
          <Text style={styles.title}>
            {phase === 'phone' ? 'Drive with Bidiride' : 'Enter your code'}
          </Text>
          <Text style={styles.subtitle}>
            {phase === 'phone'
              ? 'Earn more. Drive smarter. Get paid instantly.'
              : `We sent a 6-digit code to ${phone}`}
          </Text>

          {error && <InlineBanner variant="error" message={error} style={styles.banner} />}
          {!error && phase === 'phone' && sessionExpired && (
            <InlineBanner variant="warning" message="Your session expired. Please sign in again." style={styles.banner} />
          )}

          {phase === 'phone' && (
            <>
              <Input
                label="Phone number"
                icon="call-outline"
                prefix="+1"
                value={phone}
                onChangeText={(t) => { setPhone(formatPhone(t)); if (error) setError(null); }}
                placeholder="(201) 555-0100"
                keyboardType="phone-pad"
                maxLength={14}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={sendOtp}
                helper="By continuing you agree to our Driver Terms of Service."
              />
              <Button
                title="Continue"
                onPress={sendOtp}
                loading={loading}
                disabled={!phoneValid}
                icon="arrow-forward"
                iconPosition="right"
                style={styles.cta}
              />
            </>
          )}

          {phase === 'otp' && (
            <>
              <OtpInput
                ref={otpRef}
                value={otp}
                error={!!error}
                autoFocus
                onChangeText={(v) => {
                  setOtp(v);
                  if (error) setError(null);
                  if (v.length === 6) verifyOtp(v);
                }}
              />
              <Button
                title="Verify"
                onPress={() => verifyOtp()}
                loading={loading}
                disabled={otp.length < 6}
                style={styles.cta}
              />
              <View style={styles.resendRow}>
                <TouchableOpacity
                  onPress={resendCountdown > 0 ? undefined : sendOtp}
                  disabled={resendCountdown > 0}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: resendCountdown > 0 }}
                >
                  <Text style={[styles.resendText, resendCountdown > 0 && styles.resendDisabled]}>
                    {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.resendSep}> · </Text>
                <TouchableOpacity
                  onPress={() => { setPhase('phone'); setOtp(''); setError(null); }}
                  accessibilityRole="button"
                >
                  <Text style={styles.resendLink}>Change number</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  inner: { flex: 1, padding: Spacing['2xl'], justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xl },
  driverBadge: {
    backgroundColor: Colors.primarySoft,
    borderColor: Colors.primarySoftBorder,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  driverBadgeText: { color: Colors.primary, fontSize: Typography.size.xs, fontFamily: Fonts.sansBold, letterSpacing: 1.2 },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: -0.5,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    fontFamily: Fonts.sans,
    marginBottom: Spacing.xl,
    lineHeight: 21,
  },
  banner: { marginBottom: Spacing.lg },
  cta: { marginTop: Spacing.sm },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xl },
  resendText: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontFamily: Fonts.sansMedium },
  resendLink: { color: Colors.primary, fontSize: Typography.size.sm, fontFamily: Fonts.sansSemiBold },
  resendSep: { color: Colors.textDisabled, fontSize: Typography.size.sm },
  resendDisabled: { color: Colors.textDisabled },
});
