/**
 * ProgressRing Component
 *
 * Architectural Role:
 * Reusable data visualization component for displaying progress as a circular
 * donut/ring chart. Used in stats screens, meditation streaks, and course completion.
 *
 * Design Patterns:
 * - Presentational Component: Pure props-based rendering
 * - SVG-based Graphics: Uses react-native-svg for scalable, crisp rendering
 * - Flexible Configuration: Customizable size, colors, and center content
 *
 * Key Dependencies:
 * - useTheme: For default color scheme
 * - react-native-svg: SVG drawing capabilities
 *
 * Consumed By:
 * - Stats screens (meditation minutes, streaks)
 * - Course progress indicators
 * - Dashboard widgets
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface ProgressRingProps {
  /** Progress value 0-100 */
  progress: number;
  /** Outer diameter in pixels */
  size?: number;
  /** Ring width in pixels */
  strokeWidth?: number;
  /** Fill color for progress arc (overrides theme) */
  color?: string;
  /** Background circle color (overrides theme) */
  backgroundColor?: string;
  /** Text to display in center (e.g., "80%") */
  centerText?: string;
  /** Smaller text below center text (e.g., "Complete") */
  centerSubtext?: string;
}

/**
 * ProgressRing - Circular progress indicator
 *
 * Uses SVG stroke-dasharray to create animated donut charts.
 * The rotation transform starts the ring at the top (12 o'clock position).
 * Optional center content for displaying progress labels.
 */
export function ProgressRing({
  progress,
  size = 100,
  strokeWidth = 8,
  color,
  backgroundColor,
  centerText,
  centerSubtext,
}: ProgressRingProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const ringColor = color || theme.colors.primary;
  const ringBackgroundColor = backgroundColor || theme.colors.gray[300];

  // SVG circle geometry: radius determines ring position from center
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  // strokeDashoffset creates the "missing" portion to show progress
  // 0% = full offset (no fill), 100% = zero offset (full fill)
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Rotate -90° to start ring at top; origin is the center */}
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {/* Background circle provides the unfilled ring visual */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringBackgroundColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle overlays with strokeDasharray for partial fill */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      {/* Centered text overlay for progress labels */}
      {(centerText || centerSubtext) && (
        <View style={styles.centerContent}>
          {centerText && <Text style={styles.centerText}>{centerText}</Text>}
          {centerSubtext && <Text style={styles.centerSubtext}>{centerSubtext}</Text>}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
  container: {
    position: 'relative',
  },
  centerContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerText: {
      fontFamily: theme.fonts.display.bold,
    fontSize: 24,
    color: theme.colors.text,
  },
  centerSubtext: {
      fontFamily: theme.fonts.ui.regular,
    fontSize: 14,
    color: theme.colors.textLight,
    marginTop: 2,
  },
});
