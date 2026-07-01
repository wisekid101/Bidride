import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useTripStore } from '../store/trip.store';
import { useSocketStore } from '../store/socket.store';
import CounterOfferModal from './CounterOfferModal';

const STATUS_LABELS: Record<string, string> = {
  searching:        'Finding your driver...',
  accepted:         'Driver accepted!',
  driver_en_route:  'Driver is on the way',
  driver_arrived:   'Your driver has arrived',
  in_progress:      'Enjoy your ride',
  completed:        'You have arrived!',
};

export function TrackingScreen() {
  const { activeTrip, completedTrip, pendingCounter } = useTripStore();
  const { subscribeToTrip } = useSocketStore();
  const mapRef = useRef<MapView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Subscribe to trip-scoped socket events once trip is active
  useEffect(() => {
    if (activeTrip?.id) {
      subscribeToTrip(activeTrip.id);
    }
  }, [activeTrip?.id]);

  // Pulse animation for "searching" state
  useEffect(() => {
    if (activeTrip?.status === 'searching') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [activeTrip?.status]);

  useEffect(() => {
    if (completedTrip?.status === 'completed') {
      router.replace('/trip-complete');
    } else if (!activeTrip) {
      router.replace('/(tabs)');
    }
  }, [activeTrip, completedTrip]);

  if (!activeTrip) return null;

  const driverLocation = activeTrip.driverLocation;
  const statusLabel = STATUS_LABELS[activeTrip.status] ?? activeTrip.status;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        customMapStyle={darkMapStyle}
      >
        {driverLocation && (
          <Marker
            coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.driverMarker}>
              <Ionicons name="car" size={20} color={Colors.primaryText} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        {activeTrip.status === 'searching' && (
          <Animated.View style={[styles.searchingDot, { transform: [{ scale: pulseAnim }] }]} />
        )}
        <Text style={styles.statusText}>{statusLabel}</Text>
      </View>

      {/* Driver Card (shown after acceptance) */}
      {activeTrip.driverName && (
        <View style={styles.driverCard}>
          <View>
            <Text style={styles.driverName}>{activeTrip.driverName}</Text>
            {activeTrip.driverBadge && (
              <Text style={styles.driverBadge}>{activeTrip.driverBadge}</Text>
            )}
            <Text style={styles.vehicleInfo}>
              {activeTrip.vehicleColor} {activeTrip.vehicleMake} {activeTrip.vehicleModel}
            </Text>
            <Text style={styles.plate}>{activeTrip.licensePlate}</Text>
          </View>
          <View style={styles.farePreview}>
            <Text style={styles.fareLabel}>AI Fare</Text>
            <Text style={styles.fareAmount}>${activeTrip.aiFare.toFixed(2)}</Text>
          </View>
        </View>
      )}

      {/* SOS Button — always visible during trip */}
      <TouchableOpacity
        style={styles.sosButton}
        onPress={() => router.push('/sos')}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Emergency SOS"
        accessibilityHint="Opens emergency safety screen"
      >
        <Text style={styles.sosText}>SOS</Text>
      </TouchableOpacity>

      {/* Counter-offer modal — shown when driver counters during searching phase */}
      {pendingCounter && <CounterOfferModal counter={pendingCounter} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  map: { flex: 1 },
  statusBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 32,
    left: Spacing.base,
    right: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  searchingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
    marginRight: Spacing.sm,
  },
  statusText: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  driverCard: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    left: Spacing.base,
    right: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  driverName: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  driverBadge: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    marginTop: 2,
  },
  vehicleInfo: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginTop: 4,
  },
  plate: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    marginTop: 4,
  },
  farePreview: { alignItems: 'flex-end' },
  fareLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  fareAmount: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  sosButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 32,
    right: Spacing.base,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.safety,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.safety,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 12,
  },
  sosText: {
    color: Colors.safetyText,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: 1,
  },
  driverMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8FA8C8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
