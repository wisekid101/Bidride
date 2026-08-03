import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Colors, Fonts, Spacing, Typography } from '../../constants/theme';
import { router } from 'expo-router';
import { OnboardingHeader } from './OnboardingHeader';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { InlineBanner } from '../../components/ui/Feedback';
import { api } from '../../api/client';

type Field =
  | 'legalFirstName' | 'legalLastName' | 'dateOfBirth' | 'streetAddress'
  | 'city' | 'state' | 'zipCode' | 'ssn' | 'licenseNumber' | 'licenseState'
  | 'licenseExpiry' | 'insuranceProvider' | 'insurancePolicyNumber' | 'insuranceExpiry';

const EMPTY: Record<Field, string> = {
  legalFirstName: '', legalLastName: '', dateOfBirth: '', streetAddress: '',
  city: '', state: '', zipCode: '', ssn: '', licenseNumber: '', licenseState: '',
  licenseExpiry: '', insuranceProvider: '', insurancePolicyNumber: '', insuranceExpiry: '',
};

// MM/DD/YYYY → real Date or null (rejects impossible dates like 13/40/2000).
function parseUsDate(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return null;
  return d;
}
function ageYears(d: Date): number {
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}
function toIso(mmddyyyy: string): string {
  const [month, day, year] = mmddyyyy.split('/');
  return `${year}-${month}-${day}`;
}

// Field-level validation — mirrors the backend rules so errors are helpful.
function validate(form: Record<Field, string>): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!form.legalFirstName.trim()) e.legalFirstName = 'Enter your legal first name';
  if (!form.legalLastName.trim()) e.legalLastName = 'Enter your legal last name';

  const dob = parseUsDate(form.dateOfBirth);
  if (!form.dateOfBirth) e.dateOfBirth = 'Enter your date of birth';
  else if (!dob) e.dateOfBirth = 'Use MM/DD/YYYY';
  else if (ageYears(dob) < 21) e.dateOfBirth = 'You must be at least 21 to drive';

  if (!form.streetAddress.trim()) e.streetAddress = 'Enter your street address';
  if (!form.city.trim()) e.city = 'Enter your city';
  if (!/^[A-Za-z]{2}$/.test(form.state)) e.state = '2-letter state';
  if (!/^\d{5}$/.test(form.zipCode)) e.zipCode = '5-digit ZIP';
  if (!/^\d{9}$/.test(form.ssn)) e.ssn = 'SSN must be 9 digits';

  if (!/^[A-Za-z0-9]{5,20}$/.test(form.licenseNumber)) e.licenseNumber = 'Enter a valid license number';
  if (!/^[A-Za-z]{2}$/.test(form.licenseState)) e.licenseState = '2-letter state';
  const lic = parseUsDate(form.licenseExpiry);
  if (!form.licenseExpiry) e.licenseExpiry = 'Enter the expiry date';
  else if (!lic) e.licenseExpiry = 'Use MM/DD/YYYY';
  else if (lic <= new Date()) e.licenseExpiry = 'License is expired';

  if (!form.insuranceProvider.trim()) e.insuranceProvider = 'Enter your insurer';
  if (!form.insurancePolicyNumber.trim()) e.insurancePolicyNumber = 'Enter your policy number';
  const ins = parseUsDate(form.insuranceExpiry);
  if (!form.insuranceExpiry) e.insuranceExpiry = 'Enter the expiry date';
  else if (!ins) e.insuranceExpiry = 'Use MM/DD/YYYY';
  else if (ins <= new Date()) e.insuranceExpiry = 'Insurance is expired';

  return e;
}

// Map a backend error message onto the most relevant field so the retry is targeted.
function mapServerError(msg: string): { field?: Field; message: string } {
  const m = msg.toLowerCase();
  if (m.includes('21 years')) return { field: 'dateOfBirth', message: msg };
  if (m.includes('license is expired')) return { field: 'licenseExpiry', message: msg };
  if (m.includes('insurance')) return { field: 'insuranceExpiry', message: msg };
  if (m.includes('license') && m.includes('registered')) return { field: 'licenseNumber', message: msg };
  return { message: msg };
}

