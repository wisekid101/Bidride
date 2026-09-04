import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Spacing, Typography } from '../../constants/theme';
import { Button } from './Button';

// Bidiride feedback states — Loading / Error / Empty / Success / inline Banner.
// Keep rider-app / driver-app copies identical. These give every screen the
// production states the founder mandated: no blank screens, no dead ends.

type BannerVariant = 'info' | 'success' | 'error' | 'warning';

const BANNER: Record<BannerVariant, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  info: { bg: Colors.infoSoft, fg: Colors.info, icon: 'information-circle' },
  success: { bg: Colors.successSoft, fg: Colors.success, icon: 'checkmark-circle' },
  error: { bg: Colors.errorSoft, fg: Colors.error, icon: 'alert-circle' },
  warning: { bg: Colors.warningSoft, fg: Colors.warning, icon: 'warning' },
};

/** Inline message banner — animates in; use for form-level errors/success. */
export function InlineBanner({
  variant = 'info',
  message,
  style,
}: {
  variant?: BannerVariant;
  message: string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = BANNER[variant];
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
  }, [anim]);
  return (
    <Animated.View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: v.bg, borderColor: v.fg + '55' },
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] },
        style,
      ]}
    >
      <Ionicons name={v.icon} size={18} color={v.fg} />
      <Text style={[styles.bannerText, { color: v.fg }]}>{message}</Text>
    </Animated.View>
  );
}

/** Full-area loading state with a message. */
export function LoadingState({ message = 'Loading…', style }: { message?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.center, style]} accessibilityLabel={message} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.centerMsg}>{message}</Text>
    </View>
  );
}

/** Dimmed overlay spinner — for blocking actions over existing content. */
export function LoadingOverlay({ message, visible }: { message?: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.overlay} accessibilityLabel={message ?? 'Working'} accessibilityRole="progressbar">
      <View style={styles.overlayCard}>
        <ActivityIndicator size="large" color={Colors.primary} />
        {message && <Text style={styles.centerMsg}>{message}</Text>}
      </View>
    </View>
  );
}

/** Error state with an icon, message and optional retry. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  style,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, style]}>
      <View style={[styles.iconBadge, { backgroundColor: Colors.errorSoft }]}>
        <Ionicons name="cloud-offline-outline" size={30} color={Colors.error} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.body}>{message}</Text>}
      {onRetry && (
        <Button title={retryLabel} icon="refresh" variant="secondary" fullWidth={false} onPress={onRetry} style={styles.action} />
      )}
    </View>
  );
}

/** Empty state — icon, title, message and optional CTA. */
export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  actionLabel,
  onAction,
  style,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, style]}>
      <View style={[styles.iconBadge, { backgroundColor: Colors.primarySoft }]}>
        <Ionicons name={icon} size={30} color={Colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.body}>{message}</Text>}
      {actionLabel && onAction && (
        <Button title={actionLabel} fullWidth={false} onPress={onAction} style={styles.action} />
      )}
    </View>
  );
}

/** Animated success check — for post-submit confirmation. */
export function SuccessCheck({ size = 84 }: { size?: number }) {
  const scale = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(ring, { toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [ring, scale]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          styles.successRing,
          { width: size, height: size, borderRadius: size / 2, opacity: ring, transform: [{ scale: ring }] },
        ]}
      />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name="checkmark-circle" size={size * 0.78} color={Colors.success} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
  },
  bannerText: { flex: 1, fontSize: Typography.size.sm, fontFamily: Fonts.sansMedium, lineHeight: 19 },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  centerMsg: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontFamily: Fonts.sans, marginTop: Spacing.md },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim, alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  overlayCard: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.lg,
    padding: Spacing['2xl'],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconBadge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  title: { color: Colors.text, fontSize: Typography.size.lg, fontFamily: Fonts.sansBold, textAlign: 'center' },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, fontFamily: Fonts.sans, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  action: { marginTop: Spacing.sm },
  successRing: { position: 'absolute', backgroundColor: Colors.successSoft },
});
