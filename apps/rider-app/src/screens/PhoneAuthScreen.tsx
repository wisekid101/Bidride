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
  SafeAreaView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { ScreenHeader } from '../components/ui/ScreenHeader';
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
      await api.post('/auth/send-otp', { phone: e164Phone, role: 'rider' });
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
      }>('/auth/verify-otp', { phone: e164Phone, code: otp, role: 'rider' });

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
      <SafeAreaView>
        <ScreenHeader />
      </SafeAreaView>
      <View style={styles.inner}>
        {/* Logo */}
        <Text style={styles.logo}>BidiRide</Text>
        <Text style={styles.appLabel}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={styles.tagline}>AI-powered rides. Fair prices. Fast.</Text>

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
              By continuing you agree to our Terms of Service and Privacy Policy.
              We'll send a verification code.
            </Text>
            {__DEV__ && (
              <Text style={styles.devNote}>
                DEV MODE — Code appears in the auth-service terminal log. No SMS is sent.
              </Text>
            )}
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
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
            <Text style={styles.sublabel}>
              Sent to {phone}
            </Text>
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
    marginBottom: Spacing.xs,
  },
  appLabel: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  tagline: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    marginBottom: Spacing['3xl'],
  },
  devNote: {
    color: Colors.gold,
    fontSize: Typography.size.xs,
    lineHeight: 16,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gold + '50',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  label: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.md,
  },
  sublabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    marginBottom: Spacing.xl,
  },
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
  disclaimer: {
    color: Colors.textDisabled,
    fontSize: Typography.size.xs,
    lineHeight: 18,
    marginBottom: Spacing.xl,
  },
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
    fontFamily: Typography.fontFamilyMono,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, gap: 4 },
  resendText: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  resendSep: { color: Colors.textDisabled, fontSize: Typography.size.sm },
  resendDisabled: { color: Colors.textDisabled },
});
