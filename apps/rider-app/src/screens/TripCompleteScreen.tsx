import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Star } from 'lucide-react-native';
import { Colors, Fonts } from '../constants/theme';
import { useAuthStore } from '../store/auth.store';
import { useTripStore } from '../store/trip.store';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

export default function TripCompleteScreen({ navigation, route }: Props) {
  const { accessToken } = useAuthStore();
  const { activeTrip, clearCompletedTrip } = useTripStore();
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const tripId = route.params?.tripId ?? activeTrip?.id;
  const finalFare = route.params?.finalFare ?? activeTrip?.finalFare ?? 0;
  const driverName = route.params?.driverName ?? activeTrip?.driverName ?? 'Your Driver';
  const pickupAddress = route.params?.pickupAddress ?? activeTrip?.pickupAddress ?? '';
  const dropoffAddress = route.params?.dropoffAddress ?? activeTrip?.dropoffAddress ?? '';

  const submitRating = async () => {
    if (rating === 0) {
      Alert.alert('Rate Your Ride', 'Please select a star rating before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await fetch(`${API_URL}/trips/${tripId}/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ riderRating: rating }),
      });

      setSubmitted(true);
    } catch {
      // Rating is non-critical — don't block the user
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const done = () => {
    clearCompletedTrip();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.checkmark}>✓</Text>
          <Text style={styles.title}>Trip Complete</Text>
        </View>

        {/* Fare summary */}
        <View style={styles.fareCard}>
          <Text style={styles.fareLabel}>Total Fare</Text>
          <Text style={styles.fareAmount}>${parseFloat(finalFare).toFixed(2)}</Text>
          <Text style={styles.fareNote}>Charged to card on file</Text>
        </View>

        {/* Route */}
        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={styles.routeDot} />
            <Text style={styles.routeAddress} numberOfLines={2}>{pickupAddress}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.routeDotEnd]} />
            <Text style={styles.routeAddress} numberOfLines={2}>{dropoffAddress}</Text>
          </View>
        </View>

        {/* Rating */}
        {!submitted ? (
          <View style={styles.ratingSection}>
            <Text style={styles.ratingTitle}>How was {driverName}?</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)}>
                  <Star
                    size={40}
                    color={star <= rating ? Colors.gold : Colors.border}
                    fill={star <= rating ? Colors.gold : 'transparent'}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.ratingBtn, (rating === 0 || submitting) && styles.ratingBtnDisabled]}
              onPress={submitRating}
              disabled={rating === 0 || submitting}
            >
              <Text style={styles.ratingBtnText}>
                {submitting ? 'Submitting…' : 'Submit Rating'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={done} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.thankYouSection}>
            <Text style={styles.thankYouText}>Thanks for your feedback!</Text>
          </View>
        )}
      </ScrollView>

      {submitted && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.doneBtn} onPress={done}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 },
  header: { alignItems: 'center', marginBottom: 32 },
  checkmark: { fontSize: 56, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  fareCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  fareLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  fareAmount: {
    fontSize: 48,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  fareNote: { fontSize: 12, color: Colors.textTertiary },
  routeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 32,
    gap: 4,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.teal,
    flexShrink: 0,
  },
  routeDotEnd: { backgroundColor: Colors.safety },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: Colors.border,
    marginLeft: 4,
    marginVertical: 4,
  },
  routeAddress: { fontSize: 14, color: Colors.textPrimary, flex: 1 },
  ratingSection: { alignItems: 'center', gap: 16 },
  ratingTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  stars: { flexDirection: 'row', gap: 8 },
  ratingBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  ratingBtnDisabled: { opacity: 0.5 },
  ratingBtnText: { fontSize: 16, fontWeight: '700', color: Colors.background },
  skipBtn: { padding: 8 },
  skipText: { fontSize: 14, color: Colors.textTertiary },
  thankYouSection: { alignItems: 'center', padding: 24 },
  thankYouText: { fontSize: 18, color: Colors.teal, fontWeight: '700' },
  footer: { padding: 24, paddingBottom: 32 },
  doneBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
