import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Colors, Typography, Spacing } from '../src/constants/theme';
import { Card } from '../src/components/ui/Card';

// Settings — only controls that actually work today: live permission states
// with a deep-link to the OS settings (permissions can't be revoked in-app).
export default function SettingsScreen() {
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [notifGranted, setNotifGranted] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      Location.getForegroundPermissionsAsync()
        .then(({ status }) => setLocationGranted(status === 'granted'))
        .catch(() => setLocationGranted(null));
      Notifications.getPermissionsAsync()
        .then(({ status }) => setNotifGranted(status === 'granted'))
        .catch(() => setNotifGranted(null));
    }, []),
  );

  const stateText = (granted: boolean | null) =>
    granted === null ? '—' : granted ? 'Enabled' : 'Off';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Permissions</Text>
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>📍 Location</Text>
          <Text style={[styles.permState, locationGranted && styles.permOn]}>
            {stateText(locationGranted)}
          </Text>
        </View>
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>🔔 Notifications</Text>
          <Text style={[styles.permState, notifGranted && styles.permOn]}>
            {stateText(notifGranted)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            // Throws inside Expo Go (no per-app settings page for the shared
            // container) — swallow rather than crash the LogBox.
            Linking.openSettings().catch(() => {});
          }}
        >
          <Text style={styles.link}>Change in phone Settings ›</Text>
        </TouchableOpacity>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>About</Text>
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>App</Text>
          <Text style={styles.permState}>BidiRide Rider</Text>
        </View>
        <View style={styles.permRow}>
          <Text style={styles.permLabel}>Stage</Text>
          <Text style={styles.permState}>Alpha — Newark, NJ</Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.base, paddingBottom: Spacing['3xl'] },
  card: { marginBottom: Spacing.base, gap: Spacing.md },
  cardTitle: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  permRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permLabel: { color: Colors.text, fontSize: Typography.size.base },
  permState: { color: Colors.textSecondary, fontSize: Typography.size.base },
  permOn: { color: Colors.primary },
  link: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
});
