import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';
import { useTripStore } from '../store/trip.store';

interface FareEstimate {
  fare: number;
  distanceMiles: number;
  durationMin: number;
  surgeMultiplier: number;
}

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const mapRef = useRef<MapView>(null);
  const { activeTrip } = useTripStore();

  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [loadingFare, setLoadingFare] = useState(false);
  const [requestingRide, setRequestingRide] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({});
      setCurrentLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    })();
  }, []);

  // Redirect if active trip
  useEffect(() => {
    if (activeTrip) {
      navigation.navigate('Tracking');
    }
  }, [activeTrip]);

  const getEstimate = async () => {
    if (!currentLocation || !dropoffAddress) return;
    setLoadingFare(true);
    try {
      const estimate = await api.post<FareEstimate>('/pricing/estimate', {
        pickupLat: currentLocation.lat,
        pickupLng: currentLocation.lng,
        dropoffLat: currentLocation.lat + 0.05, // placeholder — geocoded dropoff
        dropoffLng: currentLocation.lng + 0.05,
      });
      setFareEstimate(estimate);
    } catch (err) {
      console.error('Fare estimate failed', err);
    } finally {
      setLoadingFare(false);
    }
  };

  const requestRide = async () => {
    if (!currentLocation || !fareEstimate) return;
    setRequestingRide(true);
    try {
      const trip = await api.post<{ id: string; aiFare: number }>('/trips', {
        pickupAddress: pickupAddress || 'Current Location',
        pickupLat: currentLocation.lat,
        pickupLng: currentLocation.lng,
        dropoffAddress,
        dropoffLat: currentLocation.lat + 0.05,
        dropoffLng: currentLocation.lng + 0.05,
        rideType: 'standard',
      });

      useTripStore.getState().setActiveTrip({
        id: trip.id,
        status: 'searching',
        pickupAddress: pickupAddress || 'Current Location',
        dropoffAddress,
        aiFare: trip.aiFare,
      });

      navigation.navigate('Tracking');
    } catch (err) {
      console.error('Ride request failed', err);
    } finally {
      setRequestingRide(false);
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
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          customMapStyle={darkMapStyle}
        >
          <Marker
            coordinate={{ latitude: currentLocation.lat, longitude: currentLocation.lng }}
            title="You"
          />
        </MapView>
      )}

      <View style={styles.bottomSheet}>
        <View style={styles.pill} />

        <Text style={styles.heading}>Where to?</Text>

        <View style={styles.inputRow}>
          <View style={styles.dot} />
          <TextInput
            style={styles.input}
            placeholder="Pickup location"
            placeholderTextColor={Colors.textSecondary}
            value={pickupAddress}
            onChangeText={setPickupAddress}
          />
        </View>

        <View style={styles.inputRow}>
          <View style={[styles.dot, styles.dotDestination]} />
          <TextInput
            style={styles.input}
            placeholder="Destination"
            placeholderTextColor={Colors.textSecondary}
            value={dropoffAddress}
            onChangeText={setDropoffAddress}
            onSubmitEditing={getEstimate}
            returnKeyType="done"
          />
        </View>

        {loadingFare && <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} />}

        {fareEstimate && !loadingFare && (
          <View style={styles.fareCard}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>AI Fare</Text>
              <Text style={styles.fareAmount}>${fareEstimate.fare.toFixed(2)}</Text>
            </View>
            <Text style={styles.fareDetail}>
              {fareEstimate.distanceMiles.toFixed(1)} mi · ~{fareEstimate.durationMin} min
              {fareEstimate.surgeMultiplier > 1.05 && (
                <Text style={styles.surgeText}> · {fareEstimate.surgeMultiplier.toFixed(1)}× surge</Text>
              )}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.requestButton,
            (!fareEstimate || requestingRide) && styles.requestButtonDisabled,
          ]}
          onPress={requestRide}
          disabled={!fareEstimate || requestingRide}
          activeOpacity={0.85}
        >
          {requestingRide ? (
            <ActivityIndicator color={Colors.primaryText} />
          ) : (
            <Text style={styles.requestButtonText}>
              {fareEstimate ? `Request · $${fareEstimate.fare.toFixed(2)}` : 'Enter Destination'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bidButton}
          onPress={() => navigation.navigate('BidRequest', { fareEstimate })}
          disabled={!fareEstimate}
        >
          <Text style={styles.bidButtonText}>Make an offer instead</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  map: { flex: 1 },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.base,
    paddingBottom: Platform.OS === 'ios' ? 40 : Spacing['2xl'],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  pill: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  heading: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    height: 48,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
    marginRight: Spacing.sm,
  },
  dotDestination: { backgroundColor: Colors.gold },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.base,
  },
  fareCard: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  fareAmount: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  fareDetail: { color: Colors.textSecondary, fontSize: Typography.size.sm, marginTop: 4 },
  surgeText: { color: Colors.warning },
  requestButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  requestButtonDisabled: { opacity: 0.5 },
  requestButtonText: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  bidButton: { alignItems: 'center', paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  bidButtonText: { color: Colors.textSecondary, fontSize: Typography.size.sm },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8FA8C8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A2342' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0A2342' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
