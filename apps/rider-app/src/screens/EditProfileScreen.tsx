import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { api } from '../api/client';

interface RiderProfile {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

function initialsOf(first: string, last: string): string {
  return ((first.trim()[0] ?? '') + (last.trim()[0] ?? '')).toUpperCase() || '?';
}

export function EditProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RiderProfile>('/riders/me')
      .then((p) => {
        setFirstName(p.firstName ?? '');
        setLastName(p.lastName ?? '');
        setEmail(p.email ?? '');
        setPhone(p.phone);
      })
      .catch(() => Alert.alert('Error', 'Could not load your profile.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!firstName.trim()) {
      Alert.alert('First name required', 'Please enter your first name.');
      return;
    }
    setSaving(true);
    try {
      await api.patch('/riders/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
      });
      router.back();
    } catch (err: any) {
      if (err.status === 409) {
        Alert.alert('Email in use', 'That email is already linked to another account.');
      } else {
        Alert.alert('Error', 'Could not save your profile. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Photo upload ships with Phase B (S3 credentials) — initials only until then */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initialsOf(firstName, lastName)}</Text>
          </View>
          <Text style={styles.avatarHint}>Profile photos are coming soon.</Text>
        </View>

        <Text style={styles.label}>First name</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name"
          placeholderTextColor={Colors.textDisabled}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Last name</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last name"
          placeholderTextColor={Colors.textDisabled}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={Colors.textDisabled}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Phone</Text>
        <View style={[styles.input, styles.inputDisabled]}>
          <Text style={styles.phoneText}>{phone ?? '—'}</Text>
        </View>
        <Text style={styles.fieldHint}>
          Your phone number is your login and can't be changed here.
        </Text>

        <Button
          title="Save Changes"
          onPress={save}
          loading={saving}
          disabled={!firstName.trim()}
          style={styles.saveBtn}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { marginTop: 80 },
  scroll: { padding: Spacing.xl, paddingBottom: Spacing['3xl'] },
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
  avatarHint: { color: Colors.textDisabled, fontSize: Typography.size.xs },
  label: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
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
  inputDisabled: { opacity: 0.6 },
  phoneText: { color: Colors.textSecondary, fontSize: Typography.size.md },
  fieldHint: {
    color: Colors.textDisabled,
    fontSize: Typography.size.xs,
    marginTop: Spacing.xs,
  },
  saveBtn: { marginTop: Spacing['2xl'] },
});
