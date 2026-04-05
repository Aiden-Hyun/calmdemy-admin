// Color palette types
export interface ThemeColors {
  // Primary palette - Sage Green
  primary: string;
  primaryLight: string;
  primaryDark: string;
  
  // Secondary - Warm Terracotta
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  
  // Accent - Dusty Rose
  accent: string;
  accentLight: string;
  accentDark: string;
  
  // Background colors
  background: string;
  surface: string;
  surfaceElevated: string;
  
  // Text colors
  text: string;
  textLight: string;
  textMuted: string;
  textSecondary: string;
  textOnPrimary: string;
  textOnDark: string;
  border: string;
  
  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;
  
  // Neutral colors - Warm grays
  gray: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  };
  
  // Special colors for meditation moods
  calm: string;
  focus: string;
  relax: string;
  sleep: string;
  energy: string;
  
  // Sleep mode colors (always dark)
  sleepBackground: string;
  sleepSurface: string;
  sleepAccent: string;
  sleepText: string;
  sleepTextMuted: string;
}

// Light mode colors
export const lightColors: ThemeColors = {
    // Primary palette - Sage Green
    primary: '#8B9F82',
    primaryLight: '#A8B89F',
    primaryDark: '#6B7F65',
    
    // Secondary - Warm Terracotta
    secondary: '#C4A77D',
    secondaryLight: '#D4BFA0',
    secondaryDark: '#A68B5B',
    
    // Accent - Dusty Rose
    accent: '#D4A5A5',
    accentLight: '#E4C0C0',
    accentDark: '#B88888',
    
    // Background colors - Warm tones
    background: '#FAF8F5',
    surface: '#FFFEF9',
    surfaceElevated: '#FFFFFF',
    
    // Text colors - Warm charcoal
    text: '#3D3A38',
    textLight: '#8B8685',
    textMuted: '#A8A5A3',
    textSecondary: '#A8A5A3',
    textOnPrimary: '#FFFFFF',
    textOnDark: '#F5F0E8',
    border: '#EBE8E4',
    
    // Status colors - Muted versions
    success: '#7BA37B',
    warning: '#D4B896',
    error: '#C88B8B',
    info: '#8BA5B8',
    
    // Neutral colors - Warm grays
    gray: {
      50: '#FDFCFA',
      100: '#F5F3F0',
      200: '#EBE8E4',
      300: '#D9D5D0',
      400: '#B8B4AE',
      500: '#8B8685',
      600: '#5C5856',
      700: '#3D3A38',
      800: '#2A2826',
      900: '#1A1917',
    },
    
    // Special colors for meditation moods
  calm: '#B4C4B0',
  focus: '#8B9F82',
  relax: '#C4A77D',
  sleep: '#1A1D29',
  energy: '#D4C4A8',
    
  // Sleep mode colors (always dark)
    sleepBackground: '#1A1D29',
    sleepSurface: '#252A3A',
    sleepAccent: '#C9B896',
    sleepText: '#F5F0E8',
    sleepTextMuted: '#8B8A99',
};

// Dark mode colors
export const darkColors: ThemeColors = {
  // Primary palette - Sage Green (slightly brighter for dark mode)
  primary: '#9DB094',
  primaryLight: '#B5C5AC',
  primaryDark: '#7A8E71',
  
  // Secondary - Warm Terracotta
  secondary: '#D4B78D',
  secondaryLight: '#E4CFB0',
  secondaryDark: '#B69B6B',
  
  // Accent - Dusty Rose
  accent: '#E4B5B5',
  accentLight: '#F4D0D0',
  accentDark: '#C89898',
  
  // Background colors - Deep warm tones
  background: '#1A1917',
  surface: '#252321',
  surfaceElevated: '#2F2C2A',
  
  // Text colors - Light warm tones
  text: '#F5F0E8',
  textLight: '#B8B4AE',
  textMuted: '#8B8685',
  textSecondary: '#8B8685',
  textOnPrimary: '#1A1917',
  textOnDark: '#F5F0E8',
  border: '#3D3A38',
  
  // Status colors - Slightly brighter for dark mode
  success: '#8BB38B',
  warning: '#E4C8A6',
  error: '#D89B9B',
  info: '#9BB5C8',
  
  // Neutral colors - Inverted warm grays
  gray: {
    50: '#1A1917',
    100: '#252321',
    200: '#2F2C2A',
    300: '#3D3A38',
    400: '#5C5856',
    500: '#8B8685',
    600: '#A8A5A3',
    700: '#D9D5D0',
    800: '#EBE8E4',
    900: '#FDFCFA',
  },
  
  // Special colors for meditation moods (slightly brighter)
  calm: '#C4D4C0',
  focus: '#9DB094',
  relax: '#D4B78D',
  sleep: '#252A3A',
  energy: '#E4D4B8',
  
  // Sleep mode colors (same as light - always dark)
  sleepBackground: '#1A1D29',
  sleepSurface: '#252A3A',
  sleepAccent: '#C9B896',
  sleepText: '#F5F0E8',
  sleepTextMuted: '#8B8A99',
};

