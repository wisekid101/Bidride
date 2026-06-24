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
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { useDriverStore } from '../store/driver.store';
import { useDriverSocketStore } from '../store/socket.store';
import { IncomingRequestScreen } from './IncomingRequestScreen';
import { api } from '../api/client';

export function DriverHomeScreen() {
  const navigation = useNavigation<any>();
  const { isOnline, todayEarnings, setOnlineStatus } = useDriverStore();
  const { incomingBid, clearIncomingBid, counterResult, clearCounterResult, emitLocation } = useDriverSocketStore();
  const mapRef = useRef<MapView>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [toggling, setToggling] = useState(false);

  // Navigate away when a counter offer is accepted by the rider
  useEffect(() => {
    if (counterResult?.accepted) {
      clearCounterResult();
      navigation.navigate('InTrip', {
        tripId: counterResult.tripId,
        driverTakeHome: counterResult.finalFare * 0.80,
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
      if (isOnline) {
        await api.post('/driver/status/offline', {});
        setOnlineStatus(false);
      } else {
        await api.post('/driver/status/online', {});
        setOnlineStatus(true);
      }
    } catch (err) {
      console.error('Status toggle failed', err);
    } finally {
      setToggling(false);
    }
  };

  const PLATFORM_FEE_RATE = 0.20;

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
          onPress={() => navigation.navigate('AirportMode')}
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
