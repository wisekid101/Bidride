import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Colors } from '../../constants/theme';
import { api } from '../../api/client';

export default function OnboardingCompleteScreen() {
  const scaleAnim = new Animated.Value(0);
  const fadeAnim = new Animated.Value(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 5, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // Home is gated on approval — the button re-checks status so a freshly
  // approved driver gets in immediately, and everyone else stays here.
  const checkStatus = async () => {
    setChecking(true);
    try {
      const me = await api.get<{ status: string }>('/drivers/me');
      if (me.status === 'approved') {
        router.replace('/(tabs)');
      } else if (me.status === 'declined') {
        Alert.alert('Application Declined', 'Please contact support for details.');
      } else {
        Alert.alert('Still Under Review', 'Your application has not been approved yet. We’ll text you the moment it is.');
      }
    } catch {
      Alert.alert('Error', 'Could not check your application status. Try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={[styles.iconWrap, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.icon}>🎉</Text>
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={styles.title}>Application Submitted!</Text>
          <Text style={styles.subtitle}>
            Our team is reviewing your documents and background check. This typically takes 1–3
            business days.
          </Text>

          <View style={styles.statusCards}>
            <StatusItem icon="📄" label="Documents" status="Under Review" />
            <StatusItem icon="🔍" label="Background Check" status="In Progress" />
            <StatusItem icon="🚗" label="Vehicle Inspection" status="Scheduled by Team" />
          </View>

          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              You'll receive an SMS when your application is approved. You can start driving
              immediately after approval.
            </Text>
          </View>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.btn} onPress={checkStatus} disabled={checking}>
          {checking ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.btnText}>Check Approval Status</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StatusItem({ icon, label, status }: { icon: string; label: string; status: string }) {
  return (
    <View style={styles.statusItem}>
      <Text style={styles.statusIcon}>{icon}</Text>
      <View style={styles.statusText}>
        <Text style={styles.statusLabel}>{label}</Text>
        <Text style={styles.statusValue}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  iconWrap: { alignItems: 'center', marginBottom: 24 },
  icon: { fontSize: 72 },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  statusCards: { gap: 12, marginBottom: 24 },
  statusItem: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusIcon: { fontSize: 20 },
  statusText: { flex: 1 },
  statusLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  statusValue: { fontSize: 12, color: Colors.teal, marginTop: 2 },
  noticeBox: {
    backgroundColor: Colors.teal + '15',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.teal + '40',
  },
  noticeText: { fontSize: 14, color: Colors.teal, lineHeight: 20 },
  footer: { padding: 24, paddingBottom: 32 },
  btn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
