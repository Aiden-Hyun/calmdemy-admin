import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface BreathingGuideProps {
  isActive: boolean;
  isPaused: boolean;
  currentPhase: 'inhale' | 'hold' | 'exhale' | 'pause' | 'idle';
  phaseProgress: number;
  currentCycle: number;
  totalCycles: number;
  instructions: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const { width } = Dimensions.get('window');
const CIRCLE_SIZE = width * 0.7;

export function BreathingGuide({
  isActive,
  isPaused,
  currentPhase,
  phaseProgress,
  currentCycle,
  totalCycles,
  instructions,
  onStart,
  onPause,
  onResume,
  onStop,
}: BreathingGuideProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0.3)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (currentPhase === 'inhale') {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 4000,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.8,
          duration: 4000,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (currentPhase === 'exhale') {
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 4000,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.3,
          duration: 4000,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [currentPhase, scaleAnim, opacityAnim]);

  useEffect(() => {
    if (isActive && !isPaused) {
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 20000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      rotateAnim.setValue(0);
    }
  }, [isActive, isPaused, rotateAnim]);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const getPhaseColor = () => {
    switch (currentPhase) {
      case 'inhale':
        return theme.colors.secondary;
      case 'hold':
        return theme.colors.primary;
      case 'exhale':
        return theme.colors.calm;
      case 'pause':
        return theme.colors.sleep;
      default:
        return theme.colors.gray[400];
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.visualContainer}>
        {/* Outer decorative circles */}
        <Animated.View
          style={[
            styles.outerCircle,
            {
              transform: [{ rotate: rotation }],
            },
          ]}
        >
          <View style={[styles.dot, styles.dotTop]} />
          <View style={[styles.dot, styles.dotRight]} />
          <View style={[styles.dot, styles.dotBottom]} />
          <View style={[styles.dot, styles.dotLeft]} />
        </Animated.View>

        {/* Main breathing circle */}
        <Animated.View
          style={[
            styles.breathingCircle,
            {
              backgroundColor: getPhaseColor(),
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
            },
          ]}
        />

        {/* Inner circle */}
        <View style={styles.innerCircle}>
          <Text style={styles.instructionText}>{instructions}</Text>
          <Text style={styles.cycleText}>
            {currentCycle > 0 ? `${currentCycle} / ${totalCycles}` : 'Ready'}
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualContainer: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xxl,
  },
  outerCircle: {
    position: 'absolute',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  dotTop: {
    top: -4,
    left: '50%',
    marginLeft: -4,
  },
  dotRight: {
    right: -4,
    top: '50%',
    marginTop: -4,
  },
  dotBottom: {
    bottom: -4,
    left: '50%',
    marginLeft: -4,
  },
  dotLeft: {
    left: -4,
    top: '50%',
    marginTop: -4,
  },
  breathingCircle: {
    position: 'absolute',
    width: CIRCLE_SIZE * 0.8,
    height: CIRCLE_SIZE * 0.8,
    borderRadius: (CIRCLE_SIZE * 0.8) / 2,
  },
  innerCircle: {
    width: CIRCLE_SIZE * 0.5,
    height: CIRCLE_SIZE * 0.5,
    borderRadius: (CIRCLE_SIZE * 0.5) / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },
  instructionText: {
      fontFamily: theme.fonts.display.semiBold,
    fontSize: 28,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  cycleText: {
      fontFamily: theme.fonts.ui.regular,
    fontSize: 18,
    color: theme.colors.textLight,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
