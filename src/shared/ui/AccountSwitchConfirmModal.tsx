/**
 * ============================================================
 * AccountSwitchConfirmModal.tsx — Account Switch Confirmation
 * (Presentational Modal, Discriminated Union Pattern)
 * ============================================================
 *
 * Architectural Role:
 *   This is a pure, uncontrolled presentational modal that displays a
 *   destructive confirmation dialog before switching from the current
 *   (guest) account to an existing account. It's a critical Gatekeeper
 *   that prevents accidental loss of the guest account and its subscription.
 *
 * Design Patterns:
 *   - Presentational Component: All logic is in the parent; this modal is
 *     fully driven by props and callbacks. It has no knowledge of why the
 *     user is switching or what happens after confirmation.
 *   - Uncontrolled Component: The parent controls visibility and handles
 *     the async onConfirm callback; this component only manages local
 *     loading state during the async operation.
 *   - Discriminated Union (providerType): Uses a string literal union
 *     ("google.com" | "apple.com" | "password") to represent which OAuth
 *     provider the target account uses. The getProviderDisplayName helper
 *     maps these discriminated values to user-facing strings.
 *   - Loading State Pattern: isLoading flag prevents double-clicks and
 *     shows spinner feedback while the async operation is in flight.
 *
 * Consumed By:
 *   Parent account management flows that handle credential collisions.
 *   The onConfirm callback typically signs in to the other account and
 *   transfers the current session state to it.
 *
 * Key Dependencies:
 *   - useTheme: Provides warning colors and theming for this destructive action
 *   - useSafeAreaInsets: Ensures the modal respects notches and safe areas
 * ============================================================
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { Theme } from "@/theme";
import { ModalFrame } from "./ModalFrame";

interface AccountSwitchConfirmModalProps {
  visible: boolean;
  email: string | null;
  providerType: "google.com" | "apple.com" | "password";
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Helper function: Maps Firebase provider type strings to user-friendly display names.
 *
 * This is a simple Discriminated Union pattern: the function accepts a specific
 * set of string literals and returns a corresponding display name. TypeScript
 * ensures at compile time that only valid provider types are passed.
 *
 * @param providerType - Firebase auth provider identifier (e.g., "google.com")
 * @returns User-friendly display name ("Google", "Apple", etc.)
 */
const getProviderDisplayName = (
  providerType: "google.com" | "apple.com" | "password"
): string => {
  switch (providerType) {
    case "google.com":
      return "Google";
    case "apple.com":
      return "Apple";
    case "password":
      return "email";
    default:
      return "account";
  }
};

/**
 * AccountSwitchConfirmModal — Destructive Account Switch Confirmation
 *
 * This modal is intentionally simple: it displays the email/account the user
 * will switch to, warns them about the consequences, and lets them confirm
 * or cancel. The parent component handles all side effects (auth state changes).
 *
 * The isLoading flag prevents double-submits while the async onConfirm is
 * in flight — a common pattern for destructive operations.
 */
export function AccountSwitchConfirmModal({
  visible,
  email,
  providerType,
  onConfirm,
  onCancel,
}: AccountSwitchConfirmModalProps) {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const [isLoading, setIsLoading] = useState(false);

  // Derived state: convert provider type to display name and build the account label
  const providerName = getProviderDisplayName(providerType);
  const displayAccount = email || `this ${providerName} account`;

  /**
   * Async handler: guards against double-clicks by setting isLoading to true,
   * calls the parent's onConfirm callback, and ensures isLoading is cleared
   * (even if onConfirm rejects).
   *
   * This pattern is called the "Loading Guard" — it's essential for destructive
   * operations to prevent race conditions where the user clicks twice before
   * the first request completes.
   */
  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ModalFrame
      visible={visible}
      onDismiss={onCancel}
      showCloseButton={false}
    >
      {/* Warning icon with background: uses theme.colors.warning to signal
          this is a destructive operation */}
      <View style={styles.iconContainer}>
        <Ionicons
          name="swap-horizontal-outline"
          size={32}
          color={theme.colors.warning}
        />
      </View>

      <Text style={styles.title}>Switch Account?</Text>

      {/* Description: embeds the email in a Text component with
          emailHighlight style to visually emphasize which account
          the user will switch to. This improves clarity for destructive ops. */}
      <Text style={styles.description}>
        Sign in to{" "}
        <Text style={styles.emailHighlight}>{displayAccount}</Text>?
      </Text>

      {/* Warning callout: explains the critical consequence — the subscription
          does NOT transfer. This is essential UX for a destructive action. */}
      <View style={styles.warningNote}>
        <Ionicons
          name="warning-outline"
          size={18}
          color={theme.colors.warning}
        />
        <Text style={styles.warningNoteText}>
          This will replace your current guest account. Your subscription
          will remain on the guest account and won't transfer.
        </Text>
      </View>

      {/* Primary action: colored in warning color to emphasize destructiveness.
          Disabled while isLoading to prevent double-clicks. */}
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.buttonPressed,
          isLoading && styles.buttonDisabled,
        ]}
        onPress={handleConfirm}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.primaryButtonText}>Switch Account</Text>
        )}
      </Pressable>

      {/* Escape hatch: secondary button to cancel without side effects */}
      <Pressable
        style={({ pressed }) => [
          styles.cancelButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={onCancel}
        disabled={isLoading}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </Pressable>
    </ModalFrame>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    iconContainer: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: `${theme.colors.warning}15`,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    title: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 22,
      color: theme.colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    description: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 22,
      marginBottom: 16,
    },
    emailHighlight: {
      fontFamily: theme.fonts.ui.semiBold,
      color: theme.colors.text,
    },
    warningNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: `${theme.colors.warning}10`,
      borderRadius: theme.borderRadius.md,
      padding: 12,
      marginBottom: 24,
      gap: 8,
    },
    warningNoteText: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      color: theme.colors.textMuted,
      lineHeight: 18,
    },
    primaryButton: {
      backgroundColor: theme.colors.warning,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: theme.borderRadius.lg,
      width: "100%",
      alignItems: "center",
      marginBottom: 12,
    },
    primaryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: "#fff",
    },
    cancelButton: {
      paddingVertical: 14,
      paddingHorizontal: 32,
      width: "100%",
      alignItems: "center",
    },
    cancelButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
