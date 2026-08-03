import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing, Typography } from '../../constants/theme';

// Bidiride honest verification status pill. Keep rider-app / driver-app copies
// identical. These labels tell the truth about where a document / account is in
// review — a new account is NEVER shown as "Verified" (founder rule). "Verified"
// appears only when a real workflow has confirmed it.
export type Status =
  | 'unverified'
  | 'pending'
  | 'in_review'
  | 'captured'
  | 'uploaded'
  | 'verified'
  | 'approved'
  | 'rejected'
  | 'retry'
  | 'expired';

const MAP: Record<Status, { label: string; fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  unverified: { label: 'Not verified', fg: Colors.textSecondary, bg: Colors.surfaceHover, icon: 'ellipse-outline' },
  pending:    { label: 'Pending',       fg: Colors.warning, bg: Colors.warningSoft, icon: 'time-outline' },
  in_review:  { label: 'In review',     fg: Colors.info,    bg: Colors.infoSoft,    icon: 'search-outline' },
  captured:   { label: 'Captured',      fg: Colors.textSecondary, bg: Colors.surfaceHover, icon: 'camera-outline' },
  uploaded:   { label: 'Uploaded',      fg: Colors.info,    bg: Colors.infoSoft,    icon: 'cloud-upload-outline' },
  verified:   { label: 'Verified',      fg: Colors.success, bg: Colors.successSoft, icon: 'shield-checkmark' },
  approved:   { label: 'Approved',      fg: Colors.success, bg: Colors.successSoft, icon: 'checkmark-circle' },
  rejected:   { label: 'Rejected',      fg: Colors.error,   bg: Colors.errorSoft,   icon: 'close-circle' },
  retry:      { label: 'Retry required',fg: Colors.warning, bg: Colors.warningSoft, icon: 'refresh-outline' },
  expired:    { label: 'Expired',       fg: Colors.error,   bg: Colors.errorSoft,   icon: 'alert-circle-outline' },
};

interface StatusChipProps {
  status: Status;
  label?: string;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

export function StatusChip({ status, label, size = 'md', style }: StatusChipProps) {
  const s = MAP[status];
  const iconSize = size === 'sm' ? 13 : 15;
  return (
    <View
      style={[styles.chip, size === 'sm' && styles.chipSm, { backgroundColor: s.bg }, style]}
      accessibilityLabel={`Status: ${label ?? s.label}`}
    >
      <Ionicons name={s.icon} size={iconSize} color={s.fg} />
      <Text style={[styles.text, size === 'sm' && styles.textSm, { color: s.fg }]} allowFontScaling={false}>
        {label ?? s.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: Radius.full,
    paddingVertical: 5,
    paddingHorizontal: Spacing.md,
  },
  chipSm: { paddingVertical: 3, paddingHorizontal: Spacing.sm },
  text: { fontSize: Typography.size.sm, fontFamily: Fonts.sansSemiBold, letterSpacing: 0.2 },
  textSm: { fontSize: Typography.size.xs },
});
