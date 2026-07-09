import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

type Tab = 'today' | 'week' | 'history';

interface EarningsSummary {
  takeHome: number;      // ALWAYS shown first and largest
  trips: number;
  hoursOnline: number;
  floorSupplements: number;
  floorTriggeredCount: number;
  rewardBonuses: number;
}

interface TripEarning {
  id: string;
  completedAt: string;
  pickupArea: string;
  dropoffArea: string;
  takeHome: number;
  floorSupplement: number;
  ratingGiven: number | null;
}

export function EarningsDashboardScreen() {
  const [tab, setTab] = useState<Tab>('today');

  // The history endpoint returns a trip array, not a summary — on the History
  // tab the hero card shows the weekly summary instead.
  const summaryPeriod = tab === 'history' ? 'week' : tab;
  const { data: summary, isLoading } = useQuery<EarningsSummary>({
    queryKey: ['earnings', summaryPeriod],
    queryFn: () => api.get(`/driver/earnings/${summaryPeriod}`),
    staleTime: 30000,
  });

  const { data: trips } = useQuery<TripEarning[]>({
    queryKey: ['trips', tab],
    queryFn: () => api.get('/driver/earnings/history?limit=20'),
    enabled: tab === 'history',
  });

  // Defensive: only render the summary card for a well-formed summary object,
  // so an unexpected response shape can never crash the screen again.
  const validSummary =
    summary &&
    typeof summary.takeHome === 'number' &&
    typeof summary.trips === 'number' &&
    typeof summary.hoursOnline === 'number'
      ? summary
      : null;

  const floorRate = validSummary && validSummary.trips > 0
    ? ((validSummary.floorTriggeredCount / validSummary.trips) * 100).toFixed(0)
    : '0';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Earnings</Text>
        <TouchableOpacity onPress={() => router.push('/wallet')}>
          <Text style={styles.walletLink}>Wallet</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {(['today', 'week', 'history'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {isLoading && (
          <Text style={styles.loading}>Loading earnings…</Text>
        )}

        {validSummary && (
          <>
            {/* PRIMARY METRIC: Take-home first, largest, most prominent */}
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>
                {tab === 'today' ? "Today's Take-Home" : "This Week's Take-Home"}
              </Text>
              <Text style={styles.heroAmount}>${validSummary.takeHome.toFixed(2)}</Text>
              <View style={styles.heroStats}>
                <StatChip label="Trips" value={validSummary.trips.toString()} />
                <StatChip label="Hours" value={validSummary.hoursOnline.toFixed(1)} />
                <StatChip
                  label="Avg/trip"
                  value={`$${validSummary.trips > 0 ? (validSummary.takeHome / validSummary.trips).toFixed(2) : '0.00'}`}
                />
              </View>
            </View>

            {/* Earnings Floor Card */}
            {validSummary.floorSupplements > 0 && (
              <View style={styles.floorCard}>
                <View style={styles.floorHeader}>
                  <Ionicons name="shield-checkmark" size={18} color={Colors.gold} />
                  <Text style={styles.floorTitle}>Earnings Floor Protection</Text>
                </View>
                <Text style={styles.floorAmount}>+${validSummary.floorSupplements.toFixed(2)}</Text>
                <Text style={styles.floorDetail}>
                  Added to {validSummary.floorTriggeredCount} of {validSummary.trips} trips ({floorRate}% of trips).
                  BidiRide guarantees your minimum earnings.
                </Text>
                <Text style={styles.floorLearnMore}>How the floor works →</Text>
              </View>
            )}

            {/* Rewards Bonuses */}
            {validSummary.rewardBonuses > 0 && (
              <View style={styles.bonusCard}>
                <Text style={styles.bonusTitle}>Reward Bonuses</Text>
                <Text style={styles.bonusAmount}>+${validSummary.rewardBonuses.toFixed(2)}</Text>
              </View>
            )}

            {/* Gross fare intentionally NOT displayed on this screen per spec */}
            {/* Driver take-home is the only financial metric shown */}
          </>
        )}

        {/* Trip History List */}
        {tab === 'history' && trips && (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>Recent Trips</Text>
            {trips.map((trip) => (
              <TripRow key={trip.id} trip={trip} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statChipLabel}>{label}</Text>
      <Text style={styles.statChipValue}>{value}</Text>
    </View>
  );
}

function TripRow({ trip }: { trip: TripEarning }) {
  return (
    <View style={styles.tripRow}>
      <View style={styles.tripInfo}>
        <Text style={styles.tripRoute} numberOfLines={1}>
          {trip.pickupArea} → {trip.dropoffArea}
        </Text>
        <Text style={styles.tripDate}>
          {new Date(trip.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </Text>
      </View>
      <View style={styles.tripEarnings}>
        <Text style={styles.tripAmount}>${trip.takeHome.toFixed(2)}</Text>
        {trip.floorSupplement > 0 && (
          <Text style={styles.tripFloor}>+${trip.floorSupplement.toFixed(2)} floor</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 32,
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.md,
  },
  headerTitle: { color: Colors.text, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold },
  walletLink: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.medium },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.base,
  },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },
  tabTextActive: { color: Colors.primary },
  scroll: { padding: Spacing.base, paddingBottom: 100 },
  loading: { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xl },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.gold + '40',
    marginBottom: Spacing.md,
  },
  heroLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm, marginBottom: Spacing.xs },
  heroAmount: {
    color: Colors.gold,
    fontSize: 52,
    fontWeight: Typography.weight.extrabold,
    fontFamily: Typography.fontFamilyMono,
    marginBottom: Spacing.md,
  },
  heroStats: { flexDirection: 'row', gap: Spacing.sm },
  statChip: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    alignItems: 'center',
  },
  statChipLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  statChipValue: { color: Colors.text, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, fontFamily: Typography.fontFamilyMono },
  floorCard: {
    backgroundColor: Colors.gold + '11',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.gold,
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  floorHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xs },
  floorTitle: { color: Colors.gold, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  floorAmount: { color: Colors.gold, fontSize: Typography.size['2xl'], fontWeight: Typography.weight.extrabold, fontFamily: Typography.fontFamilyMono, marginBottom: Spacing.xs },
  floorDetail: { color: Colors.textSecondary, fontSize: Typography.size.xs, lineHeight: 18, marginBottom: Spacing.sm },
  floorLearnMore: { color: Colors.primary, fontSize: Typography.size.sm },
  bonusCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  bonusTitle: { color: Colors.text, fontSize: Typography.size.base, fontWeight: Typography.weight.medium },
  bonusAmount: { color: Colors.primary, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, fontFamily: Typography.fontFamilyMono },
  historySection: { marginTop: Spacing.md },
  historyTitle: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium, marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.separator,
  },
  tripInfo: { flex: 1, marginRight: Spacing.md },
  tripRoute: { color: Colors.text, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },
  tripDate: { color: Colors.textSecondary, fontSize: Typography.size.xs, marginTop: 2 },
  tripEarnings: { alignItems: 'flex-end' },
  tripAmount: { color: Colors.text, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, fontFamily: Typography.fontFamilyMono },
  tripFloor: { color: Colors.gold, fontSize: Typography.size.xs, fontFamily: Typography.fontFamilyMono },
});
