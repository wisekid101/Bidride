import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Brand, Colors, Fonts, Shadow } from '../../constants/theme';

// Bidiride brand mark — the logo glyph + wordmark. Dependency-free (no SVG,
// so the rider-app and driver-app copies stay identical). The glyph is a
// teal rounded badge carrying a navigation arrow, evoking movement.
//   layout: 'horizontal' | 'stacked' | 'mark' | 'wordmark'
//   size:   'sm' | 'md' | 'lg' | 'hero'
type BrandLayout = 'horizontal' | 'stacked' | 'mark' | 'wordmark';
type BrandSize = 'sm' | 'md' | 'lg' | 'hero';

interface BrandMarkProps {
  layout?: BrandLayout;
  size?: BrandSize;
  wordmarkColor?: string;
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<BrandSize, { badge: number; radius: number; glyph: number; word: number; gap: number }> = {
  sm:   { badge: 34,  radius: 10, glyph: 20, word: 20, gap: 10 },
  md:   { badge: 48,  radius: 14, glyph: 28, word: 28, gap: 12 },
  lg:   { badge: 68,  radius: 20, glyph: 40, word: 38, gap: 16 },
  hero: { badge: 96,  radius: 28, glyph: 56, word: 44, gap: 20 },
};

export function BrandMark({
  layout = 'horizontal',
  size = 'md',
  wordmarkColor = Colors.text,
  glow = true,
  style,
}: BrandMarkProps) {
  const s = SIZES[size];

  const badge = (
    <View
      style={[
        styles.badge,
        { width: s.badge, height: s.badge, borderRadius: s.radius },
        glow && Shadow.glow,
      ]}
    >
      <Ionicons name="navigate" size={s.glyph} color={Colors.primaryText} style={styles.glyph} />
    </View>
  );

  const wordmark = (
    <Text
      style={[styles.word, { fontSize: s.word, color: wordmarkColor }]}
      accessibilityRole="header"
      allowFontScaling={false}
    >
      {Brand.name}
    </Text>
  );

  if (layout === 'mark') {
    return (
      <View style={style} accessibilityLabel="Bidiride" accessibilityRole="image">
        {badge}
      </View>
    );
  }
  if (layout === 'wordmark') {
    return <View style={style}>{wordmark}</View>;
  }

  return (
    <View
      style={[
        layout === 'stacked' ? styles.stacked : styles.horizontal,
        layout === 'stacked' ? { gap: s.gap } : { gap: s.gap },
        style,
      ]}
      accessibilityLabel="Bidiride"
    >
      {badge}
      {wordmark}
    </View>
  );
}

const styles = StyleSheet.create({
  horizontal: { flexDirection: 'row', alignItems: 'center' },
  stacked: { flexDirection: 'column', alignItems: 'center' },
  badge: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The navigate glyph reads as an arrow; nudge it optically centred.
  glyph: { marginLeft: 1, marginTop: 1 },
  word: {
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: -0.8,
    includeFontPadding: false,
  },
});
