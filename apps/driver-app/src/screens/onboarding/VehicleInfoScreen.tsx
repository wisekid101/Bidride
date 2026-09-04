import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing, Typography } from '../../constants/theme';
import { router } from 'expo-router';
import { OnboardingHeader } from './OnboardingHeader';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { InlineBanner } from '../../components/ui/Feedback';
import { api } from '../../api/client';

const MIN_YEAR = new Date().getFullYear() - 10; // backend rejects older than this

const VEHICLE_CLASSES = [
  { key: 'standard', label: 'Standard', desc: 'Sedan, SUV, or compact' },
  { key: 'xl', label: 'XL', desc: 'Minivan or full-size SUV (6+ seats)' },
  { key: 'premium', label: 'Premium', desc: 'Luxury sedan or SUV' },
  { key: 'black', label: 'Black Car', desc: 'Premium black car service' },
];

type Field = 'make' | 'model' | 'year' | 'color' | 'licensePlate' | 'licensePlateState' | 'vin';
const EMPTY: Record<Field, string> = {
  make: '', model: '', year: '', color: '', licensePlate: '', licensePlateState: '', vin: '',
};

function validate(form: Record<Field, string>): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!form.make.trim()) e.make = 'Enter the make';
  if (!form.model.trim()) e.model = 'Enter the model';
  if (!/^\d{4}$/.test(form.year)) e.year = 'Enter a 4-digit year';
  else if (Number(form.year) < MIN_YEAR) e.year = `Must be ${MIN_YEAR} or newer`;
  else if (Number(form.year) > new Date().getFullYear() + 1) e.year = 'Enter a valid year';
  if (!form.color.trim()) e.color = 'Enter the color';
  if (!form.licensePlate.trim()) e.licensePlate = 'Enter the plate';
  if (!/^[A-Za-z]{2}$/.test(form.licensePlateState)) e.licensePlateState = '2-letter state';
  if (form.vin.length !== 17) e.vin = 'VIN must be 17 characters';
  return e;
}

export default function VehicleInfoScreen() {
  const [vehicleClass, setVehicleClass] = useState('standard');
  const [form, setForm] = useState<Record<Field, string>>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverFieldError, setServerFieldError] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errors = validate(form);
  const errorFor = (f: Field) => (touched[f] ? errors[f] : undefined) ?? serverFieldError[f];

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
      await api.post('/vehicles', {
        make: form.make.trim(),
        model: form.model.trim(),
        year: parseInt(form.year, 10),
        color: form.color.trim(),
        licensePlate: form.licensePlate.trim().toUpperCase(),
        licensePlateState: form.licensePlateState.toUpperCase(),
        vin: form.vin.toUpperCase(),
        vehicleClass,
      });
      // Founder-approved visible order: Vehicle → Documents (next honest boundary).
      router.push('/onboarding/document-upload');
    } catch (err: any) {
      const msg = err?.message ?? 'Could not add your vehicle. Please try again.';
      // Duplicate VIN is the most common controlled failure — target the field.
      if (String(msg).toLowerCase().includes('already registered')) {
        setServerFieldError({ vin: 'This VIN is already registered' });
      }
      setSubmitError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHeader route="/onboarding/vehicle-info" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Your Vehicle</Text>
          <Text style={styles.subtitle}>You can add more vehicles later. Your vehicle must be a {MIN_YEAR} or newer model.</Text>

          {submitError && <InlineBanner variant="error" message={submitError} style={styles.banner} />}

          <Text style={styles.section}>Vehicle class</Text>
          <View style={styles.classGrid}>
            {VEHICLE_CLASSES.map((vc) => {
              const selected = vehicleClass === vc.key;
              return (
                <Pressable
                  key={vc.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.classCard, selected && styles.classCardSelected]}
                  onPress={() => setVehicleClass(vc.key)}
                >
                  <Text style={[styles.classLabel, selected && styles.classLabelSelected]}>{vc.label}</Text>
                  <Text style={styles.classDesc}>{vc.desc}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <Input containerStyle={styles.half} label="Make" value={form.make} onChangeText={set('make')}
              onBlur={blur('make')} error={errorFor('make')} placeholder="Toyota" autoCapitalize="words" />
            <Input containerStyle={styles.half} label="Model" value={form.model} onChangeText={set('model')}
              onBlur={blur('model')} error={errorFor('model')} placeholder="Camry" autoCapitalize="words" />
          </View>
          <View style={styles.row}>
            <Input containerStyle={styles.half} label="Year" value={form.year}
              onChangeText={set('year', (v) => v.replace(/\D/g, '').slice(0, 4))} onBlur={blur('year')}
              error={errorFor('year')} placeholder="2020" keyboardType="number-pad" />
            <Input containerStyle={styles.half} label="Color" value={form.color} onChangeText={set('color')}
              onBlur={blur('color')} error={errorFor('color')} placeholder="Black" autoCapitalize="words" />
          </View>
          <View style={styles.row}>
            <Input containerStyle={styles.flex2} label="License plate" value={form.licensePlate}
              onChangeText={set('licensePlate', (v) => v.toUpperCase().slice(0, 10))} onBlur={blur('licensePlate')}
              error={errorFor('licensePlate')} placeholder="ABC1234" autoCapitalize="characters" />
            <Input containerStyle={styles.stateBox} label="State" value={form.licensePlateState}
              onChangeText={set('licensePlateState', (v) => v.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2))}
              onBlur={blur('licensePlateState')} error={errorFor('licensePlateState')} placeholder="NJ" autoCapitalize="characters" />
          </View>
          <Input label="VIN" value={form.vin}
            onChangeText={set('vin', (v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 17))}
            onBlur={blur('vin')} error={errorFor('vin')} placeholder="1HGCM82633A123456" autoCapitalize="characters"
            helper="17 characters — found on your dashboard, door jamb, or registration." />

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
  section: { color: Colors.text, fontSize: Typography.size.md, fontFamily: Fonts.sansBold, marginBottom: Spacing.md },
  classGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.base },
  classCard: { flexGrow: 1, minWidth: '45%', backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  classCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  classLabel: { fontSize: Typography.size.base, fontFamily: Fonts.sansBold, color: Colors.text, marginBottom: 2 },
  classLabelSelected: { color: Colors.primary },
  classDesc: { fontSize: Typography.size.xs, fontFamily: Fonts.sans, color: Colors.textTertiary },
  row: { flexDirection: 'row', gap: Spacing.md },
  half: { flex: 1 },
  flex2: { flex: 2 },
  stateBox: { width: 74 },
  cta: { marginTop: Spacing.lg },
});
