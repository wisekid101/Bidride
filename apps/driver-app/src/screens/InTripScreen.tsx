import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Vibration,
  PanResponder,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';
import { useDriverSocketStore } from '../store/socket.store';

interface InTripProps {
  tripId: string;
  riderName: string;
  dropoffAddress: string;
  driverTakeHome: number;
  earningsFloorAmount: number;
}

export function InTripScreen({
  tripId,
  riderName,
  dropoffAddress,
  driverTakeHome,
  earningsFloorAmount,
}: InTripProps) {
  const navigation = useNavigation<any>();
  const mapRef = useRef<MapView>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [elapsedMin, setElapsedMin] = useState(0);
  const [ending, setEnding] = useState(false);

  // Track elapsed time
  useEffect(() => {
    const timer = setInterval(() => setElapsedMin((m) => m + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // Real-time GPS streaming
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 15 },
        (pos) => {
          setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          useDriverSocketStore.getState().emitLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.heading ?? undefined, tripId);
        },
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  // Panic mode: triple-tap on the shield — uses raw touch events intentionally
  // NOT in accessibility tree per spec — gesture cannot be discovered via accessibility inspection
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panicPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        tapCountRef.current += 1;
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 600);

        if (tapCountRef.current >= 3) {
          tapCountRef.current = 0;
          triggerPanicMode();
        }
      },
    }),
  ).current;

  const triggerPanicMode = () => {
    Vibration.vibrate(200); // Single short vibration — silent, discreet per spec
    api.post('/safety/panic', { tripId }).catch(console.error);
  };

  const endTrip = async () => {
    if (!currentLocation) {
      Alert.alert('Error', 'Cannot end trip — location unavailable.');
      return;
    }
    setEnding(true);
    try {
      await api.post(`/trips/${tripId}/end`, {
        currentLat: currentLocation.lat,
        currentLng: currentLocation.lng,
      });
      navigation.navigate('TripComplete', { tripId });
    } catch (err: any) {
      if (err.code === 'TRIP_TOO_FAR_FROM_DROPOFF') {
        Alert.alert('Too far', 'You must be within 0.2 miles of the dropoff to end the trip.');
      } else {
        Alert.alert('Error', 'Could not end trip. Try again.');
      }
    } finally {
      setEnding(false);
    }
  };

  return (
    <View style={styles.container}>
      {currentLocation && (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={{
            latitude: currentLocation.lat,
            longitude: currentLocation.lng,
            latitudeDelta: 0.03,
            longitudeDelta: 0.03,
          }}
          customMapStyle={darkMapStyle}
        >
          <Marker coordinate={{ latitude: currentLocation.lat, longitude: currentLocation.lng }}>
            <View style={styles.carMarker}>
              <Ionicons name="car" size={20} color={Colors.primaryText} />
            </View>
          </Marker>
        </MapView>
      )}

      {/* Top bar: SOS always top-right, shield center */}
      <View style={styles.topBar}>
        {/* Shield — triple-tap activates panic mode invisibly */}
        <View {...panicPanResponder.panHandlers} style={styles.shieldArea} accessible={false} importantForAccessibility="no">
          <Ionicons name="shield-checkmark" size={28} color={Colors.primary} />
        </View>

        <Text style={styles.dropoff} numberOfLines={1}>{dropoffAddress}</Text>

        <TouchableOpacity style={styles.sosButton} onPress={() => navigation.navigate('SOS', { tripId })}>
          <Text style={styles.sosText}>SOS</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom earnings bar */}
      <View style={styles.bottomBar}>
        <View style={styles.earningsRow}>
          <View>
            <Text style={styles.takeHomeLabel}>Your take-home</Text>
            <Text style={styles.takeHomeAmount}>${driverTakeHome.toFixed(2)}</Text>
          </View>
          <View style={styles.timerBlock}>
            <Text style={styles.timerLabel}>Time</Text>
            <Text style={styles.timerValue}>{elapsedMin}m</Text>
          </View>
        </View>

        {earningsFloorAmount > driverTakeHome && (
          <View style={styles.floorCard}>
            <Text style={styles.floorText}>
              Earnings Floor: ${earningsFloorAmount.toFixed(2)} guaranteed
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.endButton, ending && styles.endButtonDisabled]}
          onPress={endTrip}
          disabled={ending}
        >
          <Text style={styles.endButtonText}>
            {ending ? 'Ending Trip...' : 'End Trip'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.endHint}>Must be within 0.2 mi of dropoff</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  shieldArea: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
  },
  dropoff: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sosButton: {
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
  sosText: { color: '#FFF', fontSize: Typography.size.xs, fontWeight: Typography.weight.extrabold, letterSpacing: 1 },
  carMarker: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.base,
    paddingBottom: Platform.OS === 'ios' ? 40 : Spacing['2xl'],
  },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  takeHomeLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  takeHomeAmount: { color: Colors.gold, fontSize: 36, fontWeight: Typography.weight.extrabold, fontFamily: Typography.fontFamilyMono },
  timerBlock: { alignItems: 'flex-end' },
  timerLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  timerValue: { color: Colors.text, fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, fontFamily: Typography.fontFamilyMono },
  floorCard: {
    backgroundColor: Colors.gold + '22',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.gold,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  floorText: { color: Colors.gold, fontSize: Typography.size.sm, fontWeight: Typography.weight.medium },
  endButton: { backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: 16, alignItems: 'center' },
  endButtonDisabled: { opacity: 0.6 },
  endButtonText: { color: Colors.primaryText, fontSize: Typography.size.base, fontWeight: Typography.weight.bold },
  endHint: { color: Colors.textDisabled, fontSize: Typography.size.xs, textAlign: 'center', marginTop: Spacing.xs },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
