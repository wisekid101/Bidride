import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  Platform,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

const ACCEPT_WINDOW_SECONDS = 15;

interface RequestCardProps {
  bidId: string;
  tripId: string;
  pickupAddress: string;
  dropoffAddress: string;
  aiFare: number;
  driverTakeHome: number; // Pre-calculated: riderOffer × 0.80
  distanceMiles: number;
  durationMin: number;
  isAirportTrip: boolean;
  riderBadge: 'Verified' | 'Trusted' | 'Business' | 'VIP';
  onAccepted: () => void;
  onDeclined: () => void;
  onCountered: () => void;
}

export function IncomingRequestScreen({
  bidId,
  tripId,
  pickupAddress,
  dropoffAddress,
  aiFare,
  driverTakeHome,
  distanceMiles,
  durationMin,
  isAirportTrip,
  riderBadge,
  onAccepted,
  onDeclined,
  onCountered,
}: RequestCardProps) {
  const [timeLeft, setTimeLeft] = useState(ACCEPT_WINDOW_SECONDS);
  const timerWidth = useRef(new Animated.Value(1)).current;
  const [loading, setLoading] = useState(false);
  const [showCounter, setShowCounter] = useState(false);
  const [counterInput, setCounterInput] = useState('');

  useEffect(() => {
    Vibration.vibrate([0, 400, 200, 400, 200, 400]);

    const anim = Animated.timing(timerWidth, {
      toValue: 0,
      duration: ACCEPT_WINDOW_SECONDS * 1000,
      useNativeDriver: false,
    });
    anim.start();

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onDeclined();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      anim.stop();
      clearInterval(interval);
      Vibration.cancel();
    };
  }, []);

  const accept = async () => {
    setLoading(true);
    try {
      await api.post(`/bids/${bidId}/accept`, {});
      onAccepted();
      router.push({
        pathname: '/navigating-to-pickup',
        params: { tripId, pickupAddress, dropoffAddress, driverTakeHome: driverTakeHome.toString() },
      });
    } catch (err: any) {
      if (err.code === 'ACCOUNT_UNDER_REVIEW') {
        Alert.alert('Account Under Review', 'Your account is under safety review. Please contact support.');
        onDeclined();
      } else if (err.code === 'BID_ALREADY_CLAIMED') {
        Alert.alert('Too slow', 'Another driver accepted this bid first.');
        onDeclined();
      } else {
        Alert.alert('Error', 'Could not accept bid. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const decline = async () => {
    try {
      await api.post(`/bids/${bidId}/decline`, {});
    } catch {}
    onDeclined();
  };

  const submitCounter = async () => {
    const amount = parseFloat(counterInput);
    const riderOffer = driverTakeHome / 0.80; // recover original riderOffer
    if (isNaN(amount) || amount <= riderOffer || amount >= aiFare) {
      Alert.alert(
        'Invalid counter',
        `Counter must be between $${riderOffer.toFixed(2)} and $${aiFare.toFixed(2)}.`,
      );
      return;
    }
    setLoading(true);
    try {
      await api.post(`/bids/${bidId}/counter`, { counterAmount: amount });
      onCountered();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not submit counter offer.');
    } finally {
      setLoading(false);
    }
  };

  const perMile = distanceMiles > 0 ? (driverTakeHome / distanceMiles).toFixed(2) : '—';

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {/* Timer bar */}
        <View style={styles.timerTrack}>
          <Animated.View
            style={[
              styles.timerFill,
              {
                width: timerWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>

        <View style={styles.timerRow}>
          <Text style={styles.timerText}>{timeLeft}s to respond</Text>
          {isAirportTrip && (
            <View style={styles.airportBadge}>
              <Ionicons name="airplane" size={12} color={Colors.primaryText} />
              <Text style={styles.airportBadgeText}>EWR</Text>
            </View>
          )}
        </View>

        {/* DRIVER TAKE-HOME LEADS — this is the primary metric */}
        <Text style={styles.takeHomeLabel}>Your take-home</Text>
        <Text style={styles.takeHomeAmount}>${driverTakeHome.toFixed(2)}</Text>
        <Text style={styles.perMileText}>${perMile}/mi · {distanceMiles.toFixed(1)} mi · ~{durationMin} min</Text>

        {/* Rider badge — label only, no score */}
        <View style={styles.riderRow}>
          <Text style={styles.riderLabel}>Rider</Text>
          <View style={[styles.badgeChip, riderBadge === 'VIP' && styles.badgeVip]}>
            <Text style={styles.badgeText}>{riderBadge}</Text>
          </View>
        </View>

        <View style={styles.addressSection}>
          <View style={styles.addressRow}>
            <View style={[styles.dot, styles.dotPickup]} />
            <View style={styles.addressTextWrap}>
              <Text style={styles.addressLabel}>Pickup</Text>
              <Text style={styles.addressText} numberOfLines={1}>{pickupAddress}</Text>
            </View>
          </View>
          <View style={styles.addressRow}>
            <View style={[styles.dot, styles.dotDropoff]} />
            <View style={styles.addressTextWrap}>
              <Text style={styles.addressLabel}>Dropoff</Text>
              <Text style={styles.addressText} numberOfLines={1}>{dropoffAddress}</Text>
            </View>
          </View>
        </View>

        {showCounter ? (
          <View style={styles.counterSection}>
            <TextInput
              style={styles.counterInput}
              value={counterInput}
              onChangeText={setCounterInput}
              placeholder={`$${(driverTakeHome / 0.80 + 0.01).toFixed(2)} – $${(aiFare - 0.01).toFixed(2)}`}
              placeholderTextColor={Colors.textSecondary}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.declineButton}
                onPress={() => { setShowCounter(false); setCounterInput(''); }}
              >
                <Text style={styles.declineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.acceptButton, loading && styles.acceptButtonLoading]}
                onPress={submitCounter}
                disabled={loading}
              >
                <Text style={styles.acceptText}>{loading ? 'Sending...' : 'Send Counter'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.declineButton} onPress={decline} disabled={loading}>
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.counterButton} onPress={() => setShowCounter(true)} disabled={loading}>
              <Text style={styles.counterText}>Counter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptButton, loading && styles.acceptButtonLoading]}
              onPress={accept}
              disabled={loading}
            >
              <Text style={styles.acceptText}>
                {loading ? 'Accepting...' : `Accept · $${driverTakeHome.toFixed(2)}`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: Spacing.base,
    paddingBottom: Platform.OS === 'ios' ? 40 : Spacing['2xl'],
  },
  timerTrack: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  timerFill: {
    height: 4,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  timerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  timerText: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  airportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    gap: 4,
  },
  airportBadgeText: { color: Colors.primaryText, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },

  // Driver take-home is the largest, most prominent element
  takeHomeLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  takeHomeAmount: {
    color: Colors.gold,
    fontSize: 52,
    fontWeight: Typography.weight.extrabold,
    fontFamily: Typography.fontFamilyMono,
    marginTop: 2,
  },
  perMileText: { color: Colors.textSecondary, fontSize: Typography.size.sm, marginBottom: Spacing.md },

  riderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  riderLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  badgeChip: {
    backgroundColor: Colors.primary + '22',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  badgeVip: { backgroundColor: Colors.gold + '22' },
  badgeText: { color: Colors.primary, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },

  addressSection: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.base,
    gap: Spacing.sm,
  },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotPickup: { backgroundColor: Colors.primary },
  dotDropoff: { backgroundColor: Colors.gold },
  addressTextWrap: { flex: 1 },
  addressLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  addressText: { color: Colors.text, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },

  counterSection: { gap: Spacing.sm },
  counterInput: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    color: Colors.text,
    fontSize: Typography.size.md,
    fontFamily: Typography.fontFamilyMono,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    textAlign: 'center',
  },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm },
  counterButton: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  counterText: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  declineButton: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  declineText: { color: Colors.textSecondary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold },
  acceptButton: {
    flex: 2,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  acceptButtonLoading: { opacity: 0.7 },
  acceptText: { color: Colors.primaryText, fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
});
