import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Colors, Typography, Spacing } from '../../src/constants/theme';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { api } from '../../src/api/client';

type PermState = 'unknown' | 'granted' | 'denied';

// Signup step: permission education. Explains WHY before the OS dialogs fire.
// Both permissions are optional — "Not Now" always proceeds.
export default function SignupPermissionsScreen() {
  const [locationState, setLocationState] = useState<PermState>('unknown');
  const [notifState, setNotifState] = useState<PermState>('unknown');

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => { if (status === 'granted') setLocationState('granted'); })
      .catch(() => {});
    Notifications.getPermissionsAsync()
      .then(({ status }) => { if (status === 'granted') setNotifState('granted'); })
      .catch(() => {});
  }, []);

  const enableLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationState(status === 'granted' ? 'granted' : 'denied');
    } catch {
      setLocationState('denied');
    }
  };

  const enableNotifications = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifState(status === 'granted' ? 'granted' : 'denied');
      if (status === 'granted') {
        // Same registration the app performs at cold start
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: 'bidride-rider' });
        await api.patch('/riders/me/push-token', { token });
      }
    } catch {
      // Token registration is best-effort — permission state is what matters here
    }
  };

  const stateLabel = (s: PermState) =>
    s === 'granted' ? 'Enabled ✓' : s === 'denied' ? 'Not now' : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader showBack={false} />
      <View style={styles.content}>
        <Text style={styles.title}>Two quick permissions</Text>
        <Text style={styles.subtitle}>
          Both are optional — you can change them any time in your phone's Settings.
        </Text>

        <Card style={styles.permCard}>
          <Text style={styles.permEmoji}>📍</Text>
          <Text style={styles.permTitle}>Location</Text>
          <Text style={styles.permBody}>
            Sets your pickup spot automatically and lets you watch your driver
            arrive in real time.
          </Text>
          {locationState === 'unknown' ? (
            <Button title="Enable Location" onPress={enableLocation} />
          ) : (
            <Text style={styles.permState}>{stateLabel(locationState)}</Text>
          )}
        </Card>

        <Card style={styles.permCard}>
          <Text style={styles.permEmoji}>🔔</Text>
          <Text style={styles.permTitle}>Notifications</Text>
          <Text style={styles.permBody}>
            Know the moment a driver accepts, arrives, or your trip completes —
            even with the app closed.
          </Text>
          {notifState === 'unknown' ? (
            <Button title="Enable Notifications" onPress={enableNotifications} />
          ) : (
            <Text style={styles.permState}>{stateLabel(notifState)}</Text>
          )}
        </Card>

        <View style={styles.footer}>
          <Button
            title={locationState === 'unknown' && notifState === 'unknown' ? 'Not Now' : 'Continue'}
            variant={locationState === 'granted' || notifState === 'granted' ? 'primary' : 'secondary'}
            onPress={() => router.replace('/(tabs)')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.extrabold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  permCard: { marginBottom: Spacing.base, gap: Spacing.sm },
  permEmoji: { fontSize: 26 },
  permTitle: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  permBody: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    lineHeight: 20,
  },
  permState: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    paddingVertical: Spacing.sm,
  },
  footer: { marginTop: 'auto', marginBottom: Spacing.xl },
});
