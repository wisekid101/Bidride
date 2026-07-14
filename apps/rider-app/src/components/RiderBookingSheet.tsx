import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { ChevronRight, CreditCard, Plane } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography } from '../constants/theme';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { AddressAutocomplete } from './AddressAutocomplete';
import { RideTypeSelector, RideTypeId, RideTypeOption } from './RideTypeSelector';
import type { AirportTerminal } from '../constants/airports';
import type { ResolvedAddress } from '../api/geocoding';

// Fallback heights until the real zones are measured via onLayout.
const PEEK_VISIBLE_FALLBACK = 240;

// Vertical band kept clear above the fully-open sheet so the
// ride-in-progress banner (top 60 + ~50pt, taller under large accessibility
// fonts) stays visible and tappable.
const HEADER_CLEARANCE = 128;

const SHEET_Z_INDEX = 50;

type SnapState = 'peek' | 'open';

export interface BookingFareEstimate {
  fare: number;
  distanceMiles: number;
  durationMin: number;
  surgeMultiplier: number;
  breakdown?: { airport: number };
}

interface RiderBookingSheetProps {
  shortcuts: { label: string; addr: ResolvedAddress }[];
  onShortcut: (addr: ResolvedAddress) => void;
  pickupInitialValue: string;
  dropoffValue: string;
  recentAddresses: ResolvedAddress[];
  sessionToken: string;
  onPickupResolved: (addr: ResolvedAddress) => void;
  onDropoffResolved: (addr: ResolvedAddress) => void;
  fareEstimate: BookingFareEstimate | null;
  loadingFare: boolean;
  fareError: string | null;
  isAirportTrip: boolean;
  terminal: AirportTerminal | null;
  // undefined = still loading, null = no default method on file
  paymentMethod: { brand: string; last4: string } | null | undefined;
  requesting: boolean;
  onRequest: () => void;
  onMakeOffer: () => void;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function RiderBookingSheet({
  shortcuts,
  onShortcut,
  pickupInitialValue,
  dropoffValue,
  recentAddresses,
  sessionToken,
  onPickupResolved,
  onDropoffResolved,
  fareEstimate,
  loadingFare,
  fareError,
  isAirportTrip,
  terminal,
  paymentMethod,
  requesting,
  onRequest,
  onMakeOffer,
}: RiderBookingSheetProps) {
  const { height: windowHeight } = useWindowDimensions();

  const [snapState, setSnapState] = useState<SnapState>('peek');
  const [selectedType, setSelectedType] = useState<RideTypeId>('standard');

  // Measured at runtime: the screen container (excludes tab bar / home
  // inset) and the strip that stays visible when peeking (handle + heading
  // + shortcuts + address fields).
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [searchHeight, setSearchHeight] = useState(0);

  const ch = containerHeight ?? windowHeight;
  const SHEET_HEIGHT = Math.min(Math.round(ch * 0.88), ch - HEADER_CLEARANCE);
  const peekVisible =
    headerHeight > 0 && searchHeight > 0
      ? headerHeight + searchHeight + Spacing.base
      : PEEK_VISIBLE_FALLBACK;
  const snaps = useMemo(
    () => ({
      open: 0,
      peek: Math.max(0, SHEET_HEIGHT - peekVisible),
    }),
    [SHEET_HEIGHT, peekVisible],
  );

  const translateY = useRef(new Animated.Value(snaps.peek)).current;
  const lastY = useRef(snaps.peek);
  const dragStartY = useRef(snaps.peek);
  const snapStateRef = useRef<SnapState>('peek');
  const draggingRef = useRef(false);

  // Re-anchor to the current snap whenever the geometry changes (container
  // measured, zones measured, window resized) — the Animated.Value was
  // seeded once and would otherwise hold a stale offset.
  useEffect(() => {
    translateY.setValue(snaps[snapStateRef.current]);
  }, [snaps, translateY]);

  useEffect(() => {
    const id = translateY.addListener(({ value }) => {
      lastY.current = value;
    });
    return () => translateY.removeListener(id);
  }, [translateY]);

  const snapTo = useCallback(
    (target: number) => {
      const state: SnapState = target === snaps.open ? 'open' : 'peek';
      snapStateRef.current = state;
      setSnapState(state);
      Animated.spring(translateY, {
        toValue: target,
        useNativeDriver: true,
        tension: 68,
        friction: 12,
      }).start();
    },
    [snaps, translateY],
  );

  const cycleSnap = useCallback(() => {
    snapTo(snapState === 'peek' ? snaps.open : snaps.peek);
  }, [snapState, snaps, snapTo]);

  // A fresh quote is the moment of decision — bring the full command center
  // up so fare, service, and payment are all in view. Never while the user's
  // finger is down: the spring would fight the drag's setValue writes.
  useEffect(() => {
    if (fareEstimate && snapStateRef.current === 'peek' && !draggingRef.current) {
      snapTo(snaps.open);
    }
  }, [fareEstimate, snapTo, snaps.open]);

  // The only selectable service changes with the trip: Airport replaces
  // Standard on EWR trips because the airport premium applies by address —
  // a cheaper "Standard" card for the same trip would quote a false price.
  useEffect(() => {
    setSelectedType(isAirportTrip ? 'airport' : 'standard');
  }, [isAirportTrip]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          draggingRef.current = true;
          dragStartY.current = lastY.current;
        },
        onPanResponderMove: (_evt, g) => {
          const next = Math.min(
            Math.max(dragStartY.current + g.dy, snaps.open),
            snaps.peek,
          );
          translateY.setValue(next);
        },
        onPanResponderRelease: (_evt, g) => {
          draggingRef.current = false;
          // No meaningful movement — treat as a tap on the header.
          if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
            cycleSnap();
            return;
          }
          const pos = Math.min(
            Math.max(dragStartY.current + g.dy, snaps.open),
            snaps.peek,
          );
          let target: number;
          if (Math.abs(g.vy) > 0.5) {
            target = g.vy > 0 ? snaps.peek : snaps.open;
          } else {
            target =
              Math.abs(pos - snaps.open) < Math.abs(pos - snaps.peek)
                ? snaps.open
                : snaps.peek;
          }
          snapTo(target);
        },
        onPanResponderTerminate: () => {
          draggingRef.current = false;
          const pos = lastY.current;
          snapTo(
            Math.abs(pos - snaps.open) < Math.abs(pos - snaps.peek)
              ? snaps.open
              : snaps.peek,
          );
        },
      }),
    [snaps, snapTo, cycleSnap, translateY],
  );

  const options: RideTypeOption[] = useMemo(() => {
    if (!fareEstimate) return [];
    return isAirportTrip
      ? [
          {
            id: 'airport',
            name: 'Airport',
            fare: fareEstimate.fare,
            capacityLabel: 'Up to 4 riders',
            sublabel: 'Luggage-friendly · EWR',
          },
        ]
      : [
          {
            id: 'standard',
            name: 'Standard',
            fare: fareEstimate.fare,
            capacityLabel: 'Up to 4 riders',
            sublabel: 'Everyday ride',
          },
        ];
  }, [fareEstimate, isAirportTrip]);

  const serviceName = isAirportTrip ? 'Airport' : 'Standard';
  const airportPremium = fareEstimate?.breakdown?.airport ?? 0;

  return (
    // box-none: only the sheet itself takes touches — the map and the
    // ride-in-progress banner stay interactive everywhere else.
    <View
      style={styles.overlay}
      pointerEvents="box-none"
      onLayout={(e) => setContainerHeight(Math.round(e.nativeEvent.layout.height))}
    >
      {/* Invisible until the container is measured — the fallback geometry
          would otherwise flash at the wrong anchor for one frame. */}
      <Animated.View
        style={[
          styles.sheet,
          { height: SHEET_HEIGHT, transform: [{ translateY }] },
          containerHeight === null && styles.sheetUnmeasured,
        ]}
      >
        {/* Grab handle + heading — the drag zone. */}
        <View
          {...panResponder.panHandlers}
          style={styles.headerZone}
          onLayout={(e) => setHeaderHeight(Math.round(e.nativeEvent.layout.height))}
          accessible
          accessibilityRole="button"
          accessibilityLabel={
            fareEstimate
              ? `Where to? ${serviceName} fare $${fareEstimate.fare.toFixed(2)}.`
              : 'Where to?'
          }
          accessibilityHint={`Booking panel ${snapState === 'open' ? 'open' : 'collapsed'}. Tap or drag the handle to resize.`}
          onAccessibilityTap={cycleSnap}
        >
          <View style={styles.grabHandle} />
          <Text style={styles.heading}>Where to?</Text>
        </View>

        <ScrollView
          scrollEnabled={snapState === 'open'}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Visible while peeking: shortcuts + the two address fields. */}
          <View
            onLayout={(e) => setSearchHeight(Math.round(e.nativeEvent.layout.height))}
          >
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
                  onPress={() => onShortcut(addr)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.shortcutText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <AddressAutocomplete
              placeholder="Pickup location"
              dotColor={Colors.primary}
              initialValue={pickupInitialValue}
              sessionToken={sessionToken}
              showRecents={false}
              onAddressResolved={onPickupResolved}
            />

            {/* key remounts the field when the resolved destination changes
                outside the field itself (shortcut chips, terminal picker) —
                its internal text would otherwise go stale and show the old
                address for a booking that targets the new one. */}
            <AddressAutocomplete
              key={dropoffValue}
              placeholder="Where to?"
              dotColor={Colors.gold}
              initialValue={dropoffValue}
              sessionToken={sessionToken}
              recentAddresses={recentAddresses}
              showRecents
              onAddressResolved={onDropoffResolved}
              triggerTestID="dest-field"
            />
          </View>

          {/* Below the peek fold — hidden from assistive tech while peeking. */}
          <View
            accessibilityElementsHidden={snapState === 'peek'}
            importantForAccessibility={
              snapState === 'peek' ? 'no-hide-descendants' : 'auto'
            }
          >
            {fareError && <Text style={styles.errorText}>{fareError}</Text>}
            {loadingFare && (
              <ActivityIndicator color={Colors.primary} style={styles.fareLoader} />
            )}

            {fareEstimate && !loadingFare && (
              <>
                <RideTypeSelector
                  options={options}
                  selectedId={selectedType}
                  onSelect={setSelectedType}
                />

                <Card style={styles.fareCard}>
                  <View style={styles.fareRow}>
                    <Text style={styles.fareLabel}>AI Fare</Text>
                    <Text style={styles.fareAmount}>${fareEstimate.fare.toFixed(2)}</Text>
                  </View>
                  <Text style={styles.fareDetail}>
                    {fareEstimate.distanceMiles.toFixed(1)} mi · ~{fareEstimate.durationMin} min
                    {fareEstimate.surgeMultiplier > 1.05 && (
                      <Text style={styles.surgeText}>
                        {' '}· {fareEstimate.surgeMultiplier.toFixed(1)}× surge
                      </Text>
                    )}
                  </Text>
                  {fareEstimate.surgeMultiplier > 1.1 && (
                    <View style={styles.surgeBadge}>
                      <Text style={styles.surgeBadgeText}>
                        {fareEstimate.surgeMultiplier.toFixed(1)}× High Demand
                      </Text>
                    </View>
                  )}
                  {airportPremium > 0 && (
                    <Text style={styles.airportPremium}>
                      Includes{' '}
                      <Text style={styles.airportPremiumAmount}>
                        ${airportPremium.toFixed(2)}
                      </Text>{' '}
                      airport premium
                    </Text>
                  )}
                  {terminal && (
                    <View style={styles.terminalRow}>
                      <Plane size={14} color={Colors.teal} />
                      <Text style={styles.terminalText}>
                        {terminal.name} · {terminal.description}
                      </Text>
                    </View>
                  )}
                </Card>
              </>
            )}

            {/* Payment method — always tappable through to Payment Methods. */}
            {paymentMethod !== undefined && (
              <TouchableOpacity
                style={styles.paymentRow}
                onPress={() => router.push('/payment-methods')}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={
                  paymentMethod
                    ? `Payment method ${capitalize(paymentMethod.brand)} ending ${paymentMethod.last4}`
                    : 'Add payment method'
                }
              >
                <CreditCard
                  size={18}
                  color={paymentMethod ? Colors.teal : Colors.warning}
                />
                <Text
                  style={[styles.paymentText, !paymentMethod && styles.paymentTextWarning]}
                >
                  {paymentMethod
                    ? `${capitalize(paymentMethod.brand)} ···· ${paymentMethod.last4}`
                    : 'Add payment method'}
                </Text>
                <ChevronRight size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}

            <Button
              title={
                fareEstimate
                  ? `Request ${serviceName} · $${fareEstimate.fare.toFixed(2)}`
                  : 'Enter Destination'
              }
              onPress={onRequest}
              disabled={!fareEstimate || requesting}
              loading={requesting}
              style={styles.requestButton}
            />

            <TouchableOpacity
              style={styles.bidButton}
              onPress={onMakeOffer}
              disabled={!fareEstimate}
              accessibilityRole="button"
              accessibilityLabel="Make an offer"
            >
              <Text style={styles.bidButtonText}>Make an Offer</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: SHEET_Z_INDEX,
  },
  sheetUnmeasured: { opacity: 0 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    ...Shadow.modal,
  },
  headerZone: {
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    paddingHorizontal: Spacing.base,
  },
  grabHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  heading: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing['3xl'],
  },
  shortcuts: { marginBottom: Spacing.sm },
  shortcutsContent: { gap: Spacing.sm },
  shortcutChip: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  shortcutText: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  errorText: {
    color: Colors.error,
    fontSize: Typography.size.sm,
    marginVertical: Spacing.sm,
  },
  fareLoader: { marginVertical: Spacing.md },
  fareCard: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fareLabel: {
    color: Colors.teal,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  fareAmount: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontFamily: Fonts.mono,
    fontWeight: Typography.weight.bold,
  },
  fareDetail: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginTop: 2,
  },
  surgeText: { color: Colors.warning },
  surgeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.warning + '22',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    marginTop: Spacing.sm,
  },
  surgeBadgeText: {
    color: Colors.warning,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  // Gold: important fare information (airport premium disclosure).
  airportPremium: {
    color: Colors.gold,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    marginTop: Spacing.sm,
  },
  airportPremiumAmount: { fontFamily: Typography.fontFamilyMono },
  terminalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
    paddingTop: Spacing.sm,
  },
  terminalText: {
    color: Colors.text,
    fontSize: Typography.size.sm,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  paymentText: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.base,
  },
  paymentTextWarning: { color: Colors.warning },
  requestButton: { marginBottom: Spacing.sm },
  bidButton: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  bidButtonText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
});
