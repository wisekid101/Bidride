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
import { useAuthStore } from '../../src/store/auth.store';
import { useSocketStore } from '../../src/store/socket.store';
import { api } from '../../src/api/client';

interface RiderProfile {
  id: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  badge: string;
  rewardPoints: number;
  totalTrips: number;
  createdAt: string;
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

export default function ProfileScreen() {
  const router = useRouter();
  const { clearTokens } = useAuthStore();
  const { disconnect } = useSocketStore();
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchProfile = () => {
    setLoading(true);
    setError(false);
    api
      .get<RiderProfile>('/riders/me')
      .then((data) => setProfile(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          disconnect();
          await clearTokens();
        },
      },
    ]);
  };

  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Rider';

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
                {getInitials(profile?.firstName ?? null, profile?.lastName ?? null)}
              </Text>
            </View>
          )}
        </View>

        {/* Name / loading / error */}
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
            <View style={styles.badgeChip}>
              <Text style={styles.badgeText}>{formatBadge(profile?.badge ?? 'Verified')}</Text>
            </View>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile?.totalTrips ?? 0}</Text>
                <Text style={styles.statLabel}>trips</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {(profile?.rewardPoints ?? 0).toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>points</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {profile?.createdAt ? formatMemberSince(profile.createdAt) : '—'}
                </Text>
                <Text style={styles.statLabel}>member since</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Account Links */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push('/payment-methods')}
        >
          <Text style={styles.rowText}>Payment Methods</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.row, styles.rowLast]}
          onPress={() => router.push('/trusted-contacts')}
        >
          <Text style={styles.rowText}>Trusted Contacts</Text>
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
  badgeChip: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    marginBottom: Spacing.base,
  },
  badgeText: {
    color: Colors.primary,
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
