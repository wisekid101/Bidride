import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
  Colors,
  Radius,
  Shadow,
  Spacing,
  Typography,
} from '../constants/theme';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { useDriverStore } from '../store/driver.store';
import { useDriverSocketStore } from '../store/socket.store';
import { api } from '../api/client';

// LayoutAnimation is opt-in on old Android architecture
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Fallback height for the collapsed strip (grab handle + "Driver Hub" header
// row) until the real header height is measured via onLayout.
const COLLAPSED_VISIBLE_FALLBACK = 84;

// Vertical band kept clear above the fully-open sheet so the Online toggle
// and EWR Queue pills stay visible and tappable (header sits at ~60–104pt).
const HEADER_CLEARANCE = 112;

// Must stay BELOW the incoming request/bid overlays (zIndex 999) so ride
// offers always cover the hub.
const SHEET_Z_INDEX = 100;

type SnapState = 'collapsed' | 'half' | 'full';

interface DriverProfile {
  legalFirstName: string | null;
  legalLastName: string | null;
  profilePhotoUrl: string | null;
  avgRating: number | null;
  badge: string;
  status: string;
  totalTrips: number;
}

function getInitials(first: string | null, last: string | null): string {
  const f = first?.trim()[0]?.toUpperCase() ?? '';
  const l = last?.trim()[0]?.toUpperCase() ?? '';
  return f + l || '?';
}

function formatBadge(badge: string): string {
  return badge.charAt(0).toUpperCase() + badge.slice(1).toLowerCase();
}

interface HubRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  last?: boolean;
}

function HubRow({ icon, label, onPress, last }: HubRowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={Colors.primary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
    </TouchableOpacity>
  );
}

