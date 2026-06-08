export const Colors = {
  background: '#0A2342',
  surface: '#0F2E52',
  surfaceAlt: '#112C50',
  border: '#1A3A62',
  separator: '#172E4A',

  primary: '#00D4C6',         // Electric Teal — AI + primary actions
  primaryText: '#0A2342',     // Navy text on Teal (WCAG AA — never use white on teal)
  teal: '#00D4C6',

  gold: '#F4B400',            // EARNINGS ONLY
  goldText: '#0A2342',

  safety: '#EF4444',          // SOS/SAFETY ONLY
  safetyText: '#FFFFFF',

  text: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textDisabled: '#4A6785',

  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',

  overlay: 'rgba(10, 35, 66, 0.85)',
} as const;

export const Fonts = {
  sans: 'Inter',
  mono: 'JetBrains Mono',     // ALL financial figures
} as const;

export const Typography = {
  fontFamily: 'Inter',
  fontFamilyMono: 'JetBrains Mono',

  size: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 28,
    '3xl': 36,
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
  heroEarnings: { fontSize: 52, fontFamily: Fonts.mono, fontWeight: '700' as const },
  largeAmount:  { fontSize: 32, fontFamily: Fonts.mono, fontWeight: '700' as const },
  amount:       { fontSize: 24, fontFamily: Fonts.mono, fontWeight: '600' as const },
  smallAmount:  { fontSize: 18, fontFamily: Fonts.mono, fontWeight: '600' as const },
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
