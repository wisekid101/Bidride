import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Zap, Info } from 'lucide-react-native';
import { Colors, Fonts, Typography } from '../constants/theme';
import { api } from '../api/client';
import { useTripStore } from '../store/trip.store';

const BID_INCREMENTS = [-2, -1, 0, 1, 2];

export default function BidRequestScreen() {
  const { setActiveTrip } = useTripStore();

  const {
    paymentMethodId,
    aiFare,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  } = useLocalSearchParams<{
    paymentMethodId?: string;
    aiFare?: string;
    pickupAddress?: string;
    dropoffAddress?: string;
    pickupLat?: string;
    pickupLng?: string;
    dropoffLat?: string;
    dropoffLng?: string;
  }>();

  const [bidAmount, setBidAmount] = useState<number>(parseFloat(aiFare ?? '0'));
  const [customInput, setCustomInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [bidResult, setBidResult] = useState<{ winProbability: number } | null>(null);

  const minBid = Math.max(5.0, parseFloat(aiFare ?? '0') - 3);
  const maxBid = parseFloat(aiFare ?? '0') + 5;

  const applyOffset = (offset: number) => {
    const newAmount = Math.min(maxBid, Math.max(minBid, parseFloat(aiFare ?? '0') + offset));
    setBidAmount(parseFloat(newAmount.toFixed(2)));
    setCustomInput('');
  };

  const handleCustomInput = (text: string) => {
    setCustomInput(text);
    const parsed = parseFloat(text);
    if (!isNaN(parsed) && parsed >= minBid && parsed <= maxBid) {
      setBidAmount(parseFloat(parsed.toFixed(2)));
    }
  };

  const submitBid = async () => {
    if (bidAmount < minBid || bidAmount > maxBid) {
      Alert.alert('Invalid Bid', `Bid must be between $${minBid.toFixed(2)} and $${maxBid.toFixed(2)}`);
      return;
    }

    if (!paymentMethodId) {
      Alert.alert(
        'Payment Method Required',
        'Please add a payment method before submitting a bid.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Card', onPress: () => router.push('/payment-methods') },
        ],
      );
      return;
    }

    setLoading(true);
    try {
      const data = await api.post<{ trip: { id: string }; bidId: string; winProbability: number }>('/bids', {
        pickupAddress,
        pickupLat: parseFloat(pickupLat ?? '0'),
        pickupLng: parseFloat(pickupLng ?? '0'),
        dropoffAddress,
        dropoffLat: parseFloat(dropoffLat ?? '0'),
        dropoffLng: parseFloat(dropoffLng ?? '0'),
        bidAmount,
        paymentMethodId,
      });

      setActiveTrip({
        id: data.trip.id,
        status: 'searching',
        pickupAddress,
        dropoffAddress,
        pickupLat: parseFloat(pickupLat ?? '0'),
        pickupLng: parseFloat(pickupLng ?? '0'),
        dropoffLat: parseFloat(dropoffLat ?? '0'),
        dropoffLng: parseFloat(dropoffLng ?? '0'),
        finalFare: bidAmount,
        aiFare: parseFloat(aiFare ?? '0'),
        driverLocation: null,
        driverName: null,
      });

      setBidResult({ winProbability: data.winProbability });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUseAiFare = async () => {
    setLoading(true);
    try {
      const trip = await api.post<{ id: string; aiFare: number }>('/trips', {
        pickupAddress,
        pickupLat: parseFloat(pickupLat ?? '0'),
        pickupLng: parseFloat(pickupLng ?? '0'),
        dropoffAddress,
        dropoffLat: parseFloat(dropoffLat ?? '0'),
        dropoffLng: parseFloat(dropoffLng ?? '0'),
        rideType: 'standard',
      });

      setActiveTrip({
        id: trip.id,
        status: 'searching',
        pickupAddress,
        dropoffAddress,
        pickupLat: parseFloat(pickupLat ?? '0'),
        pickupLng: parseFloat(pickupLng ?? '0'),
        dropoffLat: parseFloat(dropoffLat ?? '0'),
        dropoffLng: parseFloat(dropoffLng ?? '0'),
        finalFare: parseFloat(aiFare ?? '0'),
        aiFare: parseFloat(aiFare ?? '0'),
        driverLocation: null,
        driverName: null,
      });

      router.replace('/tracking');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Bid-submitted confirmation view ──────────────────────────────────────
  if (bidResult) {
    const pct = Math.round(bidResult.winProbability * 100);
    const probColor = pct >= 70 ? Colors.teal : pct >= 50 ? Colors.textPrimary : Colors.textSecondary;
    const probHint =
      pct >= 70
        ? 'Strong offer — drivers are likely to accept'
        : pct >= 50
        ? 'Good offer — most drivers will consider this'
        : 'Low offer — may take longer to match';

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.confirmContent}>
          <View style={styles.confirmCheck}>
            <Text style={styles.confirmCheckText}>✓</Text>
          </View>
          <Text style={styles.confirmTitle}>Bid Submitted</Text>
          <Text style={styles.confirmAmount}>${bidAmount.toFixed(2)}</Text>

          <View style={styles.probSection}>
            <Text style={styles.probLabel}>Match Likelihood</Text>
            <Text style={[styles.probPct, { color: probColor }]}>{pct}%</Text>
            <View style={styles.probBarTrack}>
              <View
                style={[
                  styles.probBarFill,
                  { width: `${pct}%` as any, backgroundColor: probColor },
                ]}
              />
            </View>
            <Text style={styles.probHint}>{probHint}</Text>
          </View>

          <Text style={styles.confirmSub}>Searching for nearby drivers...</Text>

          <TouchableOpacity
            style={styles.watchBtn}
            onPress={() => router.replace('/tracking')}
          >
            <Text style={styles.watchBtnText}>Watch Live</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Pre-submit bid selection view ─────────────────────────────────────────
  const saving = bidAmount < parseFloat(aiFare ?? '0');
  const premium = bidAmount > parseFloat(aiFare ?? '0');

  const standardFare = parseFloat(aiFare ?? '0');
  const strengthData =
    standardFare > 0
      ? bidAmount >= standardFare
        ? { label: 'Strong', color: Colors.teal, hint: 'Drivers will prioritize your request' }
        : bidAmount >= standardFare * 0.93
        ? { label: 'Good', color: Colors.textPrimary, hint: 'Competitive — most drivers will consider this' }
        : { label: 'Low', color: Colors.textSecondary, hint: 'May take longer to match' }
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Choose Your Fare</Text>
          <Text style={styles.subtitle}>
            Bid lower to save — or offer more to attract drivers faster.
          </Text>
        </View>

        {/* AI Fare reference */}
        <View style={styles.aiFareCard}>
          <Zap size={16} color={Colors.teal} />
          <View style={styles.aiFareInfo}>
            <Text style={styles.aiFareLabel}>AI Estimated Fare</Text>
            <Text style={styles.aiFareAmount}>${parseFloat(aiFare ?? '0').toFixed(2)}</Text>
          </View>
          <TouchableOpacity style={styles.useAiBtn} onPress={handleUseAiFare} disabled={loading}>
            <Text style={styles.useAiBtnText}>Use This</Text>
          </TouchableOpacity>
        </View>

        {/* Bid display */}
        <View style={styles.bidDisplay}>
          <Text style={styles.bidLabel}>Your Bid</Text>
          <Text
            style={[
              styles.bidAmount,
              saving && styles.bidAmountSaving,
              premium && styles.bidAmountPremium,
            ]}
          >
            ${bidAmount.toFixed(2)}
          </Text>
          {saving && (
            <Text style={styles.bidSavings}>
              You save ${(parseFloat(aiFare ?? '0') - bidAmount).toFixed(2)}
            </Text>
          )}
          {premium && (
            <Text style={styles.bidPremium}>
              +${(bidAmount - parseFloat(aiFare ?? '0')).toFixed(2)} — attracts drivers faster
            </Text>
          )}
          {strengthData && (
            <View style={styles.strengthRow}>
              <Text style={[styles.strengthLabel, { color: strengthData.color }]}>
                {strengthData.label}
              </Text>
              <Text style={styles.strengthHint}>{strengthData.hint}</Text>
            </View>
          )}
        </View>

        {/* Quick-select offsets */}
        <View style={styles.quickSelect}>
          {BID_INCREMENTS.map((offset) => {
            const amount = parseFloat(aiFare ?? '0') + offset;
            if (amount < minBid || amount > maxBid) return null;
            const selected = Math.abs(bidAmount - amount) < 0.01;
            return (
              <TouchableOpacity
                key={offset}
                style={[styles.quickBtn, selected && styles.quickBtnSelected]}
                onPress={() => applyOffset(offset)}
              >
                <Text style={[styles.quickBtnText, selected && styles.quickBtnTextSelected]}>
                  {offset === 0 ? 'AI' : offset > 0 ? `+$${offset}` : `-$${Math.abs(offset)}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom amount input */}
        <View style={styles.customInputWrap}>
          <Text style={styles.customLabel}>Or enter a custom amount</Text>
          <View style={styles.customRow}>
            <Text style={styles.dollarSign}>$</Text>
            <TextInput
              style={styles.customInput}
              value={customInput}
              onChangeText={handleCustomInput}
              placeholder={bidAmount.toFixed(2)}
              placeholderTextColor={Colors.textDisabled}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.rangeHint}>
            Min ${minBid.toFixed(2)} · Max ${maxBid.toFixed(2)}
          </Text>
        </View>

        {/* Info note */}
        <View style={styles.infoNote}>
          <Info size={14} color={Colors.textSecondary} />
          <Text style={styles.infoText}>
            Bidding is optional. Drivers see your offer and can accept, counter, or skip.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.submitBtn} onPress={submitBid} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.submitBtnText}>Submit Bid · ${bidAmount.toFixed(2)}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // ── Pre-submit ──────────────────────────────────────────────────────────
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24, gap: 24 },
  header: {},
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  aiFareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.teal + '40',
  },
  aiFareInfo: { flex: 1 },
  aiFareLabel: { fontSize: 11, color: Colors.teal, fontWeight: '600', marginBottom: 2 },
  aiFareAmount: { fontSize: 18, fontFamily: Fonts.mono, fontWeight: '700', color: Colors.textPrimary },
  useAiBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  useAiBtnText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  bidDisplay: { alignItems: 'center' },
  bidLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  bidAmount: { fontSize: 56, fontFamily: Fonts.mono, fontWeight: '700', color: Colors.textPrimary },
  bidAmountSaving: { color: Colors.teal },
  bidAmountPremium: { color: Colors.gold },
  bidSavings: { fontSize: 13, color: Colors.teal, marginTop: 4 },
  bidPremium: { fontSize: 13, color: Colors.gold, marginTop: 4 },
  strengthRow: { alignItems: 'center', gap: 4, marginTop: 8 },
  strengthLabel: { fontSize: 15, fontWeight: '700' },
  strengthHint: { fontSize: 12, color: Colors.textSecondary },
  quickSelect: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  quickBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickBtnSelected: { borderColor: Colors.teal, backgroundColor: Colors.teal + '20' },
  quickBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  quickBtnTextSelected: { color: Colors.teal },
  customInputWrap: { gap: 6 },
  customLabel: { fontSize: 13, color: Colors.textSecondary },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
  },
  dollarSign: { fontSize: 20, color: Colors.textSecondary, marginRight: 4 },
  customInput: {
    flex: 1,
    fontSize: 24,
    fontFamily: Fonts.mono,
    fontWeight: '600',
    color: Colors.textPrimary,
    paddingVertical: 12,
  },
  rangeHint: { fontSize: 11, color: Colors.textDisabled },
  infoNote: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
  },
  infoText: { fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 17 },
  footer: { padding: 24, paddingBottom: 32, gap: 10 },
  submitBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: Colors.textSecondary },

  // ── Post-submit confirmation ─────────────────────────────────────────────
  confirmContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  confirmCheck: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  confirmCheckText: { fontSize: 36, color: Colors.background, fontWeight: '800' },
  confirmTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  confirmAmount: {
    fontSize: 48,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  probSection: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  probLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  probPct: { fontSize: 36, fontWeight: '800', fontFamily: Fonts.mono },
  probBarTrack: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  probBarFill: { height: 8, borderRadius: 4 },
  probHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  confirmSub: { fontSize: 14, color: Colors.textSecondary },
  watchBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  watchBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
