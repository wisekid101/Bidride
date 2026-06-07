export const Colors = {
  // Core palette
  background: '#0A2342',  // Navy
  surface: '#0F2E52',
  border: '#1A3A62',

  // Brand
  teal: '#00D4C6',
  gold: '#F4B400',         // EARNINGS ONLY
  safety: '#EF4444',       // SOS/SAFETY ONLY

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
} as const;

export const Fonts = {
  sans: 'Inter',
  mono: 'JetBrains Mono',  // ALL financial figures
} as const;

// Typography scale
export const Typography = {
  heroEarnings: { fontSize: 52, fontFamily: Fonts.mono, fontWeight: '700' as const },
  largeAmount:  { fontSize: 32, fontFamily: Fonts.mono, fontWeight: '700' as const },
  amount:       { fontSize: 24, fontFamily: Fonts.mono, fontWeight: '600' as const },
  smallAmount:  { fontSize: 18, fontFamily: Fonts.mono, fontWeight: '600' as const },
} as const;
