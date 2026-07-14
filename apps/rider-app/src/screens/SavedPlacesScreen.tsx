import React, { useEffect, useRef, useState } from 'react';
import {
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Colors, Typography, Spacing } from '../constants/theme';
import { Card } from '../components/ui/Card';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { useAddressStore } from '../store/address.store';
import { api } from '../api/client';
import type { ResolvedAddress } from '../api/geocoding';

interface BackendSavedAddress {
  label: string;
  address: string;
  lat: string | number;
  lng: string | number;
}

export function SavedPlacesScreen() {
  const { homeAddress, workAddress, setHome, setWork } = useAddressStore();
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const sessionToken = useRef(Math.random().toString(36).slice(2)).current;

  // Hydrate the local store from the server copy so saved places follow the
  // rider across devices (POST /riders/me/addresses upserts by label).
  useEffect(() => {
    api
      .get<{ savedAddresses?: BackendSavedAddress[] }>('/riders/me')
      .then((profile) => {
        for (const a of profile.savedAddresses ?? []) {
          const resolved: ResolvedAddress = {
            placeId: '',
            formattedAddress: a.address,
            lat: Number(a.lat),
            lng: Number(a.lng),
          };
          if (a.label === 'Home') setHome(resolved);
          if (a.label === 'Work') setWork(resolved);
        }
      })
      .catch(() => {});
  }, []);

  const savePlace = async (label: 'Home' | 'Work', addr: ResolvedAddress) => {
    setSavingLabel(label);
    try {
      await api.post('/riders/me/addresses', {
        label,
        address: addr.formattedAddress,
        lat: String(addr.lat),
        lng: String(addr.lng),
      });
      if (label === 'Home') setHome(addr);
      else setWork(addr);
    } catch {
      Alert.alert('Error', `Could not save your ${label.toLowerCase()} address. Try again.`);
    } finally {
      setSavingLabel(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Saved places appear as one-tap shortcuts when you book a ride.
        </Text>

        <Card style={styles.placeCard}>
          <Text style={styles.placeTitle}>🏠 Home</Text>
          <Text style={styles.currentAddress}>
            {savingLabel === 'Home'
              ? 'Saving…'
              : homeAddress?.formattedAddress ?? 'Not set'}
          </Text>
          <AddressAutocomplete
            placeholder="Search for your home address"
            dotColor={Colors.primary}
            sessionToken={sessionToken}
            showRecents={false}
            onAddressResolved={(addr) => savePlace('Home', addr)}
          />
        </Card>

        <Card style={styles.placeCard}>
          <Text style={styles.placeTitle}>💼 Work</Text>
          <Text style={styles.currentAddress}>
            {savingLabel === 'Work'
              ? 'Saving…'
              : workAddress?.formattedAddress ?? 'Not set'}
          </Text>
          <AddressAutocomplete
            placeholder="Search for your work address"
            dotColor={Colors.gold}
            sessionToken={sessionToken}
            showRecents={false}
            onAddressResolved={(addr) => savePlace('Work', addr)}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.base, paddingBottom: Spacing['3xl'] },
  intro: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    lineHeight: 20,
    marginBottom: Spacing.base,
  },
  placeCard: { marginBottom: Spacing.base, gap: Spacing.sm },
  placeTitle: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  currentAddress: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginBottom: Spacing.xs,
  },
});
