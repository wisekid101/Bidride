import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../src/constants/theme';
import { api } from '../src/api/client';

export default function RateRiderScreen() {
  const { tripId, riderName } = useLocalSearchParams<{ tripId: string; riderName?: string }>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [flagRider, setFlagRider] = useState(false);
  const [commentFocused, setCommentFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const displayName = riderName ?? 'Your Rider';

  const submit = async () => {
    if (rating === 0) {
      Alert.alert('Rate Your Rider', 'Please select a star rating before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/trips/${tripId}/rate-rider`, {
        rating,
        ...(comment.trim() && { comment: comment.trim() }),
        ...(flagRider && { flagRider: true }),
      });
    } catch {
      // Rating is non-critical — navigate home regardless
    } finally {
      setSubmitting(false);
      router.replace('/(tabs)');
    }
  };

  const skip = () => router.replace('/(tabs)');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>How was {displayName}?</Text>

      {/* Stars */}
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => setRating(star)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            testID={`rate-star-${star}`}
            accessibilityRole="button"
            accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
          >
            <Text style={[styles.star, star <= rating && styles.starSelected]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Comment */}
      <TextInput
        style={[styles.commentInput, commentFocused && styles.commentInputFocused]}
        placeholder="Add a comment (optional)"
        placeholderTextColor={Colors.textSecondary}
        value={comment}
        onChangeText={setComment}
        onFocus={() => setCommentFocused(true)}
        onBlur={() => setCommentFocused(false)}
        multiline
        maxLength={200}
        textAlignVertical="top"
      />

      {/* Safety flag */}
      <View style={styles.flagRow}>
        <Text style={styles.flagLabel}>Report a safety concern</Text>
        <Switch
          value={flagRider}
          onValueChange={setFlagRider}
          trackColor={{ false: Colors.border, true: Colors.safety }}
          thumbColor={Colors.text}
          testID="rate-safety-toggle"
          accessibilityLabel="Report a safety concern"
        />
      </View>
      {flagRider ? (
        <Text style={styles.flagNote}>
          This will be reviewed by our safety team.
        </Text>
      ) : null}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitBtn, (rating === 0 || submitting) && styles.submitBtnDisabled]}
        onPress={submit}
        disabled={rating === 0 || submitting}
        testID="rate-submit"
        accessibilityRole="button"
        accessibilityLabel="Submit rating"
      >
        {submitting ? (
          <ActivityIndicator color={Colors.primaryText} />
        ) : (
          <Text style={styles.submitBtnText}>Submit Rating</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={skip} style={styles.skipBtn} testID="rate-skip" accessibilityRole="button" accessibilityLabel="Skip rating">
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    padding: Spacing.xl,
    paddingTop: Spacing['2xl'],
    alignItems: 'center',
    gap: Spacing.base,
    paddingBottom: Spacing['3xl'],
  },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.bold,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  starsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  star: {
    fontSize: 44,
    color: Colors.border,
  },
  starSelected: {
    color: Colors.primary,
  },
  commentInput: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: Typography.size.base,
    padding: Spacing.md,
    minHeight: 80,
  },
  commentInputFocused: {
    borderColor: Colors.primary,
  },
  flagRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.base,
  },
  flagLabel: {
    color: Colors.text,
    fontSize: Typography.size.base,
    flex: 1,
  },
  flagNote: {
    color: Colors.safety,
    fontSize: Typography.size.sm,
    alignSelf: 'flex-start',
    marginTop: -Spacing.sm,
  },
  submitBtn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.base,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  skipBtn: { padding: Spacing.sm },
  skipText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
  },
});
