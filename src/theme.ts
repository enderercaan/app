import { useMemo } from 'react';
import { Appearance, useColorScheme, type ViewStyle } from 'react-native';

const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;
const radius = { sm: 10, md: 16, lg: 22, xl: 28, xxl: 36, pill: 999 } as const;
const type = {
  display: { fontSize: 34, lineHeight: 39, fontWeight: '900' as const },
  h1: { fontSize: 28, lineHeight: 33, fontWeight: '900' as const },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '900' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '800' as const },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '700' as const }
} as const;

const lightColors = {
  background: '#F0FDF4',
  surface: '#FFFFFF',
  surfaceAlt: '#E7F8ED',
  surfaceStrong: '#D7F2E1',
  text: '#0F172A',
  textSoft: '#334155',
  muted: '#526277',
  primary: '#0F172A',
  primaryDeep: '#08111F',
  primarySoft: '#DFF7E8',
  onPrimary: '#FFFFFF',
  onAccent: '#0F172A',
  onSuccess: '#FFFFFF',
  accent: '#FF6B6B',
  accentSoft: '#FFF0F0',
  success: '#147D57',
  successSoft: '#E1F7EC',
  warning: '#8A510D',
  warningSoft: '#FFF3DE',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  border: '#D5E8DC',
  borderStrong: '#B9D7C5',
  overlay: 'rgba(15,23,42,0.48)',
  scrim: 'rgba(15,23,42,0.62)',
  modalBackdrop: 'rgba(0,0,0,0.38)',
  glassTint: 'rgba(240,253,244,0.38)',
  glassSurface: 'rgba(255,255,255,0.84)',
  mediaIndicatorInactive: 'rgba(255,255,255,0.55)',
  mediaActionSurface: 'rgba(0,0,0,0.52)',
  chatMediaOverlay: 'rgba(255,255,255,0.28)',
  petCardBadgeSurface: 'rgba(255,255,255,0.92)',
  petCardScrim: 'rgba(13,11,18,0.42)',
  swipeStampSurface: 'rgba(255,255,255,0.94)',
  callBackground: '#08111F',
  callSurface: '#101827',
  callBorder: 'rgba(255,255,255,0.08)',
  callTextMuted: 'rgba(255,255,255,0.68)',
  callControlSoft: 'rgba(255,255,255,0.18)',
  callControlOff: 'rgba(255,255,255,0.08)',
  reelScrim: 'rgba(0,0,0,0.62)',
  reelBackdropFaint: 'rgba(0,0,0,0.08)',
  reelOverlaySoft: 'rgba(0,0,0,0.42)',
  reelOverlayStrong: 'rgba(0,0,0,0.80)',
  reelControlSurface: 'rgba(0,0,0,0.44)',
  white: '#FFFFFF',
  black: '#000000'
} as const;

const darkColors: ThemeColors = {
  background: '#0F172A',
  surface: '#162033',
  surfaceAlt: '#1E293B',
  surfaceStrong: '#27364C',
  text: '#F8FAFC',
  textSoft: '#D7E3EA',
  muted: '#AAB7C7',
  primary: '#FF6B6B',
  primaryDeep: '#F25555',
  primarySoft: '#3A252D',
  onPrimary: '#0F172A',
  onAccent: '#0F172A',
  onSuccess: '#0F172A',
  accent: '#FF6B6B',
  accentSoft: '#3A252D',
  success: '#86E7BC',
  successSoft: '#173B31',
  warning: '#F7C66B',
  warningSoft: '#3A2E18',
  danger: '#FFB4AC',
  dangerSoft: '#45252A',
  border: '#314158',
  borderStrong: '#465A74',
  overlay: 'rgba(2,6,23,0.70)',
  scrim: 'rgba(2,6,23,0.78)',
  modalBackdrop: 'rgba(0,0,0,0.62)',
  glassTint: 'rgba(15,23,42,0.46)',
  glassSurface: 'rgba(22,32,51,0.88)',
  mediaIndicatorInactive: 'rgba(255,255,255,0.55)',
  mediaActionSurface: 'rgba(0,0,0,0.52)',
  chatMediaOverlay: 'rgba(255,255,255,0.28)',
  petCardBadgeSurface: 'rgba(255,255,255,0.92)',
  petCardScrim: 'rgba(13,11,18,0.42)',
  swipeStampSurface: 'rgba(255,255,255,0.94)',
  callBackground: '#08111F',
  callSurface: '#101827',
  callBorder: 'rgba(255,255,255,0.08)',
  callTextMuted: 'rgba(255,255,255,0.68)',
  callControlSoft: 'rgba(255,255,255,0.18)',
  callControlOff: 'rgba(255,255,255,0.08)',
  reelScrim: 'rgba(0,0,0,0.62)',
  reelBackdropFaint: 'rgba(0,0,0,0.08)',
  reelOverlaySoft: 'rgba(0,0,0,0.42)',
  reelOverlayStrong: 'rgba(0,0,0,0.80)',
  reelControlSurface: 'rgba(0,0,0,0.44)',
  white: '#FFFFFF',
  black: '#000000'
};

type ThemeColors = { [K in keyof typeof lightColors]: string };
export type AppTheme = {
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
  shadow: { card: ViewStyle; floating: ViewStyle };
};

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: lightColors,
  spacing,
  radius,
  type,
  shadow: {
    card: { shadowColor: '#0F172A', shadowOpacity: 0.09, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
    floating: { shadowColor: '#0F172A', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 7 }
  }
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: darkColors,
  spacing,
  radius,
  type,
  shadow: {
    card: { shadowColor: '#000000', shadowOpacity: 0.30, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 5 },
    floating: { shadowColor: '#000000', shadowOpacity: 0.42, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }
  }
};

function themeForScheme(scheme: ReturnType<typeof Appearance.getColorScheme> | null | undefined): AppTheme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}

export function getTheme(): AppTheme {
  return themeForScheme(Appearance.getColorScheme());
}

export function useTheme(): AppTheme {
  return themeForScheme(useColorScheme());
}

export function useThemedStyles<T>(factory: (theme: AppTheme) => T): { theme: AppTheme; styles: T } {
  const theme = useTheme();
  const styles = useMemo(() => factory(theme), [factory, theme]);
  return { theme, styles };
}
