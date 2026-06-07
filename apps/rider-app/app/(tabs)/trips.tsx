import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../../src/constants/theme';
import { api } from '../../src/api/client';
import { useEffect, useState } from 'react';

interface TripSummary {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  finalFare: number;
  status: string;
  completedAt: string;
}

export default function TripsScreen() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ trips: TripSummary[] }>('/trips?limit=20')
      .then((res) => setTrips(res.trips))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Trips</Text>
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card}>
            <Text style={styles.cardDate}>
              {new Date(item.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
            <Text style={styles.cardAddress} numberOfLines={1}>{item.dropoffAddress}</Text>
            <Text style={styles.cardFare}>${item.finalFare?.toFixed(2) ?? '—'}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>{loading ? 'Loading...' : 'No trips yet'}</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  title: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    padding: Spacing.base,
    paddingTop: 60,
  },
  list: { paddingHorizontal: Spacing.base, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDate: { color: Colors.textSecondary, fontSize: Typography.size.sm, width: 60 },
  cardAddress: { color: Colors.text, fontSize: Typography.size.base, flex: 1, marginHorizontal: Spacing.sm },
  cardFare: { color: Colors.text, fontSize: Typography.size.base, fontWeight: Typography.weight.bold, fontFamily: 'JetBrainsMono-Bold' },
  empty: { color: Colors.textSecondary, textAlign: 'center', marginTop: 48 },
});
