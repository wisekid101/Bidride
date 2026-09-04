import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors, Fonts, Typography, Spacing } from '../constants/theme';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

function initialsOf(first: string, last: string): string {
  return ((first.trim()[0] ?? '') + (last.trim()[0] ?? '')).toUpperCase() || '?';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProfileSetupScreen() {
  // flow=signup: brand-new rider — continue into the signup steps.
  // Otherwise (returning rider completing their profile): straight to Home.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const nextRoute = flow === 'signup' ? '/signup/payment' : '/(tabs)';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const firstNameError = touched && firstName.trim().length === 0 ? 'Please enter your first name.' : null;
  const emailError = touched && email.trim().length > 0 && !EMAIL_RE.test(email.trim())
    ? 'Please enter a valid email address.'
    : null;
  const canSave = firstName.trim().length > 0 && !emailError;

  const save = async () => {
    setTouched(true);
    if (firstName.trim().length === 0 || (email.trim().length > 0 && !EMAIL_RE.test(email.trim()))) {
      return;
    }
    setSaving(true);
    try {
      await api.patch('/riders/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
      });
    } catch {
      // Profile save is best-effort — still proceed so a new rider is never blocked
    } finally {
      setSaving(false);
      router.replace(nextRoute as never);
    }
  };

  const skip = () => router.replace(nextRoute as never);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Complete your profile</Text>
        <Text style={styles.subtitle}>Tell us your name so drivers can greet you by name.</Text>

        {/* Profile photo placeholder — real upload ships later. No picker is
            offered until it can actually work (honest state, not a fake button). */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initialsOf(firstName, lastName)}</Text>
          </View>
          <Text style={styles.avatarHint}>
            Profile photos are coming soon — your initials represent you for now.
          </Text>
        </View>

        <Input
          label="First name"
          icon="person-outline"
          value={firstName}
          onChangeText={setFirstName}
          error={firstNameError}
          placeholder="Marcus"
          autoFocus
          autoCapitalize="words"
          returnKeyType="next"
        />

        <Input
          label="Last name"
          optional
          icon="person-outline"
          value={lastName}
          onChangeText={setLastName}
          placeholder="Brown"
          autoCapitalize="words"
          returnKeyType="next"
        />

        <Input
          label="Email"
          optional
          icon="mail-outline"
          value={email}
          onChangeText={setEmail}
          error={emailError}
          helper="For receipts and trip history. We never share it."
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <Button
          title="Save & continue"
          onPress={save}
          loading={saving}
          disabled={!canSave}
          icon="arrow-forward"
          iconPosition="right"
          style={styles.cta}
        />
        <Button title="Skip for now" variant="ghost" onPress={skip} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing['2xl'], paddingTop: 72, paddingBottom: Spacing['2xl'] },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    fontFamily: Fonts.sans,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  avatarSection: { alignItems: 'center', marginBottom: Spacing.xl },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  avatarInitials: {
    color: Colors.primaryText,
    fontSize: Typography.size['2xl'],
    fontFamily: Fonts.sansBold,
  },
  avatarHint: {
    color: Colors.textTertiary,
    fontSize: Typography.size.xs,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    lineHeight: 16,
  },
  cta: { marginTop: Spacing.lg },
});
