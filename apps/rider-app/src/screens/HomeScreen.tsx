import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';
import { geocodingApi, ResolvedAddress } from '../api/geocoding';
import { useTripStore } from '../store/trip.store';
import { useAddressStore } from '../store/address.store';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { EwrTerminalPicker } from '../components/EwrTerminalPicker';
import { detectEwrAddress } from '../constants/airports';

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
  const { recentAddresses, homeAddress, workAddress, addRecent } = useAddressStore();

  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupResolved, setPickupResolved] = useState<ResolvedAddress | null>(null);
  const [dropoffResolved, setDropoffResolved] = useState<ResolvedAddress | null>(null);
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [loadingFare, setLoadingFare] = useState(false);
  const [requestingRide, setRequestingRide] = useState(false);
  const [fareError, setFareError] = useState<string | null>(null);
  const [ewrVisible, setEwrVisible] = useState(false);
  const [hasDefaultPaymentMethod, setHasDefaultPaymentMethod] = useState<boolean | null>(null);
  const pendingEwrAddress = useRef<ResolvedAddress | null>(null);
  const sessionToken = useRef(Math.random().toString(36).slice(2)).current;

  useEffect(() => {
    api.get<{ paymentMethods: { isDefault: boolean }[]; defaultPaymentMethodId: string | null }>(
      '/riders/me/payment-methods',
    )
      .then((res) => setHasDefaultPaymentMethod(!!res.defaultPaymentMethodId))
      .catch(() => setHasDefaultPaymentMethod(false));
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({});
      const coords = { lat: location.coords.latitude, lng: location.coords.longitude };
      setCurrentLocation(coords);

      try {
        const { formattedAddress } = await geocodingApi.reverseGeocode(coords.lat, coords.lng);
        setPickupResolved({ placeId: '', formattedAddress, lat: coords.lat, lng: coords.lng });
      } catch {
        setPickupResolved({ placeId: '', formattedAddress: 'Current Location', ...coords });
      }
    })();
  }, []);

  useEffect(() => {
    if (activeTrip) navigation.navigate('Tracking');
  }, [activeTrip]);

  const getEstimate = async (pickup: ResolvedAddress, dropoff: ResolvedAddress) => {
    setFareError(null);
    setLoadingFare(true);
    try {
      const estimate = await api.post<FareEstimate>('/pricing/estimate', {
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
      });
      setFareEstimate(estimate);
    } catch {
      setFareError('Could not estimate fare. Please try again.');
    } finally {
      setLoadingFare(false);
    }
  };

  const finalizeDropoff = (addr: ResolvedAddress) => {
    addRecent(addr);
    setDropoffResolved(addr);
    setFareEstimate(null);
    if (pickupResolved) getEstimate(pickupResolved, addr);
  };

  const handleDropoffResolved = (addr: ResolvedAddress) => {
    if (detectEwrAddress(addr.formattedAddress)) {
      pendingEwrAddress.current = addr;
      setEwrVisible(true);
      return;
    }
    finalizeDropoff(addr);
  };

  const handleEwrTerminalSelect = (addr: ResolvedAddress) => {
    setEwrVisible(false);
    pendingEwrAddress.current = null;
    finalizeDropoff(addr);
  };

  const handleEwrDismiss = () => {
    setEwrVisible(false);
    if (pendingEwrAddress.current) {
      finalizeDropoff(pendingEwrAddress.current);
      pendingEwrAddress.current = null;
    }
  };

  const requestRide = async () => {
    if (!pickupResolved || !dropoffResolved || !fareEstimate) return;

    if (!hasDefaultPaymentMethod) {
      Alert.alert(
        'Payment Method Required',
        'Please add a payment method before requesting a ride.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Card', onPress: () => navigation.navigate('PaymentMethods') },
        ],
      );
      return;
    }

    setRequestingRide(true);
    try {
      const trip = await api.post<{ id: string; aiFare: number }>('/trips', {
        pickupAddress: pickupResolved.formattedAddress,
        pickupLat: pickupResolved.lat,
        pickupLng: pickupResolved.lng,
        dropoffAddress: dropoffResolved.formattedAddress,
        dropoffLat: dropoffResolved.lat,
        dropoffLng: dropoffResolved.lng,
        rideType: 'standard',
      });

      useTripStore.getState().setActiveTrip({
        id: trip.id,
        status: 'searching',
        pickupAddress: pickupResolved.formattedAddress,
        dropoffAddress: dropoffResolved.formattedAddress,
        pickupLat: pickupResolved.lat,
        pickupLng: pickupResolved.lng,
        dropoffLat: dropoffResolved.lat,
        dropoffLng: dropoffResolved.lng,
        aiFare: trip.aiFare,
      });

      navigation.navigate('Tracking');
    } catch (err: any) {
      if (err.code === 'ACCOUNT_UNDER_REVIEW') {
        setFareError('Your account is under safety review. Please contact support.');
      } else {
        setFareError('Could not request ride. Please try again.');
      }
    } finally {
      setRequestingRide(false);
    }
  };

  const shortcuts: { label: string; addr: ResolvedAddress }[] = [
    ...(homeAddress ? [{ label: '🏠 Home', addr: homeAddress }] : []),
    ...(workAddress ? [{ label: '💼 Work', addr: workAddress }] : []),
    {
      label: '✈️ EWR',
      addr: {
        placeId: 'EWR',
        formattedAddress: 'Newark Liberty International Airport',
        lat: 40.6895,
        lng: -74.1745,
      },
    },
  ];

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
          {dropoffResolved && (
            <Marker
              coordinate={{ latitude: dropoffResolved.lat, longitude: dropoffResolved.lng }}
              title="Destination"
              pinColor={Colors.gold}
            />
          )}
        </MapView>
      )}

      <View style={styles.bottomSheet}>
        <View style={styles.pill} />
        <Text style={styles.heading}>Where to?</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.shortcuts}
          contentContainerStyle={styles.shortcutsContent}
        >
          {shortcuts.map(({ label, addr }) => (
            <TouchableOpacity
              key={label}
              style={styles.shortcutChip}
              onPress={() => handleDropoffResolved(addr)}
              activeOpacity={0.75}
            >
              <Text style={styles.shortcutText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <AddressAutocomplete
          placeholder="Pickup location"
          dotColor={Colors.primary}
          initialValue={pickupResolved?.formattedAddress ?? ''}
          sessionToken={sessionToken}
          showRecents={false}
          onAddressResolved={(addr) => {
            setPickupResolved(addr);
            setFareEstimate(null);
          }}
        />

        <AddressAutocomplete
          placeholder="Where to?"
          dotColor={Colors.gold}
          sessionToken={sessionToken}
          recentAddresses={recentAddresses}
          showRecents
          onAddressResolved={handleDropoffResolved}
        />

        {fareError && <Text style={styles.errorText}>{fareError}</Text>}

        {loadingFare && <ActivityIndicator color={Colors.primary} style={styles.fareLoader} />}

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
            {fareEstimate.surgeMultiplier > 1.1 && (
              <View style={styles.surgeBadge}>
                <Text style={styles.surgeBadgeText}>
                  {fareEstimate.surgeMultiplier.toFixed(1)}× High Demand
                </Text>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.requestButton, (!fareEstimate || requestingRide) && styles.requestButtonDisabled]}
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

      <EwrTerminalPicker
        visible={ewrVisible}
        onSelect={handleEwrTerminalSelect}
        onDismiss={handleEwrDismiss}
      />
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
  shortcuts: {
    marginBottom: Spacing.md,
  },
  shortcutsContent: {
    gap: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  shortcutChip: {
    backgroundColor: Colors.background,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shortcutText: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
  },
  fareLoader: { marginTop: Spacing.sm },
  errorText: {
    color: Colors.error,
    fontSize: Typography.size.sm,
    marginTop: Spacing.sm,
  },
  fareCard: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fareLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  fareAmount: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  fareDetail: { color: Colors.textSecondary, fontSize: Typography.size.sm, marginTop: 4 },
  surgeText: { color: Colors.warning },
  surgeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '20',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.primary,
    marginTop: 6,
  },
  surgeBadgeText: {
    color: Colors.primary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
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
  bidButton: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
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
