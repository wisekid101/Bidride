import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Colors, Fonts, Typography } from '../constants/theme';
import { useAuthStore } from '../store/auth.store';
import { useTripStore, PendingCounter } from '../store/trip.store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';
const COUNTER_TTL_SECONDS = 60;

interface Props {
  counter: PendingCounter;
}

export default function CounterOfferModal({ counter }: Props) {
  const { accessToken } = useAuthStore();
  const { clearPendingCounter, updateTripStatus } = useTripStore();

  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const remaining = Math.floor((new Date(counter.expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, Math.min(remaining, COUNTER_TTL_SECONDS));
  });
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          // Server sweep will emit bid:counterExpired — just clear modal state
          clearPendingCounter();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const respond = useCallback(async (action: 'accept' | 'decline') => {
    setLoading(action);
    const endpoint = action === 'accept'
      ? `${API_URL}/bids/${counter.bidId}/counter/accept`
      : `${API_URL}/bids/${counter.bidId}/counter/decline`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message ?? 'Request failed');
      }

      clearPendingCounter();
      if (action === 'accept') {
        updateTripStatus('accepted');
      }
    } catch (err: unknown) {
      Alert.alert('Error', (err as Error).message ?? 'Please try again.');
    } finally {
      setLoading(null);
    }
  }, [counter.bidId, accessToken]);

  const savings = counter.aiFare - counter.counterAmount;
  const urgent = secondsLeft <= 15;

  return (
    <Modal transparent animationType="slide" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <Text style={styles.heading}>Driver Made a Counter Offer</Text>

          {/* Fare comparison row */}
          <View style={styles.fareRow}>
            <View style={styles.fareCell}>
              <Text style={styles.fareCellLabel}>Your Offer</Text>
              <Text style={styles.fareCellAmount}>${counter.riderOffer.toFixed(2)}</Text>
            </View>
            <View style={styles.fareDivider} />
            <View style={styles.fareCell}>
              <Text style={styles.fareCellLabel}>AI Fare</Text>
              <Text style={styles.fareCellAmount}>${counter.aiFare.toFixed(2)}</Text>
            </View>
          </View>

          {/* Counter amount — prominently shown */}
          <View style={styles.counterBlock}>
            <Text style={styles.counterLabel}>Driver Counter</Text>
            <Text style={styles.counterAmount}>${counter.counterAmount.toFixed(2)}</Text>
            {savings > 0 && (
              <Text style={styles.savingsText}>
                ${savings.toFixed(2)} below AI fare
              </Text>
            )}
          </View>

          {/* Countdown */}
          <View style={[styles.countdownRow, urgent && styles.countdownUrgent]}>
            <Text style={[styles.countdownLabel, urgent && styles.countdownLabelUrgent]}>
              Expires in
            </Text>
            <Text style={[styles.countdownValue, urgent && styles.countdownValueUrgent]}>
              {formatTime(secondsLeft)}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.acceptBtn, loading !== null && styles.btnDisabled]}
              onPress={() => respond('accept')}
              disabled={loading !== null || secondsLeft === 0}
            >
              {loading === 'accept' ? (
                <ActivityIndicator color={Colors.background} />
              ) : (
                <Text style={styles.acceptBtnText}>Accept ${counter.counterAmount.toFixed(2)}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.declineBtn, loading !== null && styles.btnDisabled]}
              onPress={() => respond('decline')}
              disabled={loading !== null || secondsLeft === 0}
            >
              {loading === 'decline' ? (
                <ActivityIndicator color={Colors.textSecondary} />
              ) : (
                <Text style={styles.declineBtnText}>Decline</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    gap: 20,
  },
  heading: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  fareRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  fareCell: { flex: 1, alignItems: 'center', gap: 4 },
  fareCellLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  fareCellAmount: {
    fontSize: Typography.size.lg,
    fontFamily: Fonts.mono,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  fareDivider: { width: 1, height: 32, backgroundColor: Colors.border },
  counterBlock: { alignItems: 'center', gap: 6 },
  counterLabel: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  counterAmount: {
    fontSize: 52,
    fontFamily: Fonts.mono,
    fontWeight: Typography.weight.extrabold,
    color: Colors.teal,
  },
  savingsText: { fontSize: Typography.size.sm, color: Colors.teal },
  countdownRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingVertical: 12,
  },
  countdownUrgent: { backgroundColor: Colors.safety + '20' },
  countdownLabel: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  countdownLabelUrgent: { color: Colors.safety },
  countdownValue: {
    fontSize: Typography.size.xl,
    fontFamily: Fonts.mono,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  countdownValueUrgent: { color: Colors.safety },
  actions: { gap: 10 },
  acceptBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  acceptBtnText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.background,
  },
  declineBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  declineBtnText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
  btnDisabled: { opacity: 0.5 },
});
