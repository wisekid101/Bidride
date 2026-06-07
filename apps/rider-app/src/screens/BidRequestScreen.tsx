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
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Zap, Info } from 'lucide-react-native';
import { Colors, Fonts, Typography } from '../constants/theme';
import { useAuthStore } from '../store/auth.store';
import { useTripStore } from '../store/trip.store';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

// Bid increments offered to rider as quick-select shortcuts
const BID_INCREMENTS = [-2, -1, 0, 1, 2];

export default function BidRequestScreen({ navigation, route }: Props) {
  const { accessToken } = useAuthStore();
  const { setActiveTrip } = useTripStore();

  const {
    tripId,
    aiFare,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  } = route.params ?? {};

  const [bidAmount, setBidAmount] = useState<number>(parseFloat(aiFare ?? '0'));
  const [customInput, setCustomInput] = useState('');
  const [loading, setLoading] = useState(false);

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

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/trips/${tripId}/bid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ bidAmount }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Bid failed');
      }

      const data = await res.json();
      setActiveTrip({
        id: tripId,
        status: 'searching',
        pickupAddress,
        dropoffAddress,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        finalFare: bidAmount,
        aiFare,
        driverLocation: null,
        driverName: null,
      });

      navigation.replace('Tracking', { tripId });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const useAiFare = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/trips/${tripId}/accept-ai-fare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error('Failed to accept AI fare');

      setActiveTrip({
        id: tripId,
        status: 'searching',
        pickupAddress,
        dropoffAddress,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        finalFare: parseFloat(aiFare),
        aiFare,
        driverLocation: null,
        driverName: null,
      });

      navigation.replace('Tracking', { tripId });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const saving = bidAmount < parseFloat(aiFare ?? '0');
  const premium = bidAmount > parseFloat(aiFare ?? '0');

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
          <TouchableOpacity style={styles.useAiBtn} onPress={useAiFare} disabled={loading}>
            <Text style={styles.useAiBtnText}>Use This</Text>
          </TouchableOpacity>
        </View>

        {/* Bid display */}
        <View style={styles.bidDisplay}>
          <Text style={styles.bidLabel}>Your Bid</Text>
          <Text style={[styles.bidAmount, saving && styles.bidAmountSaving, premium && styles.bidAmountPremium]}>
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
        <TouchableOpacity
          style={styles.submitBtn}
          onPress={submitBid}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.submitBtnText}>Submit Bid · ${bidAmount.toFixed(2)}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
  bidAmount: {
    fontSize: 56,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  bidAmountSaving: { color: Colors.teal },
  bidAmountPremium: { color: Colors.gold },
  bidSavings: { fontSize: 13, color: Colors.teal, marginTop: 4 },
  bidPremium: { fontSize: 13, color: Colors.gold, marginTop: 4 },
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
});
