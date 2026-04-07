/**
 * Skeleton Components
 *
 * Architectural Role:
 * Loading state placeholders that show content structure while data is being fetched.
 * Provides a more polished UX than spinners by mimicking the shape of actual content.
 *
 * Design Patterns:
 * - Presentational Components: Zero business logic, purely visual
 * - Composition: Small generic Skeleton composes into preset shapes (Text, Card, etc.)
 * - Animation: Native driver animated opacity for 60fps shimmer effect
 *
 * Key Dependencies:
 * - useTheme: Theme colors
 * - Animated: React Native's native animation system
 *
 * Consumed By:
 * - Any list/feed screens (meditations, courses)
 * - Dashboard screens
 * - Data-heavy views during initial load
 *
 * Design Notes:
 * - Shimmer animation alternates opacity (0.3 -> 0.7 -> 0.3) at 1s cycle
 * - useNativeDriver ensures 60fps on lower-end devices
 * - Preset variants (SkeletonText, SkeletonCard) match common layouts
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { View, Animated, StyleSheet, ViewStyle, DimensionValue } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Skeleton - Base loading placeholder component
 *
 * Renders an animated shimmer effect with configurable dimensions.
 * The shimmer pulsates between 30%-70% opacity to create a "loading" feel.
 */
export function Skeleton({
  width = '100%',
  height = 20,
  borderRadius = 8,
  style
}: SkeletonProps) {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Start infinite shimmer animation on mount
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        // Animate to full opacity (loading state)
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        // Animate back to starting opacity
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  // Map animation value to opacity range
  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={[styles.container, { width, height, borderRadius }, style]}>
      <Animated.View
        style={[
          styles.shimmer,
          { opacity, borderRadius }
        ]}
      />
    </View>
  );
}

/**
 * SkeletonText - Multi-line text placeholder
 *
 * Preset for text content. Last line is 70% width to mimic paragraph text.
 */
export function SkeletonText({ lines = 1, style }: { lines?: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={14}
          // Last line in multi-line text is typically shorter
          width={index === lines - 1 && lines > 1 ? '70%' : '100%'}
          style={{ marginBottom: index < lines - 1 ? theme.spacing.sm : 0 }}
        />
      ))}
    </View>
  );
}

/**
 * SkeletonCard - Content card placeholder
 *
 * Mimics a card layout: image/icon + title + description
 */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme, false), [theme]);

  return (
    <View style={[styles.card, style]}>
      <Skeleton height={120} borderRadius={theme.borderRadius.lg} />
      <View style={styles.cardContent}>
        <Skeleton height={18} width="80%" style={{ marginBottom: theme.spacing.sm }} />
        <Skeleton height={14} width="60%" />
      </View>
    </View>
  );
}

/**
 * SkeletonAvatar - Circular placeholder
 *
 * Used for profile pictures, instructor photos, etc.
 */
export function SkeletonAvatar({ size = 48 }: { size?: number }) {
  return <Skeleton width={size} height={size} borderRadius={size / 2} />;
}

/**
 * SkeletonListItem - List item placeholder
 *
 * Mimics an avatar + content layout: circular image on left, text on right
 */
export function SkeletonListItem({ style }: { style?: ViewStyle }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme, false), [theme]);

  return (
    <View style={[styles.listItem, style]}>
      <Skeleton width={56} height={56} borderRadius={12} />
      <View style={styles.listItemContent}>
        <Skeleton height={16} width="70%" style={{ marginBottom: theme.spacing.xs }} />
        <Skeleton height={12} width="50%" />
      </View>
    </View>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    container: {
      backgroundColor: isDark ? theme.colors.gray[200] : theme.colors.gray[200],
      overflow: 'hidden',
    },
    shimmer: {
      flex: 1,
      backgroundColor: isDark ? theme.colors.gray[300] : theme.colors.gray[100],
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      overflow: 'hidden',
      ...theme.shadows.sm,
    },
    cardContent: {
      padding: theme.spacing.lg,
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      padding: theme.spacing.md,
      ...theme.shadows.sm,
    },
    listItemContent: {
      flex: 1,
      marginLeft: theme.spacing.md,
    },
  });

