import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MAP_PROVIDER } from '../constants/map';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

interface NavigatingToPickupProps {
  tripId: string;
  pickupAddress: string;
  dropoffAddress: string;
  driverTakeHome: number;
}

export function NavigatingToPickupScreen({
  tripId,
  pickupAddress,
  dropoffAddress,
  driverTakeHome,
}: NavigatingToPickupProps) {
  const mapRef = useRef<MapView>(null);
  const [marking, setMarking] = useState(false);

  const markArrived = async () => {
    setMarking(true);
    try {
      await api.post(`/trips/${tripId}/arrived`, {});
      router.push({
        pathname: '/in-trip',
        params: { tripId, dropoffAddress, driverTakeHome: driverTakeHome.toString(), riderName: 'Rider', earningsFloorAmount: '0' },
      });
    } catch (err: any) {
      if (err.code === 'TRIP_INVALID_TRANSITION') {
        Alert.alert('Already marked', 'Trip status was already updated.');
        router.push({
          pathname: '/in-trip',
          params: { tripId, dropoffAddress, driverTakeHome: driverTakeHome.toString(), riderName: 'Rider', earningsFloorAmount: '0' },
        });
      } else {
        Alert.alert('Error', 'Could not mark arrived. Try again.');
      }
    } finally {
      setMarking(false);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={styles.map}
        customMapStyle={darkMapStyle}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.statusPill}>
          <Ionicons name="navigate" size={16} color={Colors.primary} />
          <Text style={styles.statusText}>Navigating to pickup</Text>
        </View>
      </View>

      {/* Bottom card */}
      <View style={styles.bottomCard}>
        <View style={styles.addressSection}>
          <View style={styles.addressRow}>
            <View style={[styles.dot, styles.dotPickup]} />
            <View style={styles.addressWrap}>
              <Text style={styles.addressLabel}>Pickup</Text>
              <Text style={styles.addressText} numberOfLines={2}>{pickupAddress}</Text>
            </View>
          </View>
        </View>

        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>Your take-home</Text>
          <Text style={styles.fareAmount}>${driverTakeHome.toFixed(2)}</Text>
        </View>

        <TouchableOpacity
          style={[styles.arrivedButton, marking && styles.arrivedButtonDisabled]}
          onPress={markArrived}
          disabled={marking}
        >
          {marking ? (
            <ActivityIndicator color={Colors.primaryText} />
          ) : (
            <Text style={styles.arrivedButtonText}>I've Arrived</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.arrivedHint}>Tap when you're at the pickup location</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 32,
    left: Spacing.base,
    right: Spacing.base,
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  statusText: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  bottomCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.base,
    paddingBottom: Platform.OS === 'ios' ? 44 : Spacing['2xl'],
  },
  addressSection: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.base,
  },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  dotPickup: { backgroundColor: Colors.primary },
  addressWrap: { flex: 1 },
  addressLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs, marginBottom: 2 },
  addressText: { color: Colors.text, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.base,
  },
  fareLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  fareAmount: {
    color: Colors.gold,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.extrabold,
    fontFamily: Typography.fontFamilyMono,
  },
  arrivedButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  arrivedButtonDisabled: { opacity: 0.6 },
  arrivedButtonText: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  arrivedHint: {
    color: Colors.textDisabled,
    fontSize: Typography.size.xs,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8FA8C8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
