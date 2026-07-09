// BidiRide Design System — canonical tokens.
// The rider-app and driver-app copies of this file must stay identical.
export const Colors = {
  background: '#0A2342',     // Deep Navy — primary background
  surface: '#0F2D55',        // Slightly lighter surface
  surfaceAlt: '#112C50',     // Card / modal background
  border: '#1A3A5C',
  separator: '#172E4A',

  charcoal: '#0A1929',       // Charcoal Black — map geometry / deepest surfaces
  charcoalDeep: '#051524',   // Charcoal Black — map water / absolute depth

  primary: '#00D4C6',        // Electric Teal — AI + primary actions
  primaryText: '#0A2342',    // Navy text on Teal (WCAG AA — never use white on teal)
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
  warning: '#F59E0B',
  error: '#EF4444',

  overlay: 'rgba(10, 35, 66, 0.85)',
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
} as const;
