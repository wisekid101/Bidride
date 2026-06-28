// BidiRide Design System — Rider App
export const Colors = {
  background: '#0A2342',     // Deep Navy — primary background
  surface: '#0F2D55',        // Slightly lighter surface
  surfaceAlt: '#112C50',     // Card / modal background

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
  textTertiary: '#4A6785',   // More muted text
  textDisabled: '#4A6785',

  border: '#1A3A5C',
  separator: '#172E4A',

  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',

  overlay: 'rgba(10, 35, 66, 0.85)',
};

export const Fonts = {
  sans: 'Inter',
  mono: 'JetBrains Mono',  // ALL financial figures
} as const;

export const Typography = {
  // Inter — all body text, labels, UI
  fontFamily: 'Inter',
  fontFamilyMono: 'JetBrains Mono', // Financial figures ONLY

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
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

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
};
