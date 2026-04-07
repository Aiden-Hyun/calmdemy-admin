/**
 * StatsCard Component
 *
 * Architectural Role:
 * Data display card for showing single metrics (meditation minutes, streaks, etc.).
 * Used in dashboard and stats screens to present key user metrics.
 *
 * Design Patterns:
 * - Presentational Component: Pure props-based rendering
 * - Card Pattern: Encapsulated stat with icon + label + value
 * - Customizable Color: Icon and value color can be overridden
 *
 * Key Dependencies:
 * - useTheme: Default color scheme
 * - Ionicons: Icon library
 *
 * Consumed By:
 * - Stats/Dashboard screens
 * - User profile metrics
 * - Progress tracking displays
 *
 * Design Notes:
 * - Icon background uses 12.5% opacity of icon color (e.g., `${color}20`)
 * - Layout: icon (top) -> label (middle) -> value + unit (bottom)
 * - Minimum height ensures consistent card size in grids
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface StatsCardProps {
  /** Ionicons icon name */
  icon: keyof typeof Ionicons.glyphMap;
  /** Stat label (e.g., "Meditation Minutes") */
  label: string;
  /** The numeric or string value */
  value: string | number;
  /** Optional unit string (e.g., "min", "days") */
  unit?: string;
  /** Custom icon/value color (defaults to theme primary) */
  color?: string;
}

/**
 * StatsCard - Single metric display card
 *
 * Compact card showing an icon, label, and metric value.
 * Commonly used in 2-column grids on stats screens.
 */
export function StatsCard({ icon, label, value, unit, color }: StatsCardProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const iconColor = color || theme.colors.primary;

  return (
    <View style={styles.container}>
      {/* Icon with tinted background */}
      <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
        <Ionicons name={icon} size={24} color={iconColor} />
      </View>

      {/* Stat label */}
      <Text style={styles.label}>{label}</Text>

      {/* Value + optional unit */}
      <View style={styles.valueContainer}>
        <Text style={[styles.value, { color: iconColor }]}>{value}</Text>
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    alignItems: 'center',
    minHeight: 120,
    ...theme.shadows.sm,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  label: {
      fontFamily: theme.fonts.ui.regular,
    fontSize: 14,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.xs,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  value: {
      fontFamily: theme.fonts.display.bold,
    fontSize: 24,
  },
  unit: {
      fontFamily: theme.fonts.ui.regular,
    fontSize: 14,
    color: theme.colors.textLight,
  },
});
