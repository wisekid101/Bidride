import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../../src/constants/theme';
import { useDriverStore } from '../../src/store/driver.store';
import { api } from '../../src/api/client';

interface ActiveVehicle {
  make: string | null;
  model: string | null;
  color: string | null;
  licensePlate: string | null;
}

interface DriverProfile {
  id: string;
  status: string;
  legalFirstName: string | null;
  legalLastName: string | null;
  phone: string | null;
  email: string | null;
  profilePhotoUrl: string | null;
  activeVehicle: ActiveVehicle | null;
  badge: string;
  totalTrips: number;
  avgRating: number | null;
  isAvailable: boolean;
  payoutBankVerified: boolean;
  memberSince: string;
}

function getInitials(first: string | null, last: string | null): string {
  const f = first?.trim()[0]?.toUpperCase() ?? '';
  const l = last?.trim()[0]?.toUpperCase() ?? '';
  return (f + l) || '?';
}

function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatBadge(badge: string): string {
  return badge.charAt(0).toUpperCase() + badge.slice(1).toLowerCase();
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    approved: 'Approved',
    pending: 'Pending',
    under_review: 'Under Review',
    declined: 'Declined',
    suspended: 'Suspended',
  };
  return labels[status] ?? status;
}

function statusColor(status: string): string {
  if (status === 'approved') return Colors.primary;
  if (status === 'declined' || status === 'suspended') return Colors.safety;
  return Colors.textSecondary;
}

export default function DriverProfileScreen() {
  const router = useRouter();
  const { isOnline, clearTokens } = useDriverStore();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchProfile = () => {
    setLoading(true);
    setError(false);
    api
      .get<DriverProfile>('/drivers/me')
      .then((data) => setProfile(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSignOut = () => {
    if (isOnline) {
      Alert.alert('Go offline first', 'Please go offline before signing out.');
      return;
    }
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => clearTokens() },
    ]);
  };

  const displayName =
    [profile?.legalFirstName, profile?.legalLastName].filter(Boolean).join(' ') || 'Driver';

  const vehicle = profile?.activeVehicle;
  const vehicleLabel = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Identity Card */}
      <View style={styles.card}>
        {/* Avatar */}
        <View style={styles.avatarWrap}>
          {profile?.profilePhotoUrl ? (
            <Image source={{ uri: profile.profilePhotoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>
                {getInitials(profile?.legalFirstName ?? null, profile?.legalLastName ?? null)}
              </Text>
            </View>
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={styles.loader} />
        ) : error ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>Could not load profile.</Text>
            <TouchableOpacity onPress={fetchProfile}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.name}>{displayName}</Text>
            {profile?.phone ? (
              <Text style={styles.phone}>{profile.phone}</Text>
            ) : null}

            {/* Badge + status chips */}
            <View style={styles.chipsRow}>
              <View style={styles.badgeChip}>
                <Text style={styles.badgeText}>{formatBadge(profile?.badge ?? 'Verified')}</Text>
              </View>
              <View
                style={[
                  styles.statusChip,
                  { borderColor: statusColor(profile?.status ?? '') },
                ]}
              >
                <Text
                  style={[styles.statusText, { color: statusColor(profile?.status ?? '') }]}
                >
                  {formatStatus(profile?.status ?? '')}
                </Text>
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {profile?.avgRating != null ? profile.avgRating.toFixed(2) : '—'}
                </Text>
                <Text style={styles.statLabel}>rating</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile?.totalTrips ?? 0}</Text>
                <Text style={styles.statLabel}>trips</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {profile?.memberSince ? formatMemberSince(profile.memberSince) : '—'}
                </Text>
                <Text style={styles.statLabel}>member since</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Active vehicle card */}
      {!loading && !error && vehicleLabel ? (
        <View style={styles.vehicleCard}>
          <Text style={styles.vehicleLabel}>Active Vehicle</Text>
          <View style={styles.vehicleRow}>
            <Text style={styles.vehicleInfo}>{vehicleLabel}</Text>
            {vehicle?.licensePlate ? (
              <Text style={styles.licensePlate}>{vehicle.licensePlate}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Account Links */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push('/onboarding/vehicle-info')}
        >
          <Text style={styles.rowText}>Vehicle &amp; Documents</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.row, styles.rowLast]}
          onPress={() => router.push('/wallet')}
        >
          <Text style={styles.rowText}>Wallet / Payout</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.row, styles.rowLast]}
          onPress={handleSignOut}
        >
          <Text style={styles.rowTextDanger}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: Spacing['3xl'],
  },
  card: {
    margin: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  avatarWrap: { marginBottom: Spacing.md },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: Colors.primaryText,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
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
  name: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  phone: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    marginBottom: Spacing.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.base,
  },
  badgeChip: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  badgeText: {
    color: Colors.primary,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  statItem: { alignItems: 'center', paddingHorizontal: Spacing.md },
  statValue: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  vehicleCard: {
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    marginBottom: Spacing.xs,
  },
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vehicleInfo: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    flex: 1,
  },
  licensePlate: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    fontFamily: Typography.fontFamilyMono,
  },
  section: {
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { color: Colors.text, fontSize: Typography.size.base },
  rowChevron: { color: Colors.textSecondary, fontSize: Typography.size.lg },
  rowTextDanger: { color: Colors.safety, fontSize: Typography.size.base },
});
