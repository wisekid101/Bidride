import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../src/constants/theme';
import { api } from '../src/api/client';

interface TripDetail {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  aiFare: number;
  finalFare: number | null;
  rideType: string;
  isAirportTrip: boolean;
  routeDistanceMiles: number | null;
  actualDurationMin: number | null;
  cancelReason: string | null;
  createdAt: string;
  completedAt: string | null;
  riderRatingDriver: number | null;
  driverName: string | null;
  vehicle: {
    make: string | null;
    model: string | null;
    color: string | null;
    licensePlate: string | null;
  } | null;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <Text style={styles.stars}>
      {'★'.repeat(rating)}{'☆'.repeat(Math.max(0, 5 - rating))}
    </Text>
  );
}

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchTrip = () => {
    if (!tripId) return;
    setLoading(true);
    setError(false);
    api
      .get<TripDetail>(`/riders/me/trips/${tripId}`)
      .then((data) => setTrip(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTrip();
  }, [tripId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (error || !trip) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load trip details.</Text>
        <TouchableOpacity onPress={fetchTrip} style={styles.retryBtn}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const vehicleLabel = trip.vehicle
    ? [trip.vehicle.color, trip.vehicle.make, trip.vehicle.model].filter(Boolean).join(' ')
    : null;

  const isCompleted = trip.status === 'completed';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header: date + status */}
      <View style={styles.headerCard}>
        <Text style={styles.dateText}>{formatDateTime(trip.createdAt)}</Text>
        <View style={[styles.statusChip, isCompleted ? styles.chipCompleted : styles.chipCancelled]}>
          <Text style={[styles.statusChipText, isCompleted ? styles.chipTextCompleted : styles.chipTextCancelled]}>
            {isCompleted ? 'Completed' : 'Cancelled'}
          </Text>
        </View>
      </View>

      {/* Route */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ROUTE</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>From</Text>
          <Text style={styles.rowValue} numberOfLines={2}>{trip.pickupAddress}</Text>
        </View>
        <View style={[styles.row, styles.rowLast]}>
          <Text style={styles.rowLabel}>To</Text>
          <Text style={styles.rowValue} numberOfLines={2}>{trip.dropoffAddress}</Text>
        </View>
      </View>

      {/* Driver & Vehicle */}
      {(trip.driverName || vehicleLabel) ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DRIVER</Text>
          {trip.driverName ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>{trip.driverName}</Text>
            </View>
          ) : null}
          {vehicleLabel ? (
            <View style={[styles.row, !trip.vehicle?.licensePlate && styles.rowLast]}>
              <Text style={styles.rowLabel}>Vehicle</Text>
              <Text style={styles.rowValue}>{vehicleLabel}</Text>
            </View>
          ) : null}
          {trip.vehicle?.licensePlate ? (
            <View style={styles.rowLast}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Plate</Text>
                <Text style={[styles.rowValue, styles.rowValueMono]}>
                  {trip.vehicle.licensePlate}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Trip Info */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>TRIP INFO</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Distance</Text>
          <Text style={styles.rowValue}>
            {trip.routeDistanceMiles != null
              ? `${trip.routeDistanceMiles.toFixed(1)} mi`
              : '—'}
          </Text>
        </View>
        <View style={[styles.row, styles.rowLast]}>
          <Text style={styles.rowLabel}>Duration</Text>
          <Text style={styles.rowValue}>
            {trip.actualDurationMin != null ? `${trip.actualDurationMin} min` : '—'}
          </Text>
        </View>
      </View>

      {/* Fare */}
      {isCompleted || trip.finalFare != null ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FARE</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>AI Fare</Text>
            <Text style={styles.rowValue}>${trip.aiFare.toFixed(2)}</Text>
          </View>
          {trip.finalFare != null ? (
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.rowLabel}>Final</Text>
              <Text style={[styles.rowValue, styles.fareAmount]}>
                ${trip.finalFare.toFixed(2)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Your rating */}
      {trip.riderRatingDriver != null ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>YOUR RATING</Text>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.rowLabel}>Driver</Text>
            <StarRating rating={trip.riderRatingDriver} />
          </View>
        </View>
      ) : null}

      {/* Cancellation reason */}
      {trip.status === 'cancelled' && trip.cancelReason ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CANCELLATION</Text>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={[styles.rowValue, styles.cancelReasonText]}>
              {trip.cancelReason}
            </Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.base, gap: Spacing.sm, paddingBottom: Spacing['3xl'] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  errorText: { color: Colors.textSecondary, fontSize: Typography.size.base },
  retryBtn: { marginTop: Spacing.md },
  retryText: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  headerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  dateText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  chipCompleted: { borderColor: Colors.primary },
  chipCancelled: { borderColor: Colors.textSecondary },
  statusChipText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  chipTextCompleted: { color: Colors.primary },
  chipTextCancelled: { color: Colors.textSecondary },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    width: 72,
    flexShrink: 0,
    paddingTop: 1,
  },
  rowValue: {
    color: Colors.text,
    fontSize: Typography.size.base,
    flex: 1,
    flexWrap: 'wrap',
  },
  rowValueMono: {
    fontFamily: Typography.fontFamilyMono,
    fontWeight: Typography.weight.bold,
  },
  fareAmount: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
    color: Colors.text,
  },
  stars: {
    color: Colors.primary,
    fontSize: Typography.size.lg,
    letterSpacing: 2,
  },
  cancelReasonText: {
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
});
