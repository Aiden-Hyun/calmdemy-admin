import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading your content...' }: LoadingScreenProps) {
  const { theme, isDark } = useTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dot1Anim = useRef(new Animated.Value(0.3)).current;
  const dot2Anim = useRef(new Animated.Value(0.3)).current;
  const dot3Anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Subtle pulse animation for the logo
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Sequential dots animation
    const animateDots = () => {
      Animated.loop(
        Animated.sequence([
          // Dot 1
          Animated.timing(dot1Anim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot1Anim, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          // Dot 2
          Animated.timing(dot2Anim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot2Anim, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          // Dot 3
          Animated.timing(dot3Anim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot3Anim, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ])
      ).start();
    };
    animateDots();
  }, []);

  const styles = createStyles(theme, isDark);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={isDark 
          ? [theme.colors.background, theme.colors.surface] 
          : [theme.colors.background, `${theme.colors.primary}08`]
        }
        style={StyleSheet.absoluteFill}
      />
      
      <Animated.View 
        style={[
          styles.content,
          { 
            opacity: fadeAnim,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <LinearGradient
            colors={[theme.colors.primaryLight, theme.colors.primary]}
            style={styles.logoGradient}
          >
            <Image
              source={require('../../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </LinearGradient>
        </View>

        {/* App Name */}
        <Text style={styles.appName}>Calmdemy</Text>
        
        {/* Tagline */}
        <Text style={styles.tagline}>Find your inner peace</Text>
      </Animated.View>

      {/* Loading Message */}
      <Animated.View style={[styles.loadingContainer, { opacity: fadeAnim }]}>
        <View style={styles.loadingDots}>
          <Animated.View style={[styles.dot, { opacity: dot1Anim }]} />
          <Animated.View style={[styles.dot, { opacity: dot2Anim }]} />
          <Animated.View style={[styles.dot, { opacity: dot3Anim }]} />
        </View>
        <Text style={styles.loadingText}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
    },
    content: {
      alignItems: 'center',
    },
    logoContainer: {
      marginBottom: 24,
    },
    logoGradient: {
      width: 120,
      height: 120,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      ...theme.shadows.lg,
    },
    logo: {
      width: 80,
      height: 80,
    },
    appName: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 32,
      color: theme.colors.text,
      letterSpacing: -0.5,
      marginBottom: 8,
    },
    tagline: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 16,
      color: theme.colors.textLight,
      marginBottom: 48,
    },
    loadingContainer: {
      position: 'absolute',
      bottom: 120,
      alignItems: 'center',
    },
    loadingDots: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.primary,
    },
    loadingText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
  });
