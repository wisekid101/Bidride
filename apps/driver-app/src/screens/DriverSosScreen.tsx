import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration, Linking, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

const COUNTDOWN = 5;
type Phase = 'confirm' | 'countdown' | 'active';

export function DriverSosScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [phase, setPhase] = useState<Phase>('confirm');
  const [count, setCount] = useState(COUNTDOWN);
  const [sosId, setSosId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const begin = async () => {
    if (!tripId) return;
    setPhase('countdown');
    Vibration.vibrate([0, 400, 200, 400]);
    const loc = await Location.getCurrentPositionAsync({}).catch(() => null);
    try {
      const res = await api.post<{ sosId: string }>('/safety/sos/initiate', {
        tripId, triggerSource: 'button_tap',
        gpsLat: loc?.coords.latitude ?? 0, gpsLng: loc?.coords.longitude ?? 0,
      });
      setSosId(res.sosId);
      let n = COUNTDOWN;
      timer.current = setInterval(() => {
        n -= 1; setCount(n);
        if (n <= 0) { clearInterval(timer.current!); confirm(res.sosId); }
      }, 1000);
    } catch {
      setPhase('confirm');
      Alert.alert('Error', 'Could not initiate SOS. Call 911 directly.');
    }
  };

  const confirm = async (id: string) => {
    try {
      await api.post(`/safety/sos/${id}/confirm`, {});
      setPhase('active');
      Vibration.vibrate([0, 600, 300, 600]);
    } catch (e) { /* keep active UI; SOS already recorded server-side */ }
  };

  const cancel = async () => {
    if (timer.current) clearInterval(timer.current);
    if (sosId) await api.post(`/safety/sos/${sosId}/cancel`, {}).catch(() => {});
    Vibration.cancel();
    router.back();
  };

  return (
    <View style={styles.c}>
      {phase === 'confirm' && (
        <>
          <Text style={styles.title}>Emergency SOS</Text>
          <Text style={styles.sub}>Alerts BidRide safety + starts a 5-second countdown you can cancel.</Text>
          <TouchableOpacity style={styles.circle} onPress={begin} accessibilityRole="button" accessibilityLabel="Activate Emergency SOS">
            <Text style={styles.circleText}>SOS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.link} onPress={() => router.back()}><Text style={styles.linkText}>Cancel · I'm safe</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL('tel:911')}><Text style={styles.call}>Call 911 directly</Text></TouchableOpacity>
        </>
      )}
      {phase === 'countdown' && (
        <>
          <Text style={styles.sub}>SOS activating in</Text>
          <Text style={styles.count} accessibilityLiveRegion="assertive">{count}</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={cancel}><Text style={styles.cancelText}>CANCEL</Text></TouchableOpacity>
        </>
      )}
      {phase === 'active' && (
        <>
          <Text style={styles.active}>SOS Active</Text>
          <Text style={styles.sub}>BidRide safety alerted. Recording started. A safety agent will contact you.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: Spacing['2xl'] },
  title: { color: Colors.text, fontSize: Typography.size['2xl'], fontWeight: Typography.weight.extrabold, marginBottom: Spacing.md },
  sub: { color: Colors.textSecondary, fontSize: Typography.size.base, textAlign: 'center', marginBottom: Spacing['2xl'], lineHeight: 22 },
  circle: { width: 160, height: 160, borderRadius: 80, backgroundColor: Colors.safety, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.xl },
  circleText: { color: Colors.safetyText, fontSize: 36, fontWeight: Typography.weight.extrabold, letterSpacing: 4 },
  link: { paddingVertical: Spacing.md }, linkText: { color: Colors.textSecondary },
  call: { color: Colors.safety, textDecorationLine: 'underline', marginTop: Spacing.lg },
  count: { color: Colors.safety, fontSize: 120, fontWeight: Typography.weight.extrabold, marginBottom: Spacing.xl },
  cancelBtn: { borderWidth: 2, borderColor: Colors.safety, borderRadius: Radius.full, paddingHorizontal: Spacing['2xl'], paddingVertical: Spacing.base },
  cancelText: { color: Colors.safety, fontSize: Typography.size.lg, fontWeight: Typography.weight.extrabold, letterSpacing: 2 },
  active: { color: Colors.safety, fontSize: Typography.size['2xl'], fontWeight: Typography.weight.extrabold, marginBottom: Spacing.md },
});
