import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../../src/constants/theme';
import { api } from '../../src/api/client';

interface TripSummary {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  aiFare: number;
  finalFare: number | null;
  createdAt: string;
  completedAt: string | null;
  driverName: string | null;
}

function formatTripDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

export default function TripsScreen() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchTrips = useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .get<{ trips: TripSummary[] }>('/riders/me/trips?limit=30')
      .then((res) => setTrips(res.trips))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const renderTrip = ({ item }: { item: TripSummary }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/trip-detail?tripId=${item.id}`)}
      activeOpacity={0.75}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardDate}>{formatTripDate(item.createdAt)}</Text>
        <Text style={[
          styles.cardStatus,
          item.status === 'completed' ? styles.statusCompleted : styles.statusCancelled,
        ]}>
          {item.status === 'completed' ? 'Completed' : 'Cancelled'}
        </Text>
      </View>

      <Text style={styles.cardPickup} numberOfLines={1}>{item.pickupAddress}</Text>
      <Text style={styles.cardDropoff} numberOfLines={1}>{item.dropoffAddress}</Text>

      <View style={styles.cardBottom}>
        <Text style={styles.cardDriver} numberOfLines={1}>
          {item.driverName ?? ''}
        </Text>
        <Text style={styles.cardFare}>
          {item.finalFare != null
            ? `$${item.finalFare.toFixed(2)}`
            : item.aiFare != null
            ? `$${item.aiFare.toFixed(2)}`
            : '—'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Trips</Text>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={styles.centered} />
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Could not load trips.</Text>
          <TouchableOpacity onPress={fetchTrips} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            trips.length === 0 && styles.listEmpty,
          ]}
          renderItem={renderTrip}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No trips yet</Text>
              <Text style={styles.emptySubtext}>
                Your completed trips will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  title: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    paddingHorizontal: Spacing.base,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: Spacing.sm,
  },
  list: { padding: Spacing.base, gap: Spacing.sm },
  listEmpty: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 4,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardDate: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
  },
  cardStatus: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  statusCompleted: { color: Colors.primary },
  statusCancelled: { color: Colors.textSecondary },
  cardPickup: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
  },
  cardDropoff: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  cardDriver: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    flex: 1,
  },
  cardFare: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  emptyWrap: { alignItems: 'center', paddingTop: 80 },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    textAlign: 'center',
  },
  emptySubtext: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    textAlign: 'center',
    marginTop: Spacing.xs,
    opacity: 0.7,
  },
  retryBtn: { marginTop: Spacing.md },
  retryText: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
});
