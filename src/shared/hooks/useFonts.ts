/**
 * Font Loading Hook - Design System Typography
 *
 * ARCHITECTURAL ROLE:
 * Low-level utility hook that asynchronously loads custom Google Fonts via expo-font.
 * Typically called once in root provider (RootProvider) on app startup and blocks
 * screen rendering until fonts loaded.
 *
 * DESIGN PATTERNS:
 * - Async Resource Loading: expo-font.useFonts handles async font fetching
 * - Design System Export: fonts object exported alongside hook for type-safe font references
 * - Centralized Font Registry: Single source of truth for all app typography
 *
 * FONT CHOICES:
 * - Fraunces (display): Editorial serif for headlines, warm and elegant
 * - Lora (body): Readable serif for paragraph text, calm and approachable
 * - DM Sans (UI): Friendly sans-serif for buttons, labels, and interface text
 *
 * KEY DEPENDENCIES:
 * - expo-font: Native font loading
 * - @expo-google-fonts: Google Fonts package for Expo
 *
 * CONSUMERS:
 * - RootProvider: Calls once on app startup, waits for fontsLoaded
 * - All screens/components: Reference fonts object for consistent typography
 *
 * USAGE PATTERN:
 * In RootProvider:
 *   const { fontsLoaded, fontError } = useFonts();
 *   if (!fontsLoaded && !fontError) return <SplashScreen />;
 *   if (fontError) return <ErrorScreen />;
 *   // Safe to render - fonts loaded
 */

import { useFonts as useExpoFonts } from 'expo-font';
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
  Lora_400Regular_Italic,
} from '@expo-google-fonts/lora';

/**
 * useFonts Hook
 *
 * Load custom fonts asynchronously. Should be called in root provider once per app session.
 * Blocks UI rendering (via SplashScreen) until fonts fully loaded.
 *
 * @returns Object with fontsLoaded (boolean) and fontError (Error | null)
 *
 * BEHAVIOR:
 * - First call: Starts async download from Google Fonts CDN, returns fontsLoaded=false
 * - Fonts cached locally after first load
 * - Subsequent app opens use cache (instant load)
 * - Network failures tracked in fontError
 */
export function useFonts() {
  /**
   * EXPO-FONT HOOK
   * Map font display names (used in Text styles) to Google Font imports.
   * Keys like 'Fraunces-Bold' are used in React Native style sheets:
   *   <Text style={{ fontFamily: 'Fraunces-Bold' }}>Headline</Text>
   *
   * WEIGHT COVERAGE:
   * Each font family imports 4 weights for proper bold/medium/regular hierarchy.
   * Lora also includes italic variant for emphasis in body text.
   *
   * EXPO BEHAVIOR:
   * useExpoFonts returns immediately with fontsLoaded=false, then updates state
   * when download completes. Parent component (RootProvider) listens and shows
   * splash screen while loading.
   */
  const [fontsLoaded, fontError] = useExpoFonts({
    // Fraunces - Display/Headlines (warm, editorial serif)
    'Fraunces-Regular': Fraunces_400Regular,
    'Fraunces-Medium': Fraunces_500Medium,
    'Fraunces-SemiBold': Fraunces_600SemiBold,
    'Fraunces-Bold': Fraunces_700Bold,

    // DM Sans - UI/Labels (friendly, rounded sans-serif)
    'DMSans-Regular': DMSans_400Regular,
    'DMSans-Medium': DMSans_500Medium,
    'DMSans-SemiBold': DMSans_600SemiBold,
    'DMSans-Bold': DMSans_700Bold,

    // Lora - Body text (readable, calm serif)
    'Lora-Regular': Lora_400Regular,
    'Lora-Medium': Lora_500Medium,
    'Lora-SemiBold': Lora_600SemiBold,
    'Lora-Bold': Lora_700Bold,
    'Lora-Italic': Lora_400Regular_Italic,
  });

  return { fontsLoaded, fontError };
}

/**
 * FONT CONSTANTS - Design System Typography Registry
 *
 * Exported object providing type-safe font family references.
 * Use in component styles instead of magic strings:
 *
 *   GOOD:   fontFamily: fonts.display.bold
 *   BAD:    fontFamily: 'Fraunces-Bold'  (not refactoring-safe, prone to typos)
 *
 * ORGANIZATION:
 * - display: Headlines/page titles (strong, editorial presence)
 * - body: Paragraph text, descriptions (readable, calm)
 * - ui: Buttons, labels, metadata (compact, friendly)
 *
 * USAGE PATTERN:
 * In component stylesheet:
 *   import { fonts } from '@shared/hooks/useFonts';
 *
 *   const styles = StyleSheet.create({
 *     headline: { fontFamily: fonts.display.bold, fontSize: 28 },
 *     description: { fontFamily: fonts.body.regular, fontSize: 16 },
 *     button: { fontFamily: fonts.ui.semiBold, fontSize: 14 },
 *   });
 */
export const fonts = {
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
};

