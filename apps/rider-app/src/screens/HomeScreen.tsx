import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MAP_PROVIDER } from '../constants/map';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';
import { geocodingApi, ResolvedAddress } from '../api/geocoding';
import { useTripStore } from '../store/trip.store';
import { useAddressStore } from '../store/address.store';
import { RiderBookingSheet, BookingFareEstimate } from '../components/RiderBookingSheet';
import { EwrTerminalPicker } from '../components/EwrTerminalPicker';
import { detectEwrAddress, EWR_TERMINALS, AirportTerminal, isNearEwr } from '../constants/airports';

// Mirror of the server's airport detection (trip-service detectAirportTrip):
// coordinate-first — the endpoint's resolved coords inside the EWR geofence —
// with the same STRICT name fallback trio for geocoder coordinate drift.
// No 'Terminal X' substring patterns ("Terminal Ave" street addresses must
// never be classified as airports). The quoted fare must include the airport
// premium exactly when the created trip will be charged it: keep this in
// lockstep with trips.service.ts.
const AIRPORT_NAME_FALLBACK = [/\bEWR\b/, /Newark Liberty/i, /Newark Airport/i];
function isAirportEndpoint(addr: ResolvedAddress): boolean {
  return (
    isNearEwr(addr.lat, addr.lng) ||
    AIRPORT_NAME_FALLBACK.some((re) => re.test(addr.formattedAddress))
  );
}

interface PaymentMethodSummary {
  brand: string;
  last4: string;
}

