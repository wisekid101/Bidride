import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

interface WalletData {
  takeHome: number;
  trips: number;
  tips: number;
  pendingWallet: number;
  availableWallet: number;
  lifetimeEarnings: number;
  periodLabel: string;
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

function AmountDisplay({ value, size = 'large', prefix = '$' }: { value: number; size?: 'hero' | 'large' | 'medium' | 'small'; prefix?: string }) {
  const style = {
    hero: { fontSize: 52, fontFamily: 'JetBrainsMono-Bold', fontWeight: '700' as const },
    large: { fontSize: 32, fontFamily: 'JetBrainsMono-Bold', fontWeight: '700' as const },
    medium: { fontSize: 24, fontFamily: 'JetBrainsMono-Bold', fontWeight: '600' as const },
    small: { fontSize: 18, fontFamily: 'JetBrainsMono-Bold', fontWeight: '600' as const },
  }[size];
  return (
    <Text style={[style, { color: Colors.gold }]}>
      {prefix}{value.toFixed(2)}
    </Text>
  );
}

export function WalletScreen() {
  const navigation = useNavigation<any>();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [history, setHistory] = useState<TripEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [todayData, historyData] = await Promise.all([
        api.get<WalletData>('/driver/earnings/today'),
        api.get<TripEarning[]>('/driver/earnings/history?limit=10'),
      ]);
      setWallet(todayData);
      setHistory(historyData ?? []);
    } catch {
      setError('Could not load wallet data. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const handleInstantPayout = () => {
    if (!wallet || wallet.availableWallet < 10) {
      Alert.alert(
        'Minimum Not Met',
        'Instant payout requires a minimum of $10.00 available balance.',
      );
      return;
    }
    Alert.alert(
      'Instant Payout',
      `Transfer $${wallet.availableWallet.toFixed(2)} to your bank account?\n\nFee: $0.99`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          onPress: async () => {
            setPayoutLoading(true);
            try {
              await api.post('/payments/payout/instant', {});
              Alert.alert('Payout Initiated', 'Your funds will arrive within minutes.');
              void load();
            } catch {
              Alert.alert('Error', 'Payout failed. Please try again.');
            } finally {
              setPayoutLoading(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.primary} style={styles.spinner} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error && (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Available Balance — primary CTA */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Available to Transfer</Text>
          <AmountDisplay value={wallet?.availableWallet ?? 0} size="hero" />
          <TouchableOpacity
            style={[styles.payoutBtn, payoutLoading && styles.payoutBtnDisabled]}
            onPress={handleInstantPayout}
            disabled={payoutLoading}
            activeOpacity={0.85}
          >
            {payoutLoading ? (
              <ActivityIndicator color={Colors.primaryText} />
            ) : (
              <>
                <Ionicons name="flash" size={18} color={Colors.primaryText} />
                <Text style={styles.payoutBtnText}>Instant Transfer ($0.99)</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.scheduledNote}>Scheduled payout: every Monday · 2h hold on new earnings</Text>
        </View>

        {/* Pending + Lifetime */}
        <View style={styles.balanceRow}>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Pending (2h hold)</Text>
            <AmountDisplay value={wallet?.pendingWallet ?? 0} size="medium" />
          </View>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Lifetime Earnings</Text>
            <AmountDisplay value={wallet?.lifetimeEarnings ?? 0} size="medium" />
          </View>
        </View>

        {/* Today summary */}
        {wallet && (
          <View style={styles.todayCard}>
            <Text style={styles.sectionTitle}>Today</Text>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Take-Home</Text>
                <AmountDisplay value={wallet.takeHome} size="small" />
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Trips</Text>
                <Text style={styles.statValue}>{wallet.trips}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Tips</Text>
                <AmountDisplay value={wallet.tips} size="small" />
              </View>
            </View>
          </View>
        )}

        {/* Recent transactions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Earnings</Text>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={40} color={Colors.textSecondary} />
            <Text style={styles.emptyText}>No earnings yet</Text>
          </View>
        ) : (
          history.map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View>
                <Text style={styles.txLabel}>{tx.pickupArea} → {tx.dropoffArea}</Text>
                <Text style={styles.txDate}>{new Date(tx.completedAt).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}</Text>
              </View>
              <AmountDisplay value={tx.takeHome} size="small" prefix="+ $" />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  spinner: { marginTop: 80 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? Spacing.sm : Spacing['2xl'],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.text, fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  content: { padding: Spacing.base, paddingBottom: 60 },
  errorBar: {
    backgroundColor: Colors.error + '22',
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.md,
  },
  errorText: { color: Colors.error, fontSize: Typography.size.sm, textAlign: 'center' },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.gold + '33',
  },
  heroLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  payoutBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.lg,
  },
  payoutBtnDisabled: { opacity: 0.5 },
  payoutBtnText: { color: Colors.primaryText, fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
  scheduledNote: { color: Colors.textSecondary, fontSize: Typography.size.xs, marginTop: Spacing.sm, textAlign: 'center' },
  balanceRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  balanceCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  balanceLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs, marginBottom: Spacing.xs },
  todayCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitle: { color: Colors.text, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, marginBottom: Spacing.sm },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs, marginBottom: 4 },
  statValue: { color: Colors.text, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  sectionHeader: { marginBottom: Spacing.sm },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  txLabel: { color: Colors.text, fontSize: Typography.size.base, marginBottom: 2 },
  txDate: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: Spacing.sm },
  emptyText: { color: Colors.textSecondary, fontSize: Typography.size.base },
});
