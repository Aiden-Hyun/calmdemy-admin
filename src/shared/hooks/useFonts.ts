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

export function useFonts() {
  const [fontsLoaded, fontError] = useExpoFonts({
    // Fraunces - for display/headlines (warm, editorial)
    'Fraunces-Regular': Fraunces_400Regular,
    'Fraunces-Medium': Fraunces_500Medium,
    'Fraunces-SemiBold': Fraunces_600SemiBold,
    'Fraunces-Bold': Fraunces_700Bold,
    
    // DM Sans - for UI/labels (friendly, rounded)
    'DMSans-Regular': DMSans_400Regular,
    'DMSans-Medium': DMSans_500Medium,
    'DMSans-SemiBold': DMSans_600SemiBold,
    'DMSans-Bold': DMSans_700Bold,
    
    // Lora - for body text (readable, calm)
    'Lora-Regular': Lora_400Regular,
    'Lora-Medium': Lora_500Medium,
    'Lora-SemiBold': Lora_600SemiBold,
    'Lora-Bold': Lora_700Bold,
    'Lora-Italic': Lora_400Regular_Italic,
  });

  return { fontsLoaded, fontError };
}

// Font family constants for easy reference
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

