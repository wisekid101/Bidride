import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Platform,
} from 'react-native';
import MapView, { Heatmap } from 'react-native-maps';
import { MAP_PROVIDER, MAP_SUPPORTS_HEATMAP } from '../constants/map';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useDriverStore } from '../store/driver.store';
import { useDriverSocketStore } from '../store/socket.store';
import { IncomingRequestScreen } from './IncomingRequestScreen';
import { IncomingStandardRequestScreen } from './IncomingStandardRequestScreen';
import { DriverHubSheet } from '../components/DriverHubSheet';
import { api } from '../api/client';

// Downtown Newark — map placeholder region until the first GPS fix lands
const NEWARK_REGION = {
  latitude: 40.7357,
  longitude: -74.1724,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export function DriverHomeScreen() {
  const { isOnline, setOnlineStatus, setTodayEarnings } = useDriverStore();
  const { incomingBid, clearIncomingBid, incomingRequest, clearIncomingRequest, counterResult, clearCounterResult, emitLocation } = useDriverSocketStore();
  const mapRef = useRef<MapView>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [toggling, setToggling] = useState(false);
  const [heatmapPoints, setHeatmapPoints] = useState<
    Array<{ latitude: number; longitude: number; weight: number }>
  >([]);

  // Refresh today's totals whenever Home gains focus — cold start, tab
  // returns, and coming back from a completed ride (rate-rider replaces to
  // the tabs, focusing Drive). Failure keeps the last known values.
  useFocusEffect(
    useCallback(() => {
      api
        .get<{ takeHome: number; trips: number; hoursOnline: number; floorSupplements: number }>(
          '/driver/earnings/today',
        )
        .then((s) =>
          setTodayEarnings({
            takeHome: Number(s.takeHome ?? 0),
            trips: s.trips ?? 0,
            hoursOnline: Number(s.hoursOnline ?? 0),
            floorSupplements: Number(s.floorSupplements ?? 0),
          }),
        )
        .catch(() => {});
    }, []),
  );

  // Poll demand heatmap every 30s while online — clears when going offline
  useEffect(() => {
    if (!currentLocation || !isOnline) {
      setHeatmapPoints([]);
      return;
    }

    const fetchZones = () => {
      api
        .get<{ points: Array<{ latitude: number; longitude: number; weight: number }> }>(
          `/pricing/demand-zones?lat=${currentLocation.lat}&lng=${currentLocation.lng}&radiusMi=5`,
        )
        .then((res) => setHeatmapPoints(res.points))
        .catch(() => {});
    };

    fetchZones();
    const interval = setInterval(fetchZones, 30_000);
    return () => clearInterval(interval);
  }, [currentLocation, isOnline]);

  // Navigate away when a counter offer is accepted by the rider
  useEffect(() => {
    if (counterResult?.accepted) {
      clearCounterResult();
      router.push({
        pathname: '/in-trip',
        params: { tripId: counterResult.tripId, driverTakeHome: (counterResult.finalFare * 0.80).toString() },
      });
    } else if (counterResult && !counterResult.accepted) {
      clearCounterResult();
    }
  }, [counterResult]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({});
      setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });

      if (isOnline) {
        // Stream GPS via WebSocket — updates Redis and notifies active trip riders
        await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 },
          (position) => {
            emitLocation(position.coords.latitude, position.coords.longitude);
          },
        );
      }
    })();
  }, [isOnline]);

  const toggleOnline = async () => {
    setToggling(true);
    try {
      const nextState = !isOnline;
      await api.patch('/drivers/me/availability', {
        isAvailable: nextState,
        ...(currentLocation
          ? { currentLat: String(currentLocation.lat), currentLng: String(currentLocation.lng) }
          : {}),
      });
      setOnlineStatus(nextState);
    } catch (err) {
      console.error('Status toggle failed', err);
    } finally {
      setToggling(false);
    }
  };

  const PLATFORM_FEE_RATE = 0.20;

  return (
    <View style={styles.container}>
      {/* Map is the screen — rendered immediately on the Newark fallback
          region so GPS latency never leaves a blank void. The key remount
          re-centers it once the real fix arrives. */}
      <MapView
        key={currentLocation ? 'located' : 'fallback'}
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={styles.map}
        initialRegion={
          currentLocation
            ? {
                latitude: currentLocation.lat,
                longitude: currentLocation.lng,
                latitudeDelta: 0.08,
                longitudeDelta: 0.08,
              }
            : NEWARK_REGION
        }
        customMapStyle={darkMapStyle}
      >
        {MAP_SUPPORTS_HEATMAP && (
          <Heatmap
            points={heatmapPoints}
            radius={30}
            gradient={{ colors: [Colors.teal, Colors.gold, Colors.safety], startPoints: [0.3, 0.6, 1.0], colorMapSize: 256 }}
          />
        )}
      </MapView>

      {/* Online Toggle Header */}
      <View style={styles.header}>
        <View style={styles.onlineToggle}>
          <Text style={[styles.onlineLabel, isOnline && styles.onlineLabelActive]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{ false: Colors.border, true: Colors.primary }}
            thumbColor={Colors.text}
            disabled={toggling}
          />
        </View>

        <TouchableOpacity
          style={styles.airportButton}
          onPress={() => router.push('/airport-mode')}
        >
          <Ionicons name="airplane" size={18} color={Colors.primary} />
          <Text style={styles.airportButtonText}>EWR Queue</Text>
        </TouchableOpacity>
      </View>

      {/* Driver Hub — pull-up command center (zIndex 100). Replaces the old
          zone panel + earnings bar; both live inside the sheet now. */}
      <DriverHubSheet />

      {/* Incoming standard ride overlay — primary flow; only shown when no bid is pending */}
      {isOnline && incomingRequest && !incomingBid && (
        <IncomingStandardRequestScreen
          tripId={incomingRequest.tripId}
          pickupAddress={incomingRequest.pickupAddress}
          dropoffAddress={incomingRequest.dropoffAddress}
          aiFare={incomingRequest.aiFare}
          driverTakeHome={parseFloat((incomingRequest.aiFare * (1 - PLATFORM_FEE_RATE)).toFixed(2))}
          distanceMiles={incomingRequest.distanceMiles}
          durationMin={incomingRequest.durationMin}
          isAirportTrip={incomingRequest.isAirportTrip}
          riderBadge={incomingRequest.riderBadge}
          onAccepted={clearIncomingRequest}
          onDeclined={clearIncomingRequest}
        />
      )}

      {/* Incoming bid overlay — only rendered when online and a bid is available */}
      {isOnline && incomingBid && (
        <IncomingRequestScreen
          bidId={incomingBid.bidId}
          tripId={incomingBid.tripId}
          pickupAddress={incomingBid.pickupAddress}
          dropoffAddress={incomingBid.dropoffAddress}
          aiFare={incomingBid.standardFare}
          driverTakeHome={parseFloat((incomingBid.bidAmount * (1 - PLATFORM_FEE_RATE)).toFixed(2))}
          distanceMiles={incomingBid.distanceMiles}
          durationMin={incomingBid.durationMin}
          isAirportTrip={incomingBid.isAirportTrip}
          riderBadge={incomingBid.riderBadge}
          onAccepted={clearIncomingBid}
          onDeclined={clearIncomingBid}
          onCountered={clearIncomingBid}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  map: { flex: 1 },
  header: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 32,
    left: Spacing.base,
    right: Spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  onlineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  onlineLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  onlineLabelActive: { color: Colors.primary },
  airportButton: {
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
  airportButtonText: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8FA8C8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
