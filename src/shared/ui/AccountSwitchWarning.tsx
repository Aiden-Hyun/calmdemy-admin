/**
 * ============================================================
 * AccountSwitchWarning.tsx — Account Switch Warning Modal
 * (Presentational Modal, Loading Guard Pattern)
 * ============================================================
 *
 * Architectural Role:
 *   This modal is the final checkpoint before an account switch is executed.
 *   It warns users about data loss (favorites, history, preferences) and
 *   ensures they understand the consequences. It's part of the multi-modal
 *   flow orchestrated by AccountPromptModal, serving as the last gate before
 *   executing the actual account switch action.
 *
 * Design Patterns:
 *   - Presentational Component: Renders a warning and two buttons; the parent
 *     controls visibility and handles the result of onConfirmSwitch.
 *   - Loading Guard: Uses isLoading to prevent double-clicks during async
 *     operation and to disable the cancel button during submission.
 *   - Simple State Machine: Two states — ready (isLoading=false) and
 *     in-progress (isLoading=true). No complex transitions.
 *
 * Consumed By:
 *   AccountPromptModal or similar account management flows that need a
 *   confirmation checkpoint before switching accounts.
 *
 * Key Dependencies:
 *   - useTheme: Provides warning colors and typography
 *   - useSafeAreaInsets: Respects notches and safe areas
 * ============================================================
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

interface AccountSwitchWarningProps {
  visible: boolean;
  onClose: () => void;
  onConfirmSwitch: () => Promise<void>;
}

/**
 * AccountSwitchWarning — Final Confirmation Before Account Switch
 *
 * This is the last step in the account switch flow: the user has already
 * selected which account to switch to, and now they confirm the final warning
 * about data loss. The parent handles the actual auth state change after
 * onConfirmSwitch resolves.
 */
export function AccountSwitchWarning({
  visible,
  onClose,
  onConfirmSwitch,
}: AccountSwitchWarningProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  // isLoading prevents double-clicks and disables buttons during the async operation
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Handler: Calls the parent's onConfirmSwitch callback (which performs the
   * actual account switch), then closes the modal if successful. The finally
   * block ensures isLoading is always cleared, even if the operation fails.
   *
   * Note: Errors are caught and logged but don't prevent the modal from closing.
   * The parent is responsible for displaying error alerts to the user.
   */
  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirmSwitch();
      onClose();
    } catch (error) {
      console.error("Error switching accounts:", error);
      // Error is logged but not re-thrown; the parent handles error display
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
          {/* Warning icon: signals this is a destructive operation */}
          <View style={styles.iconContainer}>
            <Ionicons
              name="warning-outline"
              size={32}
              color={theme.colors.warning}
            />
          </View>

          <Text style={styles.title}>Switch Accounts?</Text>

          {/* Main warning: explains the consequence of switching */}
          <Text style={styles.description}>
            If you switch accounts, you may not see data from your current
            account unless it's backed up or synced.
          </Text>

          {/* Informational callout: clarifies which data is affected */}
          <View style={styles.warningNote}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={theme.colors.textMuted}
            />
            <Text style={styles.warningNoteText}>
              Your favorites, history, and preferences will be associated with
              the new account.
            </Text>
          </View>

          {/* Primary action: destructive (warning color), disabled during async operation */}
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

          {/* Secondary action: cancel / go back */}
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
      marginBottom: 16,
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
