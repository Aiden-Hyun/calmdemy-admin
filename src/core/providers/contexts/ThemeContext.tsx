import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme, createTheme, lightColors, darkColors } from '@/theme';

// Theme mode types
export type ThemeMode = 'light' | 'dark' | 'system';

// Context value interface
interface ThemeContextValue {
  theme: Theme;
  themeMode: ThemeMode;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
}

// Storage key
const THEME_MODE_KEY = '@calmdemy_theme_mode';

// Create context
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Provider props
interface ThemeProviderProps {
  children: ReactNode;
}

// Theme Provider component
export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved theme preference on mount
  useEffect(() => {
    loadThemeMode();
  }, []);

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

  // Save and set theme mode
  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_MODE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error('Failed to save theme mode:', error);
      // Still update state even if save fails
      setThemeModeState(mode);
    }
  };

  // Determine if dark mode should be active
  const isDark = useMemo(() => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  // Create theme object based on dark mode state
  const theme = useMemo(() => {
    const colors = isDark ? darkColors : lightColors;
    return createTheme(colors, isDark);
  }, [isDark]);

  // Context value
  const contextValue = useMemo<ThemeContextValue>(() => ({
    theme,
    themeMode,
    isDark,
    setThemeMode,
  }), [theme, themeMode, isDark]);

  // Don't render until theme preference is loaded to avoid flash
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

// Custom hook to use theme
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

