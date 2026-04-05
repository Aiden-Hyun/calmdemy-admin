import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface ProgressRingProps {
  progress: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  backgroundColor?: string;
  centerText?: string;
  centerSubtext?: string;
}

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
  
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {/* Background circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringBackgroundColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
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
