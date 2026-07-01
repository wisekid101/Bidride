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
import { Colors } from '../../constants/theme';
import { useDriverStore } from '../../store/driver.store';
import { router } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

const VEHICLE_CLASSES = [
  { key: 'standard', label: 'Standard', desc: 'Sedan, SUV, or compact' },
  { key: 'xl', label: 'XL', desc: 'Minivan or full-size SUV (6+ seats)' },
  { key: 'premium', label: 'Premium', desc: 'Luxury sedan or SUV' },
  { key: 'black', label: 'Black Car', desc: 'Premium black car service' },
];

export default function VehicleInfoScreen() {
  const { accessToken } = useDriverStore();
  const [loading, setLoading] = useState(false);
  const [vehicleClass, setVehicleClass] = useState('standard');

  const [form, setForm] = useState({
    make: '',
    model: '',
    year: '',
    color: '',
    licensePlate: '',
    licensePlateState: '',
    vin: '',
  });

  const update = (key: keyof typeof form) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const isValid = () =>
    form.make &&
    form.model &&
    form.year.match(/^\d{4}$/) &&
    form.color &&
    form.licensePlate &&
    form.licensePlateState.length === 2 &&
    form.vin.length === 17;

  const submit = async () => {
    if (!isValid()) {
      Alert.alert('Incomplete', 'Please fill in all fields correctly. VIN must be 17 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/vehicles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...form,
          year: parseInt(form.year),
          licensePlateState: form.licensePlateState.toUpperCase(),
          vin: form.vin.toUpperCase(),
          vehicleClass,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Failed to add vehicle');
      }

      router.push('/onboarding/bank-account');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.step}>Step 4 of 6</Text>
          <Text style={styles.title}>Your Vehicle</Text>
          <Text style={styles.subtitle}>
            You can add additional vehicles later. Your vehicle must be a 2015 or newer model.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionLabel}>Vehicle Class</Text>
          <View style={styles.classGrid}>
            {VEHICLE_CLASSES.map((vc) => (
              <TouchableOpacity
                key={vc.key}
                style={[styles.classCard, vehicleClass === vc.key && styles.classCardSelected]}
                onPress={() => setVehicleClass(vc.key)}
              >
                <Text style={[styles.classLabel, vehicleClass === vc.key && styles.classLabelSelected]}>
                  {vc.label}
                </Text>
                <Text style={styles.classDesc}>{vc.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Make</Text>
              <TextInput
                style={styles.input}
                value={form.make}
                onChangeText={update('make')}
                placeholder="Toyota"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                style={styles.input}
                value={form.model}
                onChangeText={update('model')}
                placeholder="Camry"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Year</Text>
              <TextInput
                style={styles.input}
                value={form.year}
                onChangeText={update('year')}
                placeholder="2020"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                maxLength={4}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Color</Text>
              <TextInput
                style={styles.input}
                value={form.color}
                onChangeText={update('color')}
                placeholder="Black"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.label}>License Plate</Text>
              <TextInput
                style={styles.input}
                value={form.licensePlate}
                onChangeText={update('licensePlate')}
                placeholder="ABC1234"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="characters"
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>State</Text>
              <TextInput
                style={styles.input}
                value={form.licensePlateState}
                onChangeText={update('licensePlateState')}
                placeholder="NJ"
                placeholderTextColor={Colors.textTertiary}
                maxLength={2}
                autoCapitalize="characters"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>VIN (17 characters)</Text>
            <TextInput
              style={styles.input}
              value={form.vin}
              onChangeText={update('vin')}
              placeholder="1HGCM82633A123456"
              placeholderTextColor={Colors.textTertiary}
              maxLength={17}
              autoCapitalize="characters"
            />
            <Text style={styles.hint}>Found on your dashboard, door jamb, or registration.</Text>
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
  header: { paddingTop: 24, marginBottom: 24 },
  step: { fontSize: 12, color: Colors.teal, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },
  form: { gap: 16, paddingBottom: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  classGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  classCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  classCardSelected: { borderColor: Colors.teal, backgroundColor: Colors.teal + '15' },
  classLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  classLabelSelected: { color: Colors.teal },
  classDesc: { fontSize: 11, color: Colors.textTertiary },
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
  hint: { fontSize: 11, color: Colors.textTertiary },
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
