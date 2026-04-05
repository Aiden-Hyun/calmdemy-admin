import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface MeditationTimerProps {
  progress: number; // 0-100
  timeRemaining: string;
  isActive: boolean;
  isPaused: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  size?: number;
}

const { width } = Dimensions.get('window');
const DEFAULT_SIZE = width * 0.7;

export function MeditationTimer({
  progress,
  timeRemaining,
  isActive,
  isPaused,
  onStart,
  onPause,
  onResume,
  onStop,
  size = DEFAULT_SIZE,
}: MeditationTimerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  
  const strokeWidth = size * 0.06;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const centerX = size / 2;
  const centerY = size / 2;

  return (
    <View style={styles.container}>
      <View style={[styles.timerContainer, { width: size, height: size }]}>
        <Svg width={size} height={size} style={styles.svg}>
          {/* Background circle */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={radius}
            stroke={theme.colors.gray[300]}
            strokeWidth={strokeWidth}
            fill="none"
          />
          
          {/* Progress circle */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={radius}
            stroke={theme.colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${centerX} ${centerY})`}
          />
          
          {/* Decorative inner circles */}
          <Circle
            cx={centerX}
            cy={centerY}
            r={radius * 0.85}
            stroke={theme.colors.gray[200]}
            strokeWidth={1}
            fill="none"
            opacity={0.5}
          />
          
          <Circle
            cx={centerX}
            cy={centerY}
            r={radius * 0.75}
            stroke={theme.colors.gray[200]}
            strokeWidth={1}
            fill="none"
            opacity={0.3}
          />
        </Svg>

        <View style={styles.timerContent}>
          <Text style={styles.timeText}>{timeRemaining}</Text>
          <Text style={styles.statusText}>
            {!isActive ? 'Ready to begin' : isPaused ? 'Paused' : 'Meditating'}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        {!isActive ? (
          <TouchableOpacity style={styles.primaryButton} onPress={onStart}>
            <Ionicons name="play" size={32} color="white" />
            <Text style={styles.primaryButtonText}>Start</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.secondaryButton} onPress={onStop}>
              <Ionicons name="stop" size={24} color={theme.colors.text} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={isPaused ? onResume : onPause}
            >
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={32}
                color="white"
              />
              <Text style={styles.primaryButtonText}>
                {isPaused ? 'Resume' : 'Pause'}
              </Text>
            </TouchableOpacity>
            
            <View style={styles.placeholderButton} />
          </>
        )}
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  timerContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  svg: {
    position: 'absolute',
  },
  timerContent: {
    alignItems: 'center',
  },
  timeText: {
      fontFamily: theme.fonts.display.regular,
    fontSize: 48,
    color: theme.colors.text,
    letterSpacing: 2,
  },
  statusText: {
      fontFamily: theme.fonts.ui.regular,
    fontSize: 18,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.full,
    gap: theme.spacing.sm,
    ...theme.shadows.md,
  },
  primaryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
    color: 'white',
    fontSize: 18,
  },
  secondaryButton: {
    backgroundColor: theme.colors.gray[200],
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.sm,
  },
  placeholderButton: {
    width: 56,
    height: 56,
  },
});
