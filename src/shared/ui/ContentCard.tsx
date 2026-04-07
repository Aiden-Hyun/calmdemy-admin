/**
 * ContentCard.tsx
 *
 * Architectural Role:
 * Reusable card component for displaying meditation, course, or content items across the app.
 * Supports rich metadata (thumbnails, badges, lock icons) and adapts styling based on context
 * (sleep page vs. regular pages, light vs. dark mode). Used in grids and carousels.
 *
 * Design Patterns:
 * - Conditional Theming: Switches between sleep-specific and regular theme palettes based on
 *   the darkMode prop. This allows the same component to work on visually distinct pages.
 * - Subscription-Aware Rendering: Shows lock badge only when content is premium and user
 *   lacks subscription. Coordinated via useSubscription context.
 * - Color Injection: Accepts fallbackColor (theme color or custom) and applies it as tint
 *   to background and accent elements. Allows dynamic color-coding by content category.
 *
 * Key Dependencies:
 * - AnimatedPressable: Provides tap feedback animation
 * - SubscriptionContext: Determines if lock badge should show
 * - ThemeContext: Access to sleep vs. regular color palettes
 *
 * Consumed By:
 * - Content discovery pages (meditations, courses)
 * - Sleep/music library pages
 * - Featured content carousels
 */

import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useSubscription } from "@core/providers/contexts/SubscriptionContext";
import { Theme } from "@/theme";

/**
 * Helper to convert hex color (e.g., "#FF6B6B") to rgba format with custom opacity.
 * Used to apply subtle color tints to card backgrounds and icon containers.
 * Example: "#FF6B6B" with 0.07 opacity → "rgba(255, 107, 107, 0.07)" (very subtle tint)
 */
// Helper to convert hex color to rgba with opacity
function hexToRgba(hex: string, opacity: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export interface ContentCardProps {
  title: string;
  thumbnailUrl?: string;
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
  fallbackColor?: string;
  meta?: string; // e.g., "10 min" or "3 tracks"
  code?: string; // e.g., "CBT101", "ACT101" - displayed as badge
  subtitle?: string; // e.g., "Module 1 Lesson" - displayed below code badge
  onPress: () => void;
  // For sleep page only (uses sleep-specific colors)
  darkMode?: boolean;
  // Content access from schema: true means free, false means subscription required.
  isFree?: boolean;
}

export function ContentCard({
  title,
  thumbnailUrl,
  fallbackIcon = "musical-notes",
  fallbackColor,
  meta,
  code,
  subtitle,
  onPress,
  darkMode = false,
  isFree = true,
}: ContentCardProps) {
  const { theme, isDark } = useTheme();
  const { isPremium: hasSubscription } = useSubscription();

  /**
   * Mode detection: The darkMode prop is used for the Sleep page specifically,
   * which has a distinct visual identity. isDark is the system-wide dark mode.
   * This allows the Sleep page to use specialized colors even in light mode,
   * or use regular colors if the rest of the app is light but sleep page is dark.
   */
  // darkMode prop = Sleep page (always use sleep colors)
  // isDark = system/app dark mode (use regular dark colors)
  const isSleepPage = darkMode;
  const isRegularDark = isDark && !darkMode;

  /**
   * Subscription-aware lock icon rendering. Shows a lock badge when:
   * - Content is marked as premium (isFree === false)
   * - AND user doesn't have an active subscription
   *
   * This provides clear visual feedback that the content is behind a paywall.
   */
  // Show lock only when content is not free and user doesn't have subscription
  const showLock = isFree === false && !hasSubscription;

  const styles = React.useMemo(
    () => createStyles(theme, isSleepPage, isRegularDark),
    [theme, isSleepPage, isRegularDark]
  );

  const accentColor = fallbackColor || theme.colors.primary;

  /**
   * Card background color strategy based on context:
   * 1. Sleep page: Use dedicated sleep surface color for visual consistency
   * 2. Regular dark mode: Use standard surface color
   * 3. Light mode: Apply subtle tint of the accent color (7% opacity) to tie the card
   *    to its category color without being overwhelming
   *
   * This creates visual hierarchy: sleep page > dark mode cards have more contrast,
   * light mode cards are subtly color-coded by category.
   */
  // Card background with subtle color tint
  let cardBgColor: string;
  if (isSleepPage) {
    // Sleep page: use sleep surface color
    cardBgColor = theme.colors.sleepSurface;
  } else if (isRegularDark) {
    // Other pages in dark mode: use regular surface with subtle tint
    cardBgColor = theme.colors.surface;
  } else {
    // Light mode: subtle accent color tint (7% opacity)
    cardBgColor = hexToRgba(accentColor, 0.07);
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      style={[styles.card, { backgroundColor: cardBgColor }]}
    >
      <View style={styles.thumbnailContainer}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} />
        ) : (
          <View
            style={[
              styles.thumbnail,
              styles.thumbnailPlaceholder,
              { backgroundColor: hexToRgba(accentColor, 0.125) },
            ]}
          >
            <Ionicons name={fallbackIcon} size={40} color={accentColor} />
          </View>
        )}
        {showLock && (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={12} color="#fff" />
          </View>
        )}
      </View>
      {code && (
        <View style={[styles.codeBadge, { backgroundColor: hexToRgba(accentColor, 0.15) }]}>
          <Text style={[styles.codeText, { color: accentColor }]}>{code}</Text>
        </View>
      )}
      {subtitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
      <Text style={styles.title}>
        {title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {meta || " "}
      </Text>
    </AnimatedPressable>
  );
}

// 50% larger than previous (140 → 210)
const CARD_WIDTH = 190;
const THUMBNAIL_HEIGHT = 130;

const createStyles = (
  theme: Theme,
  isSleepPage: boolean,
  isRegularDark: boolean
) =>
  StyleSheet.create({
    card: {
      width: CARD_WIDTH,
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.md,
      alignItems: "center",
      flexShrink: 0,
      ...theme.shadows.sm,
    },
    thumbnailContainer: {
      width: "100%",
      height: THUMBNAIL_HEIGHT,
      borderRadius: theme.borderRadius.lg,
      overflow: "hidden",
      position: "relative",
    },
    lockBadge: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    thumbnail: {
      width: "100%",
      height: "100%",
      resizeMode: "cover",
    },
    thumbnailPlaceholder: {
      alignItems: "center",
      justifyContent: "center",
    },
    codeBadge: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 3,
      borderRadius: theme.borderRadius.full,
      marginTop: theme.spacing.sm,
    },
    codeText: {
      fontFamily: theme.fonts.ui.bold,
      fontSize: 10,
      letterSpacing: 0.5,
    },
    subtitle: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 11,
      color: isSleepPage
        ? theme.colors.sleepTextMuted
        : isRegularDark
        ? theme.colors.textLight
        : theme.colors.textMuted,
      textAlign: "center",
      marginTop: 2,
    },
    title: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      lineHeight: 20,
      color: isSleepPage
        ? theme.colors.sleepText
        : isRegularDark
        ? theme.colors.text
        : theme.colors.text,
      textAlign: "center",
      marginTop: theme.spacing.xs,
    },
    meta: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      color: isSleepPage
        ? theme.colors.sleepTextMuted
        : isRegularDark
        ? theme.colors.textLight
        : theme.colors.textLight,
      textAlign: "center",
      marginTop: 4,
    },
  });