export function HomeScreen() {
  const mapRef = useRef<MapView>(null);
  const { activeTrip, completedTrip } = useTripStore();
  const { recentAddresses, homeAddress, workAddress, addRecent } = useAddressStore();

  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupResolved, setPickupResolved] = useState<ResolvedAddress | null>(null);
  const [dropoffResolved, setDropoffResolved] = useState<ResolvedAddress | null>(null);
  const [fareEstimate, setFareEstimate] = useState<BookingFareEstimate | null>(null);
  const [loadingFare, setLoadingFare] = useState(false);
  const [requestingRide, setRequestingRide] = useState(false);
  const [fareError, setFareError] = useState<string | null>(null);
  const [ewrVisible, setEwrVisible] = useState(false);
  // undefined = still loading, null = no default method on file
  const [defaultPaymentMethodId, setDefaultPaymentMethodId] = useState<string | null | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodSummary | null | undefined>(undefined);
  const pendingEwrAddress = useRef<ResolvedAddress | null>(null);
  const sessionToken = useRef(Math.random().toString(36).slice(2)).current;

  useFocusEffect(
    useCallback(() => {
      api.get<{
        paymentMethods: { id: string; brand: string; last4: string; isDefault: boolean }[];
        defaultPaymentMethodId: string | null;
      }>('/riders/me/payment-methods')
        .then((res) => {
          setDefaultPaymentMethodId(res.defaultPaymentMethodId ?? null);
          const def = res.paymentMethods.find((pm) => pm.isDefault) ?? null;
          setPaymentMethod(def ? { brand: def.brand, last4: def.last4 } : null);
        })
        .catch(() => {
          setDefaultPaymentMethodId(null);
          setPaymentMethod(null);
        });
    }, []),
  );

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

  // Navigate to tracking exactly once per trip, and only while Home is the
  // focused screen. The old unconditional push fired on every activeTrip
  // object change — driver GPS pings replace it every ~3s — stacking duplicate
  // tracking screens and yanking the rider back after they pressed back.
  const navigatedTripId = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (activeTrip) {
        if (navigatedTripId.current !== activeTrip.id) {
          navigatedTripId.current = activeTrip.id;
          router.push('/tracking');
        }
        return;
      }
      navigatedTripId.current = null;
      // Trip finished while the rider was on Home (they backed out of
      // tracking mid-trip) — still surface the completion/rating screen.
      if (completedTrip?.status === 'completed') {
        router.push('/trip-complete');
      }
    }, [activeTrip, completedTrip]),
  );

  const getEstimate = async (pickup: ResolvedAddress, dropoff: ResolvedAddress) => {
    setFareError(null);
    setLoadingFare(true);
    try {
      const estimate = await api.post<BookingFareEstimate>('/pricing/estimate', {
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        // Mirrors the server-side airport detection so the quote matches
        // the fare the trip will be created with.
        isAirportTrip: isAirportEndpoint(pickup) || isAirportEndpoint(dropoff),
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

  const handlePickupResolved = (addr: ResolvedAddress) => {
    setPickupResolved(addr);
    setFareEstimate(null);
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

    if (!defaultPaymentMethodId) {
      Alert.alert(
        'Payment Method Required',
        'Please add a payment method before requesting a ride.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Card', onPress: () => router.push('/payment-methods') },
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
        // aiFare arrives as a string (Prisma Decimal JSON serialization) —
        // coerce here so downstream .toFixed() renders don't crash.
        aiFare: Number(trip.aiFare),
      });
      // The focus effect above navigates to /tracking on the trip-id
      // transition — no direct push here, or the screen would stack twice.
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

  const makeOffer = () => {
    if (!fareEstimate || !pickupResolved || !dropoffResolved) return;
    router.push({
      pathname: '/bid-request',
      params: {
        aiFare: String(fareEstimate.fare),
        pickupAddress: pickupResolved.formattedAddress,
        dropoffAddress: dropoffResolved.formattedAddress,
        pickupLat: String(pickupResolved.lat),
        pickupLng: String(pickupResolved.lng),
        dropoffLat: String(dropoffResolved.lat),
        dropoffLng: String(dropoffResolved.lng),
        paymentMethodId: defaultPaymentMethodId ?? '',
      },
    });
  };

  const isAirportTrip = useMemo(
    () =>
      Boolean(
        (pickupResolved && isAirportEndpoint(pickupResolved)) ||
          (dropoffResolved && isAirportEndpoint(dropoffResolved)),
      ),
    [pickupResolved, dropoffResolved],
  );

  // Terminal-aware pickup info: surfaced when either endpoint is a picked
  // EWR terminal. Match the picker's structured placeId ('EWR-A/B/C'), not
  // a bare `includes(t.name)` — "Terminal Ave, Clark" contains "Terminal A"
  // and must never grow a terminal row. Gated on isAirportTrip for the same
  // reason.
  const terminal: AirportTerminal | null = useMemo(() => {
    if (!isAirportTrip) return null;
    const placeIds = [pickupResolved?.placeId, dropoffResolved?.placeId];
    return EWR_TERMINALS.find((t) => placeIds.includes(t.id)) ?? null;
  }, [isAirportTrip, pickupResolved, dropoffResolved]);

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
          provider={MAP_PROVIDER}
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

      {/* Rider backed out of tracking mid-trip — always give a way back. */}
      {activeTrip && (
        <TouchableOpacity
          style={styles.activeRideBanner}
          onPress={() => router.push('/tracking')}
          activeOpacity={0.85}
          accessibilityLabel="Return to your ride"
        >
          <Text style={styles.activeRideText}>Ride in progress</Text>
          <Text style={styles.activeRideAction}>Return to ride ›</Text>
        </TouchableOpacity>
      )}

      <RiderBookingSheet
        shortcuts={shortcuts}
        onShortcut={handleDropoffResolved}
        pickupInitialValue={pickupResolved?.formattedAddress ?? ''}
        dropoffValue={dropoffResolved?.formattedAddress ?? ''}
        recentAddresses={recentAddresses}
        sessionToken={sessionToken}
        onPickupResolved={handlePickupResolved}
        onDropoffResolved={handleDropoffResolved}
        fareEstimate={fareEstimate}
        loadingFare={loadingFare}
        fareError={fareError}
        isAirportTrip={isAirportTrip}
        terminal={terminal}
        paymentMethod={paymentMethod}
        requesting={requestingRide}
        onRequest={requestRide}
        onMakeOffer={makeOffer}
      />

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
  activeRideBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 32,
    left: Spacing.base,
    right: Spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    zIndex: 60,
  },
  activeRideText: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  activeRideAction: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
  },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8FA8C8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A2342' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0A2342' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
