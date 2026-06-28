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
import { useNavigation } from '@react-navigation/native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

export function ProfileSetupScreen() {
  const navigation = useNavigation<any>();
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
      // Profile save is best-effort — still proceed to Home
    } finally {
      setSaving(false);
      navigation.replace('Home');
    }
  };

  const skip = () => {
    navigation.replace('Home');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Welcome to BidRide</Text>
        <Text style={styles.subtitle}>Tell us your name so drivers can greet you.</Text>

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
    marginBottom: Spacing['3xl'],
    lineHeight: 22,
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
