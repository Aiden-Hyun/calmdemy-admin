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
  isPremium?: boolean;
  /** Show inline lock badge instead of blocking content */
  showBadgeOnly?: boolean;
  /** Callback when premium content is accessed */
  onAccessGranted?: () => void;
  style?: ViewStyle;
}

/**
 * Wrapper component that gates premium content.
 * If content is premium and user is not subscribed, shows paywall.
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

  // If not premium content or user has access, render children directly
  if (!isPremium || canAccess) {
    return <>{children}</>;
  }

  // If showing badge only, wrap children with badge
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

  // Default: block content with lock overlay
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
 * Small premium badge to show on cards
 */
interface PremiumBadgeProps {
  onPress?: () => void;
  size?: "small" | "medium";
}

export function PremiumBadge({ onPress, size = "small" }: PremiumBadgeProps) {
  const { theme } = useTheme();
  const { isPremium } = useSubscription();

  // Don't show badge if user is premium
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
 * Full lock overlay for blocking content
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
 * Hook for checking if content should show premium lock
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
