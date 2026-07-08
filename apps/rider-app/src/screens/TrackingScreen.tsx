import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Image,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { MAP_PROVIDER } from '../constants/map';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useTripStore } from '../store/trip.store';
import { useSocketStore } from '../store/socket.store';
import CounterOfferModal from './CounterOfferModal';
import { api } from '../api/client';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const CANCELLABLE_STATUSES = new Set(['searching', 'accepted', 'driver_en_route']);

const STATUS_LABELS: Record<string, string> = {
  searching:        'Finding your driver...',
  accepted:         'Driver accepted!',
  driver_en_route:  'Driver is on the way',
  driver_arrived:   'Your driver has arrived',
  in_progress:      'Enjoy your ride',
  completed:        'You have arrived!',
};

interface GoogleDirectionsResponse {
  routes: Array<{
    overview_polyline: { points: string };
    legs: Array<{ duration: { text: string; value: number } }>;
  }>;
}

function decodePolyline(encoded: string): Array<{ latitude: number; longitude: number }> {
  const coords: Array<{ latitude: number; longitude: number }> = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

export function TrackingScreen() {
  const { activeTrip, completedTrip, pendingCounter } = useTripStore();
  const { subscribeToTrip } = useSocketStore();
  const mapRef = useRef<MapView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [routeCoords, setRouteCoords] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [localEta, setLocalEta] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const fetchedForStatus = useRef<string | null>(null);

  useEffect(() => {
    if (activeTrip?.id) {
      subscribeToTrip(activeTrip.id);
    }
  }, [activeTrip?.id]);

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

  // Fetch route polyline + ETA from Google Directions when driver location becomes known
  useEffect(() => {
    const status = activeTrip?.status;
    const driverLoc = activeTrip?.driverLocation;

    if (!activeTrip || !status) return;

    if (['searching', 'completed', 'cancelled'].includes(status)) {
      setRouteCoords([]);
      setLocalEta(null);
      fetchedForStatus.current = null;
      return;
    }

    // Re-fetch only when status changes — avoids hammering Directions API on every GPS update
    if (!driverLoc || fetchedForStatus.current === status) return;

    const isInProgress = status === 'in_progress';
    const destLat = isInProgress ? activeTrip.dropoffLat : activeTrip.pickupLat;
    const destLng = isInProgress ? activeTrip.dropoffLng : activeTrip.pickupLng;

    if (!destLat || !destLng || !GOOGLE_MAPS_KEY) return;

    fetchedForStatus.current = status;

    fetch(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${driverLoc.lat},${driverLoc.lng}&destination=${destLat},${destLng}&key=${GOOGLE_MAPS_KEY}`,
    )
      .then((res) => res.json() as Promise<GoogleDirectionsResponse>)
      .then((data) => {
        const route = data.routes?.[0];
        if (!route) return;
        setRouteCoords(decodePolyline(route.overview_polyline.points));
        const etaDuration = route.legs?.[0]?.duration?.text;
        if (etaDuration) setLocalEta(etaDuration);
      })
      .catch(() => {});
  }, [activeTrip?.status, activeTrip?.driverLocation]);

  const handleCancelRide = async () => {
    if (!activeTrip?.id || cancelling) return;
    setCancelling(true);
    try {
      await api.delete(`/trips/${activeTrip.id}`);
      router.replace('/(tabs)');
    } catch {
      setCancelling(false);
    }
  };

  if (!activeTrip) return null;

  const driverLocation = activeTrip.driverLocation;
  const statusLabel = STATUS_LABELS[activeTrip.status] ?? activeTrip.status;
  const displayEta = activeTrip.estimatedArrival ?? localEta;
  const canCancel = CANCELLABLE_STATUSES.has(activeTrip.status);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={styles.map}
        customMapStyle={darkMapStyle}
        initialRegion={
          activeTrip.pickupLat && activeTrip.pickupLng
            ? {
                latitude: Number(activeTrip.pickupLat),
                longitude: Number(activeTrip.pickupLng),
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }
            : undefined
        }
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
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={Colors.primary}
            strokeWidth={3}
          />
        )}
      </MapView>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        {activeTrip.status === 'searching' && (
          <Animated.View style={[styles.searchingDot, { transform: [{ scale: pulseAnim }] }]} />
        )}
        <Text style={styles.statusText}>{statusLabel}</Text>
      </View>

      {/* Driver Card (shown after driver is assigned) */}
      {activeTrip.driverName && (
        <View style={styles.driverCard}>
          <View style={styles.driverCardRow}>
            <View style={styles.driverCardLeft}>
              {activeTrip.driverPhotoUrl ? (
                <Image source={{ uri: activeTrip.driverPhotoUrl }} style={styles.driverPhoto} />
              ) : (
                <View style={styles.driverPhotoPlaceholder}>
                  <Ionicons name="person" size={24} color={Colors.textSecondary} />
                </View>
              )}
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>{activeTrip.driverName}</Text>
                {activeTrip.driverBadge && (
                  <Text style={styles.driverBadge}>{activeTrip.driverBadge}</Text>
                )}
                <Text style={styles.vehicleInfo}>
                  {activeTrip.vehicleColor} {activeTrip.vehicleMake} {activeTrip.vehicleModel}
                </Text>
                <Text style={styles.plate}>{activeTrip.licensePlate}</Text>
              </View>
            </View>
            <View style={styles.farePreview}>
              {displayEta && (
                <>
                  <Text style={styles.fareLabel}>ETA</Text>
                  <Text style={styles.etaText}>{displayEta}</Text>
                </>
              )}
              <Text style={styles.fareLabel}>AI Fare</Text>
              <Text style={styles.fareAmount}>${activeTrip.aiFare.toFixed(2)}</Text>
            </View>
          </View>

          {canCancel && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancelRide}
              disabled={cancelling}
              accessibilityRole="button"
              accessibilityLabel="Cancel ride"
            >
              <Text style={styles.cancelText}>
                {cancelling ? 'Cancelling...' : 'Cancel Ride'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Standalone cancel button during searching state (no driver card yet) */}
      {canCancel && !activeTrip.driverName && (
        <TouchableOpacity
          style={styles.cancelButtonFloating}
          onPress={handleCancelRide}
          disabled={cancelling}
          accessibilityRole="button"
          accessibilityLabel="Cancel ride"
        >
          <Text style={styles.cancelText}>
            {cancelling ? 'Cancelling...' : 'Cancel Ride'}
          </Text>
        </TouchableOpacity>
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
    right: 72,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  driverCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  driverCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: Spacing.sm,
  },
  driverPhoto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: Spacing.sm,
  },
  driverPhotoPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  driverInfo: { flex: 1 },
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
  etaText: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.sm,
  },
  fareAmount: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  cancelButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelButtonFloating: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    left: Spacing.base,
    right: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
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
