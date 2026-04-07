import { useEffect, useMemo } from 'react';
import { Stack } from 'expo-router';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useFonts } from '@shared/hooks/useFonts';
import { lightColors } from '@/theme';
import { AppProviders } from '@core/providers/AppProviders';
import { AppErrorBoundary } from '@shared/ui/AppErrorBoundary';
import { initReactGrab } from '@/dev/reactGrab';

// ─── Global JS error handler ───────────────────────────────────────────────
// Intercepts unhandled JS exceptions before they propagate to the native
// crash reporter, so we can see the message + stack in the device console.
console.log('[Startup] _layout module loaded');
try {
  const g = global as any;
  if (g.ErrorUtils) {
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
      console.error(
        `[GlobalError] ${isFatal ? 'FATAL' : 'non-fatal'} — ${error?.message ?? 'unknown'}`
      );
      console.error(`[GlobalError] Stack: ${error?.stack ?? '(no stack)'}`);
      prev?.(error, isFatal);
    });
    console.log('[Startup] Global error handler installed');
  }
} catch (e) {
  console.warn('[Startup] Could not install global error handler:', e);
}

function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <Text style={styles.loadingEmoji}>🌿</Text>
      <Text style={styles.loadingText}>Calmdemy</Text>
      <ActivityIndicator 
        size="small" 
        color={lightColors.primary} 
        style={styles.loadingSpinner}
      />
    </View>
  );
}

function RootNavigator() {
  const { theme } = useTheme();

  const screenOptions = useMemo(() => ({
          headerStyle: {
            backgroundColor: theme.colors.background,
          },
          headerTintColor: theme.colors.text,
          headerTitleStyle: {
            fontFamily: 'DMSans-SemiBold',
          },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: theme.colors.background,
          },
  }), [theme]);

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen
        name="login"
        options={{
          title: 'Welcome',
          headerShown: false,
          animation: 'none',
          presentation: 'fullScreenModal',
        }}
      />
      <Stack.Screen
        name="admin"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  console.log('[Startup] RootLayout render');
  const { fontsLoaded, fontError } = useFonts();

  useEffect(() => {
    console.log('[Startup] RootLayout mounted');
    initReactGrab();
  }, []);

  // Log font errors for debugging
  useEffect(() => {
    if (fontError) {
      console.error('[Startup] Font loading error:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded) {
      console.log('[Startup] Fonts loaded successfully');
    }
  }, [fontsLoaded]);

  // Show loading screen while fonts are loading
  if (!fontsLoaded && !fontError) {
    console.log('[Startup] Waiting for fonts...');
    return <LoadingScreen />;
  }

  console.log('[Startup] Rendering AppErrorBoundary + AppProviders');
  return (
    <AppErrorBoundary>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: lightColors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 28,
    fontWeight: '600',
    color: lightColors.primary,
    letterSpacing: -0.5,
  },
  loadingSpinner: {
    marginTop: 24,
  },
});
