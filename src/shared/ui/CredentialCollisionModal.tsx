/**
 * CredentialCollisionModal.tsx
 *
 * Architectural Role:
 * Modal dialog that handles OAuth/auth provider conflicts. When a user tries to sign in
 * with a provider (Google/Apple/email) but that credential is already linked to a different
 * Calmdemy account, this modal presents two recovery options: sign in to the existing account
 * or switch authentication methods.
 *
 * Design Patterns:
 * - Modal State Container: Manages its own loading state during the async sign-in attempt.
 *   Parent controls visibility. Follows a focused single-responsibility pattern.
 * - Helper Functions for Polymorphism: Provider type detection functions (getProviderDisplayName,
 *   getProviderIcon) handle the three provider types (google.com, apple.com, password) without
 *   if-nesting in render code. Easy to extend for new providers.
 * - Structured Error Recovery: Offers two paths (sign in existing account, use different method),
 *   plus a helper note explaining the account linking requirement.
 *
 * Key Dependencies:
 * - Firebase auth: AuthCredential type from Firebase SDK
 * - ThemeContext: Colors for warning icon
 * - useSafeAreaInsets: Respects notch/home indicator on all devices
 *
 * Consumed By:
 * - Authentication flow (sign up/login screens)
 * - Credential linking workflows
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { Theme } from "@/theme";
import { AuthCredential } from "firebase/auth";

interface CredentialCollisionModalProps {
  visible: boolean;
  onClose: () => void;
  providerType: "google.com" | "apple.com" | "password";
  pendingCredential: AuthCredential | null;
  email?: string | null;
  onSignInToOtherAccount: () => void;
  onUseDifferentMethod: () => void;
}

/**
 * Map Firebase provider identifiers to user-friendly display names.
 * Allows the same modal to handle different auth methods with appropriate labels.
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
 * Map Firebase provider identifiers to Ionicons icon names.
 * Ensures consistent visual representation of each auth method in the UI.
 */
const getProviderIcon = (
  providerType: "google.com" | "apple.com" | "password"
): string => {
  switch (providerType) {
    case "google.com":
      return "logo-google";
    case "apple.com":
      return "logo-apple";
    case "password":
      return "mail";
    default:
      return "person";
  }
};

export function CredentialCollisionModal({
  visible,
  onClose,
  providerType,
  email,
  onSignInToOtherAccount,
  onUseDifferentMethod,
}: CredentialCollisionModalProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const [isLoading, setIsLoading] = useState(false);

  const providerName = getProviderDisplayName(providerType);
  const providerIcon = getProviderIcon(providerType);
  const displayAccount = email || `this ${providerName} account`;

  /**
   * Async wrapper for the sign-in callback. Manages loading state during the
   * (potentially async) sign-in attempt so the UI can show a spinner.
   */
  const handleSignInToOtherAccount = async () => {
    setIsLoading(true);
    try {
      await onSignInToOtherAccount();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name={providerIcon as any}
              size={32}
              color={theme.colors.warning}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>Account Already Exists</Text>

          {/* Description */}
          <Text style={styles.description}>
            {email ? (
              <>
                <Text style={styles.emailHighlight}>{email}</Text> is already
                linked to another Calmdemy account.
              </>
            ) : (
              `This ${providerName} account is already linked to another Calmdemy account.`
            )}
          </Text>

          {/* Sign in to other account button */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleSignInToOtherAccount}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons
                  name="log-in-outline"
                  size={20}
                  color="#fff"
                  style={styles.buttonIcon}
                />
                <Text style={styles.primaryButtonText}>
                  Sign in to that account
                </Text>
              </>
            )}
          </Pressable>

          {/* Use different method button */}
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={onUseDifferentMethod}
            disabled={isLoading}
          >
            <Ionicons
              name="swap-horizontal-outline"
              size={20}
              color={theme.colors.primary}
              style={styles.buttonIcon}
            />
            <Text style={styles.secondaryButtonText}>Use a different method</Text>
          </Pressable>

          {/* Cancel button */}
          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={onClose}
            disabled={isLoading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>

          {/* Helper text */}
          <View style={styles.helperNote}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={theme.colors.textMuted}
            />
            <Text style={styles.helperNoteText}>
              To link this {providerName} account to your current guest subscription, 
              you'll need to delete the existing account first. Sign in and delete the 
              account in Settings. Contact support if you need help.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    container: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: 32,
      alignItems: "center",
      width: "100%",
      maxWidth: 340,
      ...theme.shadows.lg,
    },
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
      marginBottom: 28,
    },
    emailHighlight: {
      fontFamily: theme.fonts.ui.semiBold,
      color: theme.colors.text,
    },
    primaryButton: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: theme.borderRadius.lg,
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    primaryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: "#fff",
    },
    secondaryButton: {
      backgroundColor: `${theme.colors.primary}10`,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: theme.borderRadius.lg,
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    secondaryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: theme.colors.primary,
    },
    cancelButton: {
      paddingVertical: 14,
      paddingHorizontal: 24,
      width: "100%",
      alignItems: "center",
    },
    cancelButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    buttonIcon: {
      marginRight: 8,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    helperNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: `${theme.colors.gray[100]}`,
      borderRadius: theme.borderRadius.md,
      padding: 12,
      marginTop: 8,
      gap: 8,
    },
    helperNoteText: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 12,
      color: theme.colors.textMuted,
      lineHeight: 17,
    },
  });
