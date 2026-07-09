import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { router } from 'expo-router';
import { Plane, Users, Clock, TrendingUp, ArrowLeft } from 'lucide-react-native';
import { Colors, Fonts } from '../constants/theme';
import { useDriverStore } from '../store/driver.store';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

interface QueueStatus {
  position: number;
  totalInQueue: number;
  estimatedWaitMinutes: number;
  surgeMultiplier: number;
  estimatedDemand: number;
  nextFlightArrival: string | null;
  nextFlightPassengers: number;
}

export default function AirportModeScreen({ navigation }: Props) {
  const { accessToken } = useDriverStore();
  const [inQueue, setInQueue] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (polling) clearInterval(polling);
    };
  }, [polling]);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/airport/ewr/queue/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQueueStatus(data);
      }
    } catch {
      // Silently ignore polling failures
    }
  };

  const joinQueue = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/airport/ewr/queue/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Could not join queue');
      }

      setInQueue(true);
      await fetchQueueStatus();

      // Poll every 30 seconds for queue updates
      const interval = setInterval(fetchQueueStatus, 30000);
      setPolling(interval);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const leaveQueue = async () => {
    Alert.alert('Leave Queue', 'Are you sure you want to leave the EWR queue?', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave Queue',
        style: 'destructive',
        onPress: async () => {
          try {
            await fetch(`${API_URL}/airport/ewr/queue/leave`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}` },
            });
          } catch {
            // Optimistic update
          } finally {
            if (polling) clearInterval(polling);
            setPolling(null);
            setInQueue(false);
            setQueueStatus(null);
          }
        },
      },
    ]);
  };

  const surge = queueStatus?.surgeMultiplier ?? 1;
  const surgeColor = surge >= 2 ? Colors.safety : surge >= 1.5 ? Colors.gold : Colors.teal;

  // Leaving the screen never removes the driver from the queue — position is
  // held server-side (see queue rules) — so back is always safe.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Plane size={24} color={Colors.teal} />
        <Text style={styles.title}>EWR Airport Mode</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {!inQueue ? (
          <View style={styles.joinSection}>
            <View style={styles.ewrInfo}>
              <Text style={styles.ewrName}>Newark Liberty International</Text>
              <Text style={styles.ewrSubtitle}>
                Virtual queue — FIFO dispatch. You'll receive a request when you reach the front.
              </Text>
            </View>

            <View style={styles.rulesCard}>
              <Text style={styles.rulesTitle}>Queue Rules</Text>
              <RuleItem text="Stay within 1 mile of the airport while in queue" />
              <RuleItem text="Accept the first ride request — declining removes you" />
              <RuleItem text="Surge cap: 2.5× (admin approval required above 1.5×)" />
              <RuleItem text="Your position is maintained even if you briefly disconnect" />
            </View>

            <TouchableOpacity
              style={styles.joinBtn}
              onPress={joinQueue}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.background} />
              ) : (
                <Text style={styles.joinBtnText}>Join EWR Queue</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.queueSection}>
            {/* Position card */}
            <View style={styles.positionCard}>
              <Text style={styles.positionLabel}>Your Queue Position</Text>
              {queueStatus ? (
                <>
                  <Text style={styles.positionNumber}>{queueStatus.position}</Text>
                  <Text style={styles.positionOf}>of {queueStatus.totalInQueue} drivers</Text>
                </>
              ) : (
                <ActivityIndicator color={Colors.teal} style={{ marginVertical: 16 }} />
              )}
            </View>

            {/* Stats grid */}
            {queueStatus && (
              <View style={styles.statsGrid}>
                <StatCard
                  icon={Clock}
                  label="Est. Wait"
                  value={`${queueStatus.estimatedWaitMinutes} min`}
                />
                <StatCard
                  icon={TrendingUp}
                  label="Surge"
                  value={`${surge.toFixed(1)}×`}
                  color={surgeColor}
                />
                <StatCard
                  icon={Users}
                  label="Demand"
                  value={queueStatus.estimatedDemand.toString()}
                />
              </View>
            )}

            {/* Next flight info */}
            {queueStatus?.nextFlightArrival && (
              <View style={styles.flightCard}>
                <Plane size={16} color={Colors.teal} />
                <View style={styles.flightInfo}>
                  <Text style={styles.flightLabel}>Next Arrival</Text>
                  <Text style={styles.flightTime}>
                    {new Date(queueStatus.nextFlightArrival).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                  <Text style={styles.flightPassengers}>
                    ~{queueStatus.nextFlightPassengers} passengers
                  </Text>
                </View>
              </View>
            )}

            {/* Surge warning */}
            {surge >= 1.5 && (
              <View style={[styles.surgeAlert, surge >= 2 && styles.surgeAlertHigh]}>
                <TrendingUp size={16} color={surge >= 2 ? Colors.safety : Colors.gold} />
                <Text style={[styles.surgeAlertText, surge >= 2 && styles.surgeAlertTextHigh]}>
                  {surge >= 2
                    ? 'High surge — admin approval active. Fares are elevated.'
                    : 'Moderate surge active. Higher fares in effect.'}
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.leaveBtn} onPress={leaveQueue}>
              <Text style={styles.leaveBtnText}>Leave Queue</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RuleItem({ text }: { text: string }) {
  return (
    <View style={styles.ruleRow}>
      <Text style={styles.ruleBullet}>·</Text>
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color = Colors.textPrimary,
}: {
  icon: any;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Icon size={16} color={Colors.textTertiary} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, gap: 16 },
  joinSection: { gap: 20 },
  ewrInfo: { alignItems: 'center', paddingVertical: 24 },
  ewrName: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  ewrSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  rulesCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  rulesTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  ruleRow: { flexDirection: 'row', gap: 8 },
  ruleBullet: { fontSize: 14, color: Colors.teal, fontWeight: '700', width: 12 },
  ruleText: { fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  joinBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
  queueSection: { gap: 16 },
  positionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.teal + '40',
  },
  positionLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  positionNumber: {
    fontSize: 72,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.teal,
    lineHeight: 80,
  },
  positionOf: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  statsGrid: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statLabel: { fontSize: 11, color: Colors.textTertiary },
  statValue: { fontSize: 18, fontFamily: Fonts.mono, fontWeight: '700', color: Colors.textPrimary },
  flightCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  flightInfo: { flex: 1 },
  flightLabel: { fontSize: 12, color: Colors.textTertiary },
  flightTime: { fontSize: 20, fontFamily: Fonts.mono, fontWeight: '700', color: Colors.textPrimary },
  flightPassengers: { fontSize: 12, color: Colors.textSecondary },
  surgeAlert: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: Colors.gold + '15',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.gold + '40',
  },
  surgeAlertHigh: {
    backgroundColor: Colors.safety + '15',
    borderColor: Colors.safety + '40',
  },
  surgeAlertText: { fontSize: 13, color: Colors.gold, flex: 1, lineHeight: 18 },
  surgeAlertTextHigh: { color: Colors.safety },
  leaveBtn: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  leaveBtnText: { fontSize: 15, color: Colors.textSecondary },
});
