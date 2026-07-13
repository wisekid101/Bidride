import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Star } from 'lucide-react-native';
import { Colors, Fonts } from '../constants/theme';
import { useTripStore } from '../store/trip.store';
import { api } from '../api/client';

export default function TripCompleteScreen() {
  const { activeTrip, completedTrip, clearCompletedTrip } = useTripStore();
  const params = useLocalSearchParams<{
    tripId?: string;
    finalFare?: string;
    driverName?: string;
    pickupAddress?: string;
    dropoffAddress?: string;
  }>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [commentFocused, setCommentFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const tripId = params.tripId ?? completedTrip?.id ?? activeTrip?.id;
  const finalFare = completedTrip?.finalFare ?? params.finalFare ?? activeTrip?.finalFare ?? 0;
  const driverName = params.driverName ?? completedTrip?.driverName ?? activeTrip?.driverName ?? 'Your Driver';
  const pickupAddress = params.pickupAddress ?? completedTrip?.pickupAddress ?? activeTrip?.pickupAddress ?? '';
  const dropoffAddress = params.dropoffAddress ?? completedTrip?.dropoffAddress ?? activeTrip?.dropoffAddress ?? '';

  const aiFare = completedTrip?.aiFare ?? activeTrip?.aiFare;
  const savings = aiFare != null ? Math.max(0, aiFare - parseFloat(String(finalFare))) : 0;

  const submitRating = async () => {
    if (rating === 0) {
      Alert.alert('Rate Your Ride', 'Please select a star rating before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/trips/${tripId}/rate`, {
        rating,
        ...(comment.trim() && { comment: comment.trim() }),
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
    router.replace('/(tabs)');
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
          <Text style={styles.fareAmount}>${parseFloat(String(finalFare)).toFixed(2)}</Text>
          {savings > 0.01 && (
            <View style={styles.savingsRow}>
              <Text style={styles.savingsText}>You saved ${savings.toFixed(2)} vs AI fare</Text>
            </View>
          )}
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
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                  testID={`rate-star-${star}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
                >
                  <Star
                    size={40}
                    color={star <= rating ? Colors.gold : Colors.border}
                    fill={star <= rating ? Colors.gold : 'transparent'}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.commentInput, commentFocused && styles.commentInputFocused]}
              placeholder="Add a comment (optional)"
              placeholderTextColor={Colors.textTertiary}
              value={comment}
              onChangeText={setComment}
              onFocus={() => setCommentFocused(true)}
              onBlur={() => setCommentFocused(false)}
              multiline
              maxLength={200}
            />

            <TouchableOpacity
              style={[styles.ratingBtn, (rating === 0 || submitting) && styles.ratingBtnDisabled]}
              onPress={submitRating}
              disabled={rating === 0 || submitting}
              testID="rate-submit"
              accessibilityRole="button"
              accessibilityLabel="Submit rating"
            >
              <Text style={styles.ratingBtnText}>
                {submitting ? 'Submitting…' : 'Submit Rating'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={done} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => Alert.alert('Report an Issue', 'For lost items or trip issues, please email support@bidride.com.')}
              style={styles.reportBtn}
            >
              <Text style={styles.reportText}>Report an issue</Text>
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
  savingsRow: {
    backgroundColor: Colors.teal + '20',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
    marginBottom: 2,
  },
  savingsText: { fontSize: 13, fontWeight: '600', color: Colors.teal },
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
  commentInput: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    fontSize: 14,
    padding: 12,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  commentInputFocused: {
    borderColor: Colors.teal,
  },
  reportBtn: { marginTop: 4, padding: 8 },
  reportText: { fontSize: 13, color: Colors.textTertiary, textDecorationLine: 'underline' },
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