// Shared non-color theme values
const sharedTheme = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
  },
  
  // Softer, more organic border radii
  borderRadius: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 20,
    xl: 28,
    xxl: 36,
    full: 9999,
  },
  
  // Font families
  fonts: {
    // Display/Headlines - Fraunces (warm, editorial serif)
    display: {
      regular: 'Fraunces-Regular',
      medium: 'Fraunces-Medium',
      semiBold: 'Fraunces-SemiBold',
      bold: 'Fraunces-Bold',
    },
    // Body text - Lora (readable serif)
    body: {
      regular: 'Lora-Regular',
      medium: 'Lora-Medium',
      semiBold: 'Lora-SemiBold',
      bold: 'Lora-Bold',
      italic: 'Lora-Italic',
    },
    // UI/Labels - DM Sans (friendly sans-serif)
    ui: {
      regular: 'DMSans-Regular',
      medium: 'DMSans-Medium',
      semiBold: 'DMSans-SemiBold',
      bold: 'DMSans-Bold',
    },
  },
  
  typography: {
    // Display - for hero text (Fraunces)
    display: {
      fontFamily: 'Fraunces-Bold',
      fontSize: 36,
      lineHeight: 44,
      letterSpacing: -0.5,
    },
    h1: {
      fontFamily: 'Fraunces-SemiBold',
      fontSize: 28,
      lineHeight: 36,
      letterSpacing: -0.3,
    },
    h2: {
      fontFamily: 'Fraunces-SemiBold',
      fontSize: 24,
      lineHeight: 32,
      letterSpacing: -0.2,
    },
    h3: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 20,
      lineHeight: 28,
    },
    h4: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 17,
      lineHeight: 24,
    },
    body: {
      fontFamily: 'Lora-Regular',
      fontSize: 16,
      lineHeight: 24,
    },
    bodyMedium: {
      fontFamily: 'Lora-Medium',
      fontSize: 16,
      lineHeight: 24,
    },
    bodySmall: {
      fontFamily: 'DMSans-Regular',
      fontSize: 14,
      lineHeight: 20,
    },
    caption: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      lineHeight: 16,
    },
    label: {
      fontFamily: 'DMSans-Medium',
      fontSize: 13,
      lineHeight: 18,
      letterSpacing: 0.3,
    },
    // Quote/intention text (italic serif)
    quote: {
      fontFamily: 'Lora-Italic',
      fontSize: 18,
      lineHeight: 28,
    },
    // Button text
    button: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 16,
      lineHeight: 24,
    },
  },
};
  
// Function to create shadows based on color scheme
const createShadows = (isDark: boolean) => ({
    sm: {
    shadowColor: isDark ? '#000000' : '#3D3A38',
      shadowOffset: {
        width: 0,
        height: 2,
      },
    shadowOpacity: isDark ? 0.3 : 0.06,
      shadowRadius: 4,
      elevation: 1,
    },
    md: {
    shadowColor: isDark ? '#000000' : '#3D3A38',
      shadowOffset: {
        width: 0,
        height: 4,
      },
    shadowOpacity: isDark ? 0.4 : 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    lg: {
    shadowColor: isDark ? '#000000' : '#3D3A38',
      shadowOffset: {
        width: 0,
        height: 8,
      },
    shadowOpacity: isDark ? 0.5 : 0.1,
      shadowRadius: 16,
      elevation: 5,
    },
    glow: {
    shadowColor: isDark ? '#9DB094' : '#8B9F82',
      shadowOffset: {
        width: 0,
        height: 0,
      },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 0,
    },
});
  
// Function to create gradients based on color scheme
const createGradients = (isDark: boolean) => ({
  warmSunrise: isDark ? ['#252321', '#1A1917'] : ['#FAF8F5', '#F5EDE3'],
  sage: isDark ? ['#7A8E71', '#6B7F65'] : ['#A8B89F', '#8B9F82'],
  terracotta: isDark ? ['#B69B6B', '#A68B5B'] : ['#D4BFA0', '#C4A77D'],
  rose: isDark ? ['#C89898', '#B88888'] : ['#E4C0C0', '#D4A5A5'],
  sleepyNight: ['#1A1D29', '#252A3A'] as [string, string],
  dreamyPurple: ['#2A2D3E', '#1A1D29'] as [string, string],
  goldenHour: isDark ? ['#B69B6B', '#A68B5B'] : ['#D4C4A8', '#C4A77D'],
});

// Create a full theme object from colors
export function createTheme(colors: ThemeColors, isDark: boolean) {
  return {
    colors,
    ...sharedTheme,
    shadows: createShadows(isDark),
    gradients: createGradients(isDark),
};
}

// Theme type
export type Theme = ReturnType<typeof createTheme>;

// Default light theme (for backwards compatibility during migration)
export const theme = createTheme(lightColors, false);

// Helper for creating consistent card styles (using default theme for backwards compatibility)
export const cardStyle = {
  backgroundColor: theme.colors.surface,
  borderRadius: theme.borderRadius.xl,
  padding: theme.spacing.lg,
  ...theme.shadows.sm,
};

// Helper for sleep mode card styles
export const sleepCardStyle = {
  backgroundColor: theme.colors.sleepSurface,
  borderRadius: theme.borderRadius.xl,
  padding: theme.spacing.lg,
};