export default function PersonalInfoScreen() {
  const [form, setForm] = useState<Record<Field, string>>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverFieldError, setServerFieldError] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errors = validate(form);
  const errorFor = (f: Field) =>
    (touched[f] ? errors[f] : undefined) ?? serverFieldError[f];

  const set = (f: Field, sanitize?: (v: string) => string) => (v: string) => {
    setForm((prev) => ({ ...prev, [f]: sanitize ? sanitize(v) : v }));
    if (serverFieldError[f]) setServerFieldError((p) => ({ ...p, [f]: undefined }));
    if (submitError) setSubmitError(null);
  };
  const blur = (f: Field) => () => setTouched((p) => ({ ...p, [f]: true }));

  const submit = async () => {
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])) as Record<Field, boolean>);
    setServerFieldError({});
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      // api client attaches the bearer token and auto-refreshes on 401.
      await api.post('/drivers/me/personal-info', {
        legalFirstName: form.legalFirstName.trim(),
        legalLastName: form.legalLastName.trim(),
        dateOfBirth: toIso(form.dateOfBirth),
        streetAddress: form.streetAddress.trim(),
        city: form.city.trim(),
        state: form.state.toUpperCase(),
        zipCode: form.zipCode,
        ssn: form.ssn, // never logged/stored; redacted server-side, secureTextEntry client-side
        licenseNumber: form.licenseNumber.toUpperCase(),
        licenseState: form.licenseState.toUpperCase(),
        licenseExpiry: toIso(form.licenseExpiry),
        insuranceProvider: form.insuranceProvider.trim(),
        insurancePolicyNumber: form.insurancePolicyNumber.trim(),
        insuranceExpiry: toIso(form.insuranceExpiry),
      });
      // Founder-approved visible order: Personal → Vehicle.
      router.push('/onboarding/vehicle-info');
    } catch (err: any) {
      const mapped = mapServerError(err?.message ?? 'Submission failed. Please try again.');
      if (mapped.field) setServerFieldError({ [mapped.field]: mapped.message });
      setSubmitError(mapped.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHeader route="/onboarding/personal-info" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Personal Information</Text>
          <Text style={styles.subtitle}>We use this for identity and background verification. Your SSN is never stored or shown.</Text>

          {submitError && <InlineBanner variant="error" message={submitError} style={styles.banner} />}

          <View style={styles.row}>
            <Input containerStyle={styles.half} label="Legal first name" value={form.legalFirstName}
              onChangeText={set('legalFirstName')} onBlur={blur('legalFirstName')} error={errorFor('legalFirstName')}
              placeholder="First" autoCapitalize="words" />
            <Input containerStyle={styles.half} label="Legal last name" value={form.legalLastName}
              onChangeText={set('legalLastName')} onBlur={blur('legalLastName')} error={errorFor('legalLastName')}
              placeholder="Last" autoCapitalize="words" />
          </View>

          <Input label="Date of birth" icon="calendar-outline" value={form.dateOfBirth}
            onChangeText={set('dateOfBirth', (v) => v.replace(/[^\d/]/g, '').slice(0, 10))}
            onBlur={blur('dateOfBirth')} error={errorFor('dateOfBirth')} placeholder="MM/DD/YYYY"
            keyboardType="number-pad" helper="You must be at least 21." />

          <Input label="Social Security Number" icon="lock-closed-outline" value={form.ssn}
            onChangeText={set('ssn', (v) => v.replace(/\D/g, '').slice(0, 9))} onBlur={blur('ssn')}
            error={errorFor('ssn')} placeholder="9 digits" keyboardType="number-pad" secureTextEntry
            helper="Used only for the background check — never stored or displayed." />

          <Input label="Street address" icon="home-outline" value={form.streetAddress}
            onChangeText={set('streetAddress')} onBlur={blur('streetAddress')} error={errorFor('streetAddress')}
            placeholder="100 Market St" autoCapitalize="words" />
          <View style={styles.row}>
            <Input containerStyle={styles.flex2} label="City" value={form.city} onChangeText={set('city')}
              onBlur={blur('city')} error={errorFor('city')} placeholder="Newark" autoCapitalize="words" />
            <Input containerStyle={styles.stateBox} label="State" value={form.state}
              onChangeText={set('state', (v) => v.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))}
              onBlur={blur('state')} error={errorFor('state')} placeholder="NJ" autoCapitalize="characters" />
            <Input containerStyle={styles.zipBox} label="ZIP" value={form.zipCode}
              onChangeText={set('zipCode', (v) => v.replace(/\D/g, '').slice(0, 5))} onBlur={blur('zipCode')}
              error={errorFor('zipCode')} placeholder="07102" keyboardType="number-pad" />
          </View>

          <Text style={styles.section}>Driver's license</Text>
          <View style={styles.row}>
            <Input containerStyle={styles.flex2} label="License number" value={form.licenseNumber}
              onChangeText={set('licenseNumber', (v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20))}
              onBlur={blur('licenseNumber')} error={errorFor('licenseNumber')} placeholder="D1234567" autoCapitalize="characters" />
            <Input containerStyle={styles.stateBox} label="State" value={form.licenseState}
              onChangeText={set('licenseState', (v) => v.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))}
              onBlur={blur('licenseState')} error={errorFor('licenseState')} placeholder="NJ" autoCapitalize="characters" />
          </View>
          <Input label="License expiry" icon="calendar-outline" value={form.licenseExpiry}
            onChangeText={set('licenseExpiry', (v) => v.replace(/[^\d/]/g, '').slice(0, 10))}
            onBlur={blur('licenseExpiry')} error={errorFor('licenseExpiry')} placeholder="MM/DD/YYYY" keyboardType="number-pad" />

          <Text style={styles.section}>Insurance</Text>
          <Input label="Insurance provider" value={form.insuranceProvider} onChangeText={set('insuranceProvider')}
            onBlur={blur('insuranceProvider')} error={errorFor('insuranceProvider')} placeholder="Geico" autoCapitalize="words" />
          <View style={styles.row}>
            <Input containerStyle={styles.flex2} label="Policy number" value={form.insurancePolicyNumber}
              onChangeText={set('insurancePolicyNumber')} onBlur={blur('insurancePolicyNumber')}
              error={errorFor('insurancePolicyNumber')} placeholder="POL-123456" autoCapitalize="characters" />
            <Input containerStyle={styles.flex1} label="Expiry" value={form.insuranceExpiry}
              onChangeText={set('insuranceExpiry', (v) => v.replace(/[^\d/]/g, '').slice(0, 10))}
              onBlur={blur('insuranceExpiry')} error={errorFor('insuranceExpiry')} placeholder="MM/DD/YYYY" keyboardType="number-pad" />
          </View>

          <Button title="Continue" onPress={submit} loading={loading} icon="arrow-forward" iconPosition="right" style={styles.cta} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing['3xl'] },
  title: { color: Colors.text, fontSize: Typography.size['2xl'], fontFamily: Fonts.sansExtraBold, letterSpacing: -0.5, marginTop: Spacing.sm },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontFamily: Fonts.sans, lineHeight: 20, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  banner: { marginBottom: Spacing.base },
  section: { color: Colors.text, fontSize: Typography.size.md, fontFamily: Fonts.sansBold, marginTop: Spacing.sm, marginBottom: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.md },
  half: { flex: 1 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  stateBox: { width: 74 },
  zipBox: { width: 96 },
  cta: { marginTop: Spacing.lg },
});