export function DriverHubSheet() {
  const { height: windowHeight } = useWindowDimensions();
  const { isOnline, todayEarnings, clearTokens } = useDriverStore();

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [snapState, setSnapState] = useState<SnapState>('collapsed');
  const [zoneExpanded, setZoneExpanded] = useState(false);

  // Measured at runtime: the tab-screen container (excludes tab bar / home
  // inset, unlike windowHeight) and the real header-strip height.
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState(COLLAPSED_VISIBLE_FALLBACK);

  const ch = containerHeight ?? windowHeight;
  // Cap the sheet so its fully-open top edge never intrudes into the
  // Online-toggle / EWR-Queue band — those must stay usable at every snap.
  const SHEET_HEIGHT = Math.min(Math.round(ch * 0.88), ch - HEADER_CLEARANCE);
  const snaps = useMemo(
    () => ({
      full: 0,
      half: SHEET_HEIGHT - Math.round(ch * 0.45),
      collapsed: SHEET_HEIGHT - headerHeight,
    }),
    [SHEET_HEIGHT, ch, headerHeight],
  );

  const translateY = useRef(new Animated.Value(snaps.collapsed)).current;
  const lastY = useRef(snaps.collapsed);
  const dragStartY = useRef(snaps.collapsed);
  const snapStateRef = useRef<SnapState>('collapsed');

  // Re-anchor to the current snap whenever the geometry changes (container
  // measured, header measured, window resized) — the Animated.Value was
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
      const state: SnapState =
        target === snaps.full
          ? 'full'
          : target === snaps.half
            ? 'half'
            : 'collapsed';
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
    if (snapState === 'collapsed') snapTo(snaps.half);
    else if (snapState === 'half') snapTo(snaps.full);
    else snapTo(snaps.collapsed);
  }, [snapState, snaps, snapTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          dragStartY.current = lastY.current;
        },
        onPanResponderMove: (_evt, g) => {
          const next = Math.min(
            Math.max(dragStartY.current + g.dy, snaps.full),
            snaps.collapsed,
          );
          translateY.setValue(next);
        },
        onPanResponderRelease: (_evt, g) => {
          // No meaningful movement — treat as a tap on the header: cycle
          // collapsed → half → full → collapsed.
          if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
            cycleSnap();
            return;
          }
          const pos = Math.min(
            Math.max(dragStartY.current + g.dy, snaps.full),
            snaps.collapsed,
          );
          const ordered = [snaps.full, snaps.half, snaps.collapsed];
          let target: number;
          if (Math.abs(g.vy) > 0.5) {
            // Fling: continue to the next snap point in the fling direction
            target =
              g.vy > 0
                ? (ordered.find((s) => s > pos + 1) ?? snaps.collapsed)
                : ([...ordered].reverse().find((s) => s < pos - 1) ??
                  snaps.full);
          } else {
            target = ordered.reduce((a, b) =>
              Math.abs(b - pos) < Math.abs(a - pos) ? b : a,
            );
          }
          snapTo(target);
        },
        onPanResponderTerminate: () => {
          const ordered = [snaps.full, snaps.half, snaps.collapsed];
          const pos = lastY.current;
          snapTo(
            ordered.reduce((a, b) =>
              Math.abs(b - pos) < Math.abs(a - pos) ? b : a,
            ),
          );
        },
      }),
    [snaps, snapTo, cycleSnap, translateY],
  );

  const fetchProfile = useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .get<DriverProfile>('/drivers/me')
      .then((data) => setProfile(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Refresh identity/rating whenever Home gains focus (covers mount too)
  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile]),
  );

  const toggleZone = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setZoneExpanded((e) => !e);
  };

  const handleSignOut = () => {
    if (isOnline) {
      Alert.alert('Go offline first', 'Please go offline before signing out.');
      return;
    }
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          // Tear the socket down BEFORE clearing tokens — a connected socket
          // keeps its handshake auth and would keep streaming GPS after
          // sign-out (same order as OnboardingHeader).
          useDriverSocketStore.getState().disconnect();
          clearTokens();
        },
      },
    ]);
  };

  // Rule-based zone floor: earnings floor formula for a typical Newark trip (~3 mi, ~12 min)
  // Formula: (miles × $1.10) + (minutes × $0.22) + $2.50
  const ZONE_FLOOR_EST = parseFloat((3.0 * 1.1 + 12 * 0.22 + 2.5).toFixed(2));
  const sessionAvgPerTrip =
    todayEarnings.trips > 0
      ? parseFloat((todayEarnings.takeHome / todayEarnings.trips).toFixed(2))
      : null;

  const displayName =
    [profile?.legalFirstName, profile?.legalLastName]
      .filter(Boolean)
      .join(' ') || 'Driver';

  return (
    // box-none: only the sheet itself takes touches — map and top header
    // stay interactive everywhere else. onLayout gives the true tab-screen
    // height (windowHeight includes the tab bar and home inset).
    <View
      style={styles.overlay}
      pointerEvents="box-none"
      onLayout={(e) =>
        setContainerHeight(Math.round(e.nativeEvent.layout.height))
      }
    >
      <Animated.View
        style={[
          styles.sheet,
          { height: SHEET_HEIGHT, transform: [{ translateY }] },
        ]}
      >
        {/* Grab handle + header — the drag zone. This strip is the whole
            collapsed state, so it stays compact and the map keeps the screen. */}
        <View
          {...panResponder.panHandlers}
          style={styles.headerZone}
          onLayout={(e) =>
            setHeaderHeight(Math.round(e.nativeEvent.layout.height))
          }
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Driver Hub. Today's take-home $${todayEarnings.takeHome.toFixed(2)}.`}
          accessibilityHint={`Currently ${snapState}. Tap to expand, or drag the handle to resize.`}
          onAccessibilityTap={cycleSnap}
        >
          <View style={styles.grabHandle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Driver Hub</Text>
            <Text style={styles.headerAmount}>
              ${todayEarnings.takeHome.toFixed(2)}
            </Text>
          </View>
        </View>

        <ScrollView
          scrollEnabled={snapState !== 'collapsed'}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          accessibilityElementsHidden={snapState === 'collapsed'}
          importantForAccessibility={
            snapState === 'collapsed' ? 'no-hide-descendants' : 'auto'
          }
        >
          {/* Profile card — the half-open view */}
          <Card style={styles.profileCard}>
            {loading ? (
              <ActivityIndicator color={Colors.primary} style={styles.loader} />
            ) : error ? (
              <View style={styles.errorWrap}>
                <Text style={styles.errorText}>Could not load profile</Text>
                <TouchableOpacity
                  onPress={fetchProfile}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.profileRow}>
                  {profile?.profilePhotoUrl ? (
                    <Image
                      source={{ uri: profile.profilePhotoUrl }}
                      style={styles.avatar}
                    />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarInitials}>
                        {getInitials(
                          profile?.legalFirstName ?? null,
                          profile?.legalLastName ?? null,
                        )}
                      </Text>
                    </View>
                  )}
                  <View style={styles.profileInfo}>
                    <Text style={styles.name} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <View style={styles.metaRow}>
                      <Ionicons name="star" size={13} color={Colors.text} />
                      <Text style={styles.rating}>
                        {profile?.avgRating != null
                          ? Number(profile.avgRating).toFixed(2)
                          : '—'}
                      </Text>
                      <View style={styles.badgeChip}>
                        <Text style={styles.badgeText}>
                          {formatBadge(profile?.badge ?? 'Verified')}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.onlineWrap}>
                    <View
                      style={[
                        styles.statusDot,
                        isOnline && styles.statusDotOnline,
                      ]}
                    />
                    <Text
                      style={[
                        styles.onlineText,
                        isOnline && styles.onlineTextActive,
                      ]}
                    >
                      {isOnline ? 'Online' : 'Offline'}
                    </Text>
                  </View>
                </View>

                {/* Take-home first and largest — non-negotiable */}
                <View style={styles.earningsHero}>
                  <Text style={styles.earningsLabel}>Today's take-home</Text>
                  <Text style={styles.earningsAmount}>
                    ${todayEarnings.takeHome.toFixed(2)}
                  </Text>
                  <Text style={styles.earningsSub}>
                    {todayEarnings.trips}{' '}
                    {todayEarnings.trips === 1 ? 'trip' : 'trips'} today
                    {'  ·  '}
                    {todayEarnings.hoursOnline.toFixed(1)} hrs online
                  </Text>
                </View>
              </>
            )}
          </Card>

          {/* EARN & DRIVE */}
          <Text style={styles.sectionTitle} accessibilityRole="header">
            EARN &amp; DRIVE
          </Text>
          <Card padded={false} style={styles.sectionCard}>
            <HubRow
              icon="cash-outline"
              label="Earnings"
              onPress={() => router.push('/(tabs)/earnings')}
            />
            <HubRow
              icon="wallet-outline"
              label="Wallet"
              onPress={() => router.push('/wallet')}
            />
            <HubRow
              icon="airplane"
              label="Airport Queue"
              onPress={() => router.push('/airport-mode')}
            />
            <TouchableOpacity
              style={[styles.row, styles.rowLast]}
              onPress={toggleZone}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: zoneExpanded }}
              accessibilityLabel={
                zoneExpanded
                  ? 'Collapse zone opportunity'
                  : 'Expand zone opportunity'
              }
            >
              <Ionicons
                name="trending-up-outline"
                size={20}
                color={Colors.primary}
              />
              <Text style={styles.rowLabel}>Zone Opportunity</Text>
              <Text style={styles.zoneEstimated}>estimated</Text>
              <Ionicons
                name={zoneExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
            {zoneExpanded && (
              <View style={styles.zoneBody}>
                <View style={styles.zoneRow}>
                  <Text style={styles.zoneLabel}>Floor guarantee</Text>
                  <Text style={styles.zoneValue}>
                    ${ZONE_FLOOR_EST.toFixed(2)}+ / typical trip
                  </Text>
                </View>
                {sessionAvgPerTrip !== null ? (
                  <View style={styles.zoneRow}>
                    <Text style={styles.zoneLabel}>Your session avg</Text>
                    <Text style={styles.zoneValue}>
                      ${sessionAvgPerTrip.toFixed(2)} / trip
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.zoneNoData}>
                    No trips yet this session
                  </Text>
                )}
                <View style={styles.zoneRow}>
                  <Text style={styles.zoneLabel}>Hours online</Text>
                  <Text style={styles.zoneValue}>
                    {todayEarnings.hoursOnline.toFixed(1)}
                  </Text>
                </View>
              </View>
            )}
          </Card>

          {/* MANAGE */}
          <Text style={styles.sectionTitle} accessibilityRole="header">
            MANAGE
          </Text>
          <Card padded={false} style={styles.sectionCard}>
            <HubRow
              icon="person-outline"
              label="Profile"
              onPress={() => router.push('/(tabs)/profile')}
            />
            <HubRow
              icon="car-outline"
              label="Vehicles"
              onPress={() => router.push('/onboarding/vehicle-info')}
            />
            <HubRow
              icon="document-text-outline"
              label="Documents"
              onPress={() => router.push('/onboarding/document-upload')}
            />
            <HubRow
              icon="business-outline"
              label="Bank Account"
              onPress={() => router.push('/onboarding/bank-account')}
              last
            />
          </Card>

          {/* ACCOUNT */}
          <Text style={styles.sectionTitle} accessibilityRole="header">
            ACCOUNT
          </Text>
          <Button
            title="Sign Out"
            variant="danger"
            onPress={handleSignOut}
            style={styles.signOutButton}
          />
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
    paddingBottom: Spacing.md,
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  headerAmount: {
    color: Colors.gold,
    fontSize: Typography.size.lg,
    fontFamily: Typography.fontFamilyMono,
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing['3xl'],
  },
  profileCard: {
    marginBottom: Spacing.base,
  },
  loader: { marginVertical: Spacing.lg },
  errorWrap: { alignItems: 'center', paddingVertical: Spacing.base },
  errorText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginBottom: Spacing.xs,
  },
  retryText: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: Colors.primaryText,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
  },
  profileInfo: { flex: 1 },
  name: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  rating: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    fontFamily: Typography.fontFamilyMono,
  },
  badgeChip: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 1,
    marginLeft: Spacing.xs,
  },
  badgeText: {
    color: Colors.primary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  onlineWrap: { alignItems: 'center', gap: 2 },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.textDisabled,
  },
  statusDotOnline: { backgroundColor: Colors.primary },
  onlineText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  onlineTextActive: { color: Colors.primary },
  earningsHero: {
    marginTop: Spacing.base,
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
    paddingTop: Spacing.md,
    alignItems: 'center',
  },
  earningsLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginBottom: Spacing.xs,
  },
  earningsAmount: {
    ...Typography.largeAmount,
    color: Colors.gold,
  },
  earningsSub: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.bold,
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  sectionCard: {
    marginBottom: Spacing.base,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.separator,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.base,
  },
  zoneEstimated: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
  },
  zoneBody: {
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    gap: 2,
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
  signOutButton: {
    marginBottom: Spacing.base,
  },
});
