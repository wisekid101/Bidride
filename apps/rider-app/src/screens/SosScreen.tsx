import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';
import { useTripStore } from '../store/trip.store';

const COUNTDOWN_SECONDS = 5;

type SosPhase = 'confirm' | 'countdown' | 'active';

export function SosScreen() {
  const { activeTrip } = useTripStore();
  const [phase, setPhase] = useState<SosPhase>('confirm');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [sosId, setSosId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse during countdown
  useEffect(() => {
    if (phase === 'countdown') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
      ).start();
    }
  }, [phase]);

  const beginSos = async () => {
    if (!activeTrip) return;

    setPhase('countdown');
    Vibration.vibrate([0, 400, 200, 400]);

    const location = await Location.getCurrentPositionAsync({}).catch(() => null);

    try {
      const result = await api.post<{ sosId: string; countdownSeconds: number }>(
        '/safety/sos/initiate',
        {
          tripId: activeTrip.id,
          triggerSource: 'button_tap',
          gpsLat: location?.coords.latitude ?? 0,
          gpsLng: location?.coords.longitude ?? 0,
        },
      );
      setSosId(result.sosId);

      let remaining = COUNTDOWN_SECONDS;
      intervalRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(intervalRef.current!);
          confirmSos(result.sosId);
        }
      }, 1000);
    } catch (err) {
      setPhase('confirm');
      Alert.alert('Error', 'Could not initiate SOS. Try calling 911 directly.');
    }
  };

  const confirmSos = async (id: string) => {
    try {
      await api.post(`/safety/sos/${id}/confirm`, {});
      setPhase('active');
      Vibration.vibrate([0, 600, 300, 600, 300, 600]);
    } catch (err) {
      console.error('SOS confirm failed', err);
    }
  };

  const cancelSos = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (sosId) {
      await api.post(`/safety/sos/${sosId}/cancel`, {}).catch(console.error);
    }
    Vibration.cancel();
    router.back();
  };

  return (
    <View style={styles.container}>
      {phase === 'confirm' && (
        <>
          <Text style={styles.title}>Emergency SOS</Text>
          <Text style={styles.subtitle}>
            This will alert BidiRide safety team and your trusted contacts.
            A 5-second countdown gives you time to cancel.
          </Text>

          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={styles.sosCircle}
              onPress={beginSos}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Activate Emergency SOS"
              accessibilityHint="Double-tap to begin 5-second countdown. Tap Cancel to abort."
            >
              <Text style={styles.sosCircleText}>SOS</Text>
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity style={styles.cancelLink} onPress={() => router.back()}>
            <Text style={styles.cancelLinkText}>Cancel · I'm safe</Text>
          </TouchableOpacity>

          <View style={styles.callRow}>
            <TouchableOpacity
              onPress={() => Linking.openURL('tel:911')}
              accessibilityRole="button"
              accessibilityLabel="Call 911"
            >
              <Text style={[styles.orText, styles.callLink]}>Call 911 directly</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {phase === 'countdown' && (
        <>
          <Text style={styles.countdownLabel}>SOS activating in</Text>
          <Animated.Text
            style={[styles.countdown, { transform: [{ scale: pulseAnim }] }]}
            accessibilityLiveRegion="assertive"
            accessibilityLabel={`${countdown} seconds remaining`}
          >
            {countdown}
          </Animated.Text>
          <TouchableOpacity style={styles.cancelButton} onPress={cancelSos} activeOpacity={0.85}>
            <Text style={styles.cancelButtonText}>CANCEL</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>Release to activate · Tap CANCEL to abort</Text>
        </>
      )}

      {phase === 'active' && (
        <>
          <View style={styles.activePulse} />
          <Text style={styles.activeTitle}>SOS Active</Text>
          <Text style={styles.activeSubtitle}>
            BidiRide safety team has been alerted.{'\n'}
            Your trusted contacts are being notified.{'\n'}
            Audio recording has started.
          </Text>
          <Text style={styles.activeNote}>
            Do not close this screen.{'\n'}
            A safety agent will contact you shortly.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing['2xl'],
  },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.extrabold,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    textAlign: 'center',
    marginBottom: Spacing['3xl'],
    lineHeight: 22,
  },
  sosCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.safety,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing['2xl'],
    shadowColor: Colors.safety,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 30,
    elevation: 20,
  },
  sosCircleText: {
    color: Colors.safetyText,
    fontSize: 36,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: 4,
  },
  cancelLink: { paddingVertical: Spacing.md },
  cancelLinkText: { color: Colors.textSecondary, fontSize: Typography.size.base },
  orText: { color: Colors.textSecondary, fontSize: Typography.size.sm, textAlign: 'center' },
  callLink: { color: Colors.safety, textDecorationLine: 'underline' },
  callRow: { marginTop: Spacing.lg },
  countdownLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.lg,
    marginBottom: Spacing.lg,
  },
  countdown: {
    color: Colors.safety,
    fontSize: 120,
    fontWeight: Typography.weight.extrabold,
    marginBottom: Spacing['2xl'],
  },
  cancelButton: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.base,
    borderWidth: 2,
    borderColor: Colors.safety,
  },
  cancelButtonText: {
    color: Colors.safety,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: 2,
  },
  hint: {
    color: Colors.textDisabled,
    fontSize: Typography.size.xs,
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  activePulse: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.safety,
    opacity: 0.15,
    position: 'absolute',
    top: '30%',
  },
  activeTitle: {
    color: Colors.safety,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.extrabold,
    marginBottom: Spacing.md,
  },
  activeSubtitle: {
    color: Colors.text,
    fontSize: Typography.size.base,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: Spacing.xl,
  },
  activeNote: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
