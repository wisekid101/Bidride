import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

function initialsOf(first: string, last: string): string {
  return ((first.trim()[0] ?? '') + (last.trim()[0] ?? '')).toUpperCase() || '?';
}

export function ProfileSetupScreen() {
  // flow=signup: brand-new rider — continue into the signup steps.
  // Otherwise (returning rider completing their profile): straight to Home.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const nextRoute = flow === 'signup' ? '/signup/payment' : '/(tabs)';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = firstName.trim().length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/riders/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
      });
    } catch {
      // Profile save is best-effort — still proceed
    } finally {
      setSaving(false);
      router.replace(nextRoute as never);
    }
  };

  const skip = () => {
    router.replace(nextRoute as never);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Welcome to BidiRide</Text>
        <Text style={styles.subtitle}>Tell us your name so drivers can greet you.</Text>

        {/* Profile photo placeholder — real upload ships with Phase B (S3
            credentials). No picker is offered until it can actually work. */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initialsOf(firstName, lastName)}</Text>
          </View>
          <Text style={styles.avatarHint}>
            Profile photos are coming soon — your initials represent you for now.
          </Text>
        </View>

        <Text style={styles.label}>First name</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Marcus"
          placeholderTextColor={Colors.textDisabled}
          autoFocus
          autoCapitalize="words"
        />

        <Text style={styles.label}>Last name <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Brown"
          placeholderTextColor={Colors.textDisabled}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Email <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={Colors.textDisabled}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.button, (!canSave || saving) && styles.buttonDisabled]}
          onPress={save}
          disabled={!canSave || saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Save & Continue</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={skip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing['2xl'], paddingTop: 80 },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.extrabold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  avatarSection: { alignItems: 'center', marginBottom: Spacing.xl },
  avatarPlaceholder: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  avatarInitials: {
    color: Colors.primaryText,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.bold,
  },
  avatarHint: {
    color: Colors.textDisabled,
    fontSize: Typography.size.xs,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  optional: {
    color: Colors.textDisabled,
    fontWeight: Typography.weight.regular,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: Typography.size.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: Spacing['2xl'],
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  skipBtn: { alignItems: 'center', marginTop: Spacing.lg, padding: Spacing.sm },
  skipText: { color: Colors.textSecondary, fontSize: Typography.size.sm },
});
