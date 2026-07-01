import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Platform,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Heatmap } from 'react-native-maps';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useDriverStore } from '../store/driver.store';
import { useDriverSocketStore } from '../store/socket.store';
import { IncomingRequestScreen } from './IncomingRequestScreen';
import { api } from '../api/client';

export function DriverHomeScreen() {
  const { isOnline, todayEarnings, setOnlineStatus } = useDriverStore();
  const { incomingBid, clearIncomingBid, counterResult, clearCounterResult, emitLocation } = useDriverSocketStore();
  const mapRef = useRef<MapView>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [toggling, setToggling] = useState(false);

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
        currentLat: currentLocation?.lat ?? null,
        currentLng: currentLocation?.lng ?? null,
      });
      setOnlineStatus(nextState);
    } catch (err) {
      console.error('Status toggle failed', err);
    } finally {
      setToggling(false);
    }
  };

  const PLATFORM_FEE_RATE = 0.20;

  // Rule-based zone floor: earnings floor formula for a typical Newark trip (~3 mi, ~12 min)
  // Formula: (miles × $1.10) + (minutes × $0.22) + $2.50
  const ZONE_FLOOR_EST = parseFloat(((3.0 * 1.10) + (12 * 0.22) + 2.50).toFixed(2));
  const sessionAvgPerTrip = todayEarnings.trips > 0
    ? parseFloat((todayEarnings.takeHome / todayEarnings.trips).toFixed(2))
    : null;

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
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
          customMapStyle={darkMapStyle}
        >
          {/* Demand heatmap — populated from Redis surge data */}
          <Heatmap
            points={[]}
            radius={30}
            gradient={{ colors: ['#00D4C6', '#F4B400', '#EF4444'], startPoints: [0.3, 0.6, 1.0], colorMapSize: 256 }}
          />
        </MapView>
      )}

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

      {/* Zone Opportunity Card — rule-based estimate using floor formula + session data */}
      <View style={styles.zoneCard}>
        <View style={styles.zoneCardHeader}>
          <Text style={styles.zoneCardTitle}>Zone Opportunity</Text>
          <Text style={styles.zoneCardEstimated}>estimated</Text>
        </View>
        {sessionAvgPerTrip !== null ? (
          <View style={styles.zoneRow}>
            <Text style={styles.zoneLabel}>Your session avg</Text>
            <Text style={styles.zoneValue}>${sessionAvgPerTrip.toFixed(2)} / trip</Text>
          </View>
        ) : (
          <Text style={styles.zoneNoData}>No trips yet this session</Text>
        )}
        <View style={styles.zoneRow}>
          <Text style={styles.zoneLabel}>Floor guarantee</Text>
          <Text style={styles.zoneValue}>${ZONE_FLOOR_EST.toFixed(2)}+ / typical trip</Text>
        </View>
      </View>

      {/* Earnings Card — always shows driver take-home first */}
      <View style={styles.earningsCard}>
        <Text style={styles.earningsLabel}>Today's Take-Home</Text>
        <Text style={styles.earningsAmount}>${todayEarnings.takeHome.toFixed(2)}</Text>
        <View style={styles.earningsRow}>
          <View style={styles.earningsDetail}>
            <Text style={styles.earningsDetailLabel}>Trips</Text>
            <Text style={styles.earningsDetailValue}>{todayEarnings.trips}</Text>
          </View>
          <View style={styles.earningsDetail}>
            <Text style={styles.earningsDetailLabel}>Hours</Text>
            <Text style={styles.earningsDetailValue}>{todayEarnings.hoursOnline.toFixed(1)}</Text>
          </View>
          <View style={styles.earningsDetail}>
            <Text style={styles.earningsDetailLabel}>Avg / trip</Text>
            <Text style={styles.earningsDetailValue}>
              ${todayEarnings.trips > 0 ? (todayEarnings.takeHome / todayEarnings.trips).toFixed(2) : '0.00'}
            </Text>
          </View>
        </View>
      </View>
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
  zoneCard: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 264 : 244,
    left: Spacing.base,
    right: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  zoneCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  zoneCardTitle: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  zoneCardEstimated: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
  },
  zoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  zoneLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
  },
  zoneValue: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    fontFamily: Typography.fontFamilyMono,
  },
  zoneNoData: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    paddingVertical: 2,
  },
  earningsCard: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 100 : 80,
    left: Spacing.base,
    right: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  earningsLabel: { color: Colors.textSecondary, fontSize: Typography.size.sm },
  earningsAmount: {
    color: Colors.gold,
    fontSize: 42,
    fontWeight: Typography.weight.extrabold,
    fontFamily: Typography.fontFamilyMono,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earningsDetail: { alignItems: 'center' },
  earningsDetailLabel: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  earningsDetailValue: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1929' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8FA8C8' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A3A5C' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051524' }] },
];
