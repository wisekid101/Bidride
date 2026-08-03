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
import { router, useLocalSearchParams } from 'expo-router';
import { Colors, Fonts, Typography, Spacing } from '../constants/theme';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { BrandMark } from '../components/ui/BrandMark';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { OtpInput } from '../components/ui/OtpInput';
import { InlineBanner } from '../components/ui/Feedback';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth.store';
import { useSocketStore } from '../store/socket.store';

type AuthPhase = 'phone' | 'otp';

export function PhoneAuthScreen() {
  // Sign Up and Log In share the same OTP backend — intent only changes copy.
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const isSignup = intent === 'signup';

  const { setTokens } = useAuthStore();
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
      await api.post('/auth/send-otp', { phone: e164Phone, role: 'rider' });
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
      }>('/auth/verify-otp', { phone: e164Phone, code, role: 'rider' });

      await setTokens(result.access_token, result.refresh_token, result.user.id);
      useSocketStore.getState().connect(result.access_token);

      if (result.user.isNew) {
        router.replace({ pathname: '/profile-setup', params: { flow: 'signup' } });
      } else {
        // Returning rider with an incomplete profile (skipped setup or created
        // via support) still needs a name on file — send them to setup once.
        try {
          const me = await api.get<{ firstName: string | null }>('/riders/me');
          if (!me.firstName) {
            router.replace('/profile-setup');
            return;
          }
        } catch {
          // Profile check is best-effort — never block login on it
        }
        router.replace('/(tabs)');
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
      <SafeAreaView>
        <ScreenHeader />
      </SafeAreaView>
      <View style={styles.inner}>
        <BrandMark layout="horizontal" size="sm" style={styles.brand} />
        <Text style={styles.title}>
          {phase === 'phone'
            ? isSignup ? 'Create your account' : 'Welcome back'
            : 'Enter your code'}
        </Text>
        <Text style={styles.subtitle}>
          {phase === 'phone'
            ? 'AI-powered rides. Fair prices. Fast.'
            : `We sent a 6-digit code to ${phone}`}
        </Text>

        {error && <InlineBanner variant="error" message={error} style={styles.banner} />}

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
              helper="We'll text you a verification code. Standard rates may apply."
            />
            <Text style={styles.disclaimer}>
              By continuing you agree to our Terms of Service and Privacy Policy.
            </Text>
            {__DEV__ && (
              <View style={styles.devNote}>
                <Text style={styles.devNoteText}>
                  DEV MODE — the code prints in the auth-service terminal log. No SMS is sent.
                </Text>
              </View>
            )}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, padding: Spacing['2xl'], justifyContent: 'center' },
  brand: { marginBottom: Spacing.xl },
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
  disclaimer: {
    color: Colors.textTertiary,
    fontSize: Typography.size.xs,
    fontFamily: Fonts.sans,
    lineHeight: 17,
    marginBottom: Spacing.md,
  },
  devNote: {
    borderWidth: 1,
    borderColor: Colors.gold + '50',
    backgroundColor: Colors.gold + '14',
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
  },
  devNoteText: { color: Colors.gold, fontSize: Typography.size.xs, fontFamily: Fonts.sansMedium, lineHeight: 16 },
  cta: { marginTop: Spacing.sm },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xl },
  resendText: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontFamily: Fonts.sansMedium },
  resendLink: { color: Colors.primary, fontSize: Typography.size.sm, fontFamily: Fonts.sansSemiBold },
  resendSep: { color: Colors.textDisabled, fontSize: Typography.size.sm },
  resendDisabled: { color: Colors.textDisabled },
});
