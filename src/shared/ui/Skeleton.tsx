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

export function Skeleton({ 
  width = '100%', 
  height = 20, 
  borderRadius = 8,
  style 
}: SkeletonProps) {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
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

// Preset skeleton shapes
export function SkeletonText({ lines = 1, style }: { lines?: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton 
          key={index}
          height={14}
          width={index === lines - 1 && lines > 1 ? '70%' : '100%'}
          style={{ marginBottom: index < lines - 1 ? theme.spacing.sm : 0 }}
        />
      ))}
    </View>
  );
}

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

export function SkeletonAvatar({ size = 48 }: { size?: number }) {
  return <Skeleton width={size} height={size} borderRadius={size / 2} />;
}

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

