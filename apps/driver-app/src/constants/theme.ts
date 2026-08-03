// Bidiride Design System — canonical tokens.
// The rider-app and driver-app copies of this file must stay identical.
export const Colors = {
  background: '#0A2342',     // Deep Navy — primary background
  backgroundElevated: '#0C284C', // Subtle raised background band (hero gradients)
  surface: '#0F2D55',        // Slightly lighter surface
  surfaceAlt: '#112C50',     // Card / modal background
  surfaceHover: '#143462',   // Pressed/hover surface
  border: '#1A3A5C',
  borderStrong: '#264B75',   // Emphasized borders (focused inputs, active cards)
  separator: '#172E4A',

  charcoal: '#0A1929',       // Charcoal Black — map geometry / deepest surfaces
  charcoalDeep: '#051524',   // Charcoal Black — map water / absolute depth

  primary: '#00D4C6',        // Electric Teal — AI + primary actions
  primaryText: '#0A2342',    // Navy text on Teal (WCAG AA — never use white on teal)
  primaryDark: '#00B3A7',    // Pressed state for teal fills
  primarySoft: 'rgba(0, 212, 198, 0.12)',  // Tinted teal fill (chips, icon badges)
  primarySoftBorder: 'rgba(0, 212, 198, 0.35)',
  teal: '#00D4C6',           // Alias for primary

  gold: '#F4B400',           // Earnings ONLY — do not use for other UI
  goldText: '#0A2342',       // Navy text on gold (WCAG AA)

  safety: '#EF4444',         // SOS / safety alerts ONLY
  safetyText: '#FFFFFF',

  text: '#FFFFFF',           // Primary text on navy
  textPrimary: '#FFFFFF',    // Alias for text
  textSecondary: '#8FA8C8',  // Muted text
  textTertiary: '#6B88A8',   // More muted text — 4.7:1 on navy, passes WCAG AA
  textDisabled: '#6B88A8',

  success: '#22C55E',
  successSoft: 'rgba(34, 197, 94, 0.14)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.14)',
  error: '#EF4444',
  errorSoft: 'rgba(239, 68, 68, 0.14)',
  info: '#38BDF8',
  infoSoft: 'rgba(56, 189, 248, 0.14)',

  overlay: 'rgba(10, 35, 66, 0.85)',
  scrim: 'rgba(5, 21, 36, 0.72)',   // Full-screen dim behind splash / loading overlays
} as const;

// Family names MUST match the keys registered via useFonts() in
// app/_layout.tsx. iOS also resolves the fonts' embedded family names
// ('Inter', 'JetBrains Mono'), but Android resolves ONLY these aliases —
// anything else silently falls back to the system font.
export const Fonts = {
  sans: 'Inter-Regular',
  sansMedium: 'Inter-Medium',
  sansSemiBold: 'Inter-SemiBold',
  sansBold: 'Inter-Bold',
  sansExtraBold: 'Inter-ExtraBold',
  mono: 'JetBrainsMono-Regular',
  monoBold: 'JetBrainsMono-Bold',   // ALL financial figures
} as const;

export const Typography = {
  fontFamily: Fonts.sans,
  fontFamilyMono: Fonts.monoBold,   // Financial figures ONLY — always bold mono

  size: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 28,
    '3xl': 36,   // Large driver metric cards
    '4xl': 48,
  },

  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },

  // Financial figure presets (JetBrains Mono)
  heroEarnings: { fontSize: 52, fontFamily: Fonts.monoBold, fontWeight: '700' as const },
  largeAmount:  { fontSize: 32, fontFamily: Fonts.monoBold, fontWeight: '700' as const },
  amount:       { fontSize: 24, fontFamily: Fonts.monoBold, fontWeight: '600' as const },
  smallAmount:  { fontSize: 18, fontFamily: Fonts.monoBold, fontWeight: '600' as const },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  // Teal glow — for primary CTAs and the brand mark. Gives depth without a
  // gradient library (none installed). Keep opacity subtle on dark navy.
  glow: {
    shadowColor: '#00D4C6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  button: {
    shadowColor: '#00D4C6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// Standard motion timings (ms) — keep animations consistent and calm.
export const Motion = {
  fast: 140,
  base: 220,
  slow: 380,
  splash: 900,
} as const;

// Brand identity — the canonical wordmark is "Bidiride" (capital B, lowercase
// "idiride"). BrandMark renders the logo glyph + this wordmark.
export const Brand = {
  name: 'Bidiride',
  tagline: 'Move people. Move goods. Move money.',
} as const;

export type ThemeColor = keyof typeof Colors;
