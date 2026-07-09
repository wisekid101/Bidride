import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Colors, Typography } from '../../constants/theme';
import { useDriverStore } from '../../store/driver.store';
import { router } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

export default function PersonalInfoScreen() {
  const { accessToken } = useDriverStore();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    legalFirstName: '',
    legalLastName: '',
    dateOfBirth: '',
    streetAddress: '',
    city: '',
    state: '',
    zipCode: '',
    ssn: '',
    licenseNumber: '',
    licenseState: '',
    licenseExpiry: '',
    insuranceProvider: '',
    insurancePolicyNumber: '',
    insuranceExpiry: '',
  });

  const update = (key: keyof typeof form) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const isValid = () =>
    form.legalFirstName &&
    form.legalLastName &&
    form.dateOfBirth.match(/^\d{2}\/\d{2}\/\d{4}$/) &&
    form.streetAddress &&
    form.city &&
    form.state.length === 2 &&
    form.zipCode.match(/^\d{5}$/) &&
    form.ssn.length === 9 &&
    form.licenseNumber.match(/^[A-Za-z0-9]{5,20}$/) &&
    form.licenseState.length === 2 &&
    form.licenseExpiry.match(/^\d{2}\/\d{2}\/\d{4}$/) &&
    form.insuranceProvider &&
    form.insurancePolicyNumber &&
    form.insuranceExpiry.match(/^\d{2}\/\d{2}\/\d{4}$/);

  const toIso = (mmddyyyy: string) => {
    const [month, day, year] = mmddyyyy.split('/');
    return `${year}-${month}-${day}`;
  };

  const submit = async () => {
    if (!isValid()) {
      Alert.alert('Incomplete', 'Please fill in all required fields correctly.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/drivers/me/personal-info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          legalFirstName: form.legalFirstName,
          legalLastName: form.legalLastName,
          dateOfBirth: toIso(form.dateOfBirth),
          streetAddress: form.streetAddress,
          city: form.city,
          state: form.state.toUpperCase(),
          zipCode: form.zipCode,
          ssn: form.ssn,
          licenseNumber: form.licenseNumber.toUpperCase(),
          licenseState: form.licenseState.toUpperCase(),
          licenseExpiry: toIso(form.licenseExpiry),
          insuranceProvider: form.insuranceProvider,
          insurancePolicyNumber: form.insurancePolicyNumber,
          insuranceExpiry: toIso(form.insuranceExpiry),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Submission failed');
      }

      router.push('/onboarding/document-upload');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.step}>Step 1 of 6</Text>
          <Text style={styles.title}>Personal Information</Text>
          <Text style={styles.subtitle}>
            We need your legal name and address for background verification.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.row}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Legal First Name</Text>
              <TextInput
                style={styles.input}
                value={form.legalFirstName}
                onChangeText={update('legalFirstName')}
                placeholder="First name"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Legal Last Name</Text>
              <TextInput
                style={styles.input}
                value={form.legalLastName}
                onChangeText={update('legalLastName')}
                placeholder="Last name"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="words"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Date of Birth</Text>
            <TextInput
              style={styles.input}
              value={form.dateOfBirth}
              onChangeText={update('dateOfBirth')}
              placeholder="MM/DD/YYYY"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="numeric"
              maxLength={10}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Social Security Number</Text>
            <TextInput
              style={styles.input}
              value={form.ssn}
              onChangeText={update('ssn')}
              placeholder="9 digits (no dashes)"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="numeric"
              maxLength={9}
              secureTextEntry
            />
            <Text style={styles.hint}>Used only for background check. Not stored.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Street Address</Text>
            <TextInput
              style={styles.input}
              value={form.streetAddress}
              onChangeText={update('streetAddress')}
              placeholder="123 Main St"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                value={form.city}
                onChangeText={update('city')}
                placeholder="City"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>State</Text>
              <TextInput
                style={styles.input}
                value={form.state}
                onChangeText={update('state')}
                placeholder="NJ"
                placeholderTextColor={Colors.textTertiary}
                maxLength={2}
                autoCapitalize="characters"
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>ZIP</Text>
              <TextInput
                style={styles.input}
                value={form.zipCode}
                onChangeText={update('zipCode')}
                placeholder="07001"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                maxLength={5}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.label}>Driver License #</Text>
              <TextInput
                style={styles.input}
                value={form.licenseNumber}
                onChangeText={update('licenseNumber')}
                placeholder="License number"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="characters"
                maxLength={20}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>State</Text>
              <TextInput
                style={styles.input}
                value={form.licenseState}
                onChangeText={update('licenseState')}
                placeholder="NJ"
                placeholderTextColor={Colors.textTertiary}
                maxLength={2}
                autoCapitalize="characters"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>License Expiration</Text>
            <TextInput
              style={styles.input}
              value={form.licenseExpiry}
              onChangeText={update('licenseExpiry')}
              placeholder="MM/DD/YYYY"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="numeric"
              maxLength={10}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Insurance Provider</Text>
            <TextInput
              style={styles.input}
              value={form.insuranceProvider}
              onChangeText={update('insuranceProvider')}
              placeholder="e.g. GEICO, Progressive"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.label}>Policy Number</Text>
              <TextInput
                style={styles.input}
                value={form.insurancePolicyNumber}
                onChangeText={update('insurancePolicyNumber')}
                placeholder="Policy number"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="characters"
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Expires</Text>
              <TextInput
                style={styles.input}
                value={form.insuranceExpiry}
                onChangeText={update('insuranceExpiry')}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                maxLength={10}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, !isValid() && styles.continueBtnDisabled]}
          onPress={submit}
          disabled={!isValid() || loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.continueBtnText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1, paddingHorizontal: 24 },
  header: { paddingTop: 24, marginBottom: 32 },
  step: { fontSize: 12, color: Colors.teal, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },
  form: { gap: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hint: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  footer: { padding: 24, paddingBottom: 32 },
  continueBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
