/**
 * ============================================================
 * ThemeContext.tsx — Theme Management with System Preference
 *                     (Observer + Adapter Pattern)
 * ============================================================
 *
 * Architectural Role:
 *   Manages the app's visual theme (light/dark) with three strategies:
 *   1. 'light' — force light mode
 *   2. 'dark' — force dark mode
 *   3. 'system' — follow the device's system color scheme preference
 *
 *   This is a classic Provider Pattern with an added twist: we persist the
 *   user's preference to AsyncStorage and respect system changes on mount.
 *
 * Design Patterns:
 *   - Provider Pattern: exposes ThemeContextValue via useTheme
 *   - Adapter Pattern: useColorScheme (React Native API) is wrapped; consumers
 *     never call it directly, only useTheme
 *   - Observer Pattern: subscribes to system color scheme changes
 *   - Strategy Pattern: Three theme acquisition strategies (light, dark, system)
 *     selected via ThemeMode discriminant
 *
 * Key Dependencies:
 *   - react-native.useColorScheme (system dark/light preference)
 *   - AsyncStorage (persistence across app restarts)
 *   - Theme creation library (@/theme)
 *
 * Consumed By:
 *   - StyleSheet components (via useTheme().theme)
 *   - Settings screen (to allow user theme preference selection)
 * ============================================================
 */

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme, createTheme, lightColors, darkColors } from '@/theme';

// Theme mode types — discriminant union for strategy selection
export type ThemeMode = 'light' | 'dark' | 'system';

// Context value interface
interface ThemeContextValue {
  theme: Theme;
  themeMode: ThemeMode;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
}

// Storage key — namespaced to avoid collisions in AsyncStorage
const THEME_MODE_KEY = '@calmdemy_theme_mode';

// Create context
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Provider props
interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme Provider component — manages theme state and system preference subscription.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  // Subscribe to system color scheme changes via React Native hook
  const systemColorScheme = useColorScheme();

  // Current theme mode (light/dark/system)
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  // Flag: has AsyncStorage persistence loaded yet? Prevent rendering before load.
  const [isLoaded, setIsLoaded] = useState(false);

  /**
   * Effect 1: Load saved theme preference from AsyncStorage on mount.
   *
   * We load the preference on mount and set isLoaded to true when done.
   * This prevents rendering until we know the user's saved preference,
   * avoiding a flash of default (system) theme that might not match the saved setting.
   */
  useEffect(() => {
    loadThemeMode();
  }, []);

  /**
   * Helper: load theme mode from AsyncStorage.
   *
   * This is extracted to avoid creating the function inside the useEffect
   * (which would cause it to be recreated every render). We call it from the
   * effect's initial run. Type guard ensures savedMode is a valid ThemeMode.
   */
  const loadThemeMode = async () => {
    try {
      const savedMode = await AsyncStorage.getItem(THEME_MODE_KEY);
      if (savedMode && (savedMode === 'light' || savedMode === 'dark' || savedMode === 'system')) {
        setThemeModeState(savedMode as ThemeMode);
      }
    } catch (error) {
      console.error('Failed to load theme mode:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  /**
   * Action: save theme preference to AsyncStorage and update state.
   *
   * This is an async function that persists to storage before updating state.
   * The try/catch ensures we update state even if persistence fails — this
   * follows the "optimistic update" pattern: the app responds immediately
   * even if the persistence operation fails in the background.
   */
  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_MODE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error('Failed to save theme mode:', error);
      // Still update state even if save fails — don't block UI for persistence issues
      setThemeModeState(mode);
    }
  };

  /**
   * Derived state: determine if dark mode is currently active.
   *
   * This uses the Strategy pattern via the themeMode discriminant:
   * - 'system' → delegate to systemColorScheme (the device's preference)
   * - 'dark' → always dark
   * - 'light' → always light
   *
   * MEMOIZED: computed fresh whenever themeMode or systemColorScheme changes.
   * If system color scheme changes (e.g., user changes OS setting), React Native's
   * useColorScheme notifies subscribers and isDark is recomputed.
   */
  const isDark = useMemo(() => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  /**
   * Derived state: the full Theme object (colors, typography, etc.).
   *
   * This is expensive to compute (createTheme likely does work), so we memoize
   * it. Recomputed only when isDark changes. Changes to isDark propagate here.
   */
  const theme = useMemo(() => {
    const colors = isDark ? darkColors : lightColors;
    return createTheme(colors, isDark);
  }, [isDark]);

  /**
   * Context value: bundle state and actions for the hook.
   *
   * MEMOIZED: prevents unnecessary re-renders of consuming components.
   * Depends on theme, themeMode, and isDark. If any change, consumers re-render.
   */
  const contextValue = useMemo<ThemeContextValue>(() => ({
    theme,
    themeMode,
    isDark,
    setThemeMode,
  }), [theme, themeMode, isDark]);

  /**
   * Gatekeeper: don't render until theme preference is loaded.
   *
   * This prevents a "flash" of incorrect theme on cold startup. Without this,
   * the app would render briefly in the default (system) theme, then switch
   * when AsyncStorage loads. By returning null until isLoaded is true, we
   * ensure children see the correct theme from the first render.
   */
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Custom hook: useTheme — access the current theme and theme preference.
 *
 * @throws Error if used outside a ThemeProvider
 * @returns ThemeContextValue with theme object, mode, isDark flag, and setter
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

