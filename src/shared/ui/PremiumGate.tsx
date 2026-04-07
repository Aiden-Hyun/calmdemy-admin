/**
 * Premium Content Gate Component
 *
 * Architectural Role:
 * Conditional rendering wrapper that enforces subscription requirements for premium
 * features. Provides three modes: free access, lock overlay, or lock badge. Bridges
 * the subscription context with content presentation.
 *
 * Design Patterns:
 * - Gating Pattern: Conditional rendering based on subscription status
 * - Composition: Composes PaywallModal for monetization flow
 * - Hook-based State: usePremiumAccess encapsulates access control logic
 *
 * Key Dependencies:
 * - useSubscription: subscription/premium status
 * - usePremiumAccess: Hook that checks if content access is granted
 * - useTheme: Theme styling
 *
 * Consumed By:
 * - Any premium content containers throughout the app (meditation cards, courses, etc.)
 * - Used to gate features like offline downloads, full course access
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSubscription, usePremiumAccess } from "@core/providers/contexts/SubscriptionContext";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { PaywallModal } from "./PaywallModal";
import { Theme } from "@/theme";

interface PremiumGateProps {
  children: React.ReactNode;
  /** Whether the wrapped content is premium (if false, always shows children) */
  isPremium?: boolean;
  /** Show inline lock badge instead of blocking content entirely */
  showBadgeOnly?: boolean;
  /** Callback when user successfully accesses premium content */
  onAccessGranted?: () => void;
  style?: ViewStyle;
}

/**
 * PremiumGate - Flexible content access control wrapper
 *
 * Three rendering modes:
 * 1. Free Content: Non-premium or user has access -> renders children directly
 * 2. Badge Mode: Shows children with a lock badge overlay (use for card thumbnails)
 * 3. Lock Overlay: Full blocking gradient overlay (use for full-screen content)
 *
 * This component orchestrates the paywall presentation when needed.
 */
export function PremiumGate({
  children,
  isPremium = false,
  showBadgeOnly = false,
  onAccessGranted,
  style,
}: PremiumGateProps) {
  const { canAccess, isLoading } = usePremiumAccess(isPremium);
  const [showPaywall, setShowPaywall] = useState(false);

  // Free content or user has access -> render children as-is
  if (!isPremium || canAccess) {
    return <>{children}</>;
  }

  // Badge mode: overlay a small lock badge on the content for subtle premium indication
  if (showBadgeOnly) {
    return (
      <View style={style}>
        {children}
        <PremiumBadge onPress={() => setShowPaywall(true)} />
        <PaywallModal
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
          onSuccess={onAccessGranted}
        />
      </View>
    );
  }

  // Default: full blocking overlay with unlock call-to-action
  return (
    <View style={style}>
      <PremiumLockOverlay onUnlock={() => setShowPaywall(true)} />
      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSuccess={onAccessGranted}
      />
    </View>
  );
}

/**
 * PremiumBadge - Small lock indicator for card-style layouts
 *
 * Displays a lock icon badge in the top-right corner of content.
 * Hidden for premium users (doesn't render). Two size options for flexibility.
 */
interface PremiumBadgeProps {
  onPress?: () => void;
  size?: "small" | "medium";
}

export function PremiumBadge({ onPress, size = "small" }: PremiumBadgeProps) {
  const { theme } = useTheme();
  const { isPremium } = useSubscription();

  // Premium users don't see the badge at all
  if (isPremium) return null;

  const iconSize = size === "small" ? 10 : 14;
  const padding = size === "small" ? 4 : 6;

  return (
    <TouchableOpacity
      style={[
        styles.badge,
        {
          padding,
          backgroundColor: theme.colors.secondary,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name="lock-closed" size={iconSize} color="#fff" />
      {size === "medium" && (
        <Text style={[styles.badgeText, { marginLeft: 4 }]}>Premium</Text>
      )}
    </TouchableOpacity>
  );
}

/**
 * PremiumLockOverlay - Full-screen blocking gradient overlay
 *
 * Used for prominent premium content (full meditations, courses) that should
 * completely block content until subscribed. Uses gradient background to
 * maintain visual consistency with the app's design system.
 */
interface PremiumLockOverlayProps {
  onUnlock: () => void;
}

function PremiumLockOverlay({ onUnlock }: PremiumLockOverlayProps) {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createOverlayStyles(theme, isDark), [theme, isDark]);

  return (
    <LinearGradient
      colors={[`${theme.colors.primary}15`, `${theme.colors.primary}30`]}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="lock-closed" size={32} color={theme.colors.primary} />
        </View>
        <Text style={styles.title}>Premium Content</Text>
        <Text style={styles.subtitle}>
          Subscribe to unlock this content and get access to everything.
        </Text>
        <TouchableOpacity style={styles.unlockButton} onPress={onUnlock}>
          <LinearGradient
            colors={[theme.colors.primaryLight, theme.colors.primary]}
            style={styles.unlockButtonGradient}
          >
            <Ionicons name="sparkles" size={18} color="#fff" />
            <Text style={styles.unlockButtonText}>Unlock Premium</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

/**
 * useContentAccess - Legacy hook for checking content access
 *
 * Provides manual control over access checks and paywall visibility.
 * Useful in scenarios where you need fine-grained control over when to show
 * the paywall vs. when to allow access without rendering PremiumGate wrapper.
 */
export function useContentAccess(isPremiumContent: boolean) {
  const { isPremium, isLoading } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const handleAccess = () => {
    if (isPremiumContent && !isPremium) {
      setShowPaywall(true);
      return false;
    }
    return true;
  };

  return {
    canAccess: !isPremiumContent || isPremium,
    isLoading,
    showPaywall,
    setShowPaywall,
    handleAccess,
  };
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
  },
  badgeText: {
    fontFamily: "DMSans-SemiBold",
    fontSize: 11,
    color: "#fff",
  },
});

const createOverlayStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      minHeight: 200,
      borderRadius: theme.borderRadius.xl,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    content: {
      alignItems: "center",
    },
    iconContainer: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: `${theme.colors.primary}20`,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    title: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 22,
      color: theme.colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: 20,
      paddingHorizontal: 16,
    },
    unlockButton: {
      borderRadius: theme.borderRadius.lg,
      overflow: "hidden",
    },
    unlockButtonGradient: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      paddingHorizontal: 24,
      gap: 8,
    },
    unlockButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: "#fff",
    },
  });
