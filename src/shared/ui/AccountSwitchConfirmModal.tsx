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

interface AccountSwitchConfirmModalProps {
  visible: boolean;
  email: string | null;
  providerType: "google.com" | "apple.com" | "password";
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

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

export function AccountSwitchConfirmModal({
  visible,
  email,
  providerType,
  onConfirm,
  onCancel,
}: AccountSwitchConfirmModalProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const [isLoading, setIsLoading] = useState(false);

  const providerName = getProviderDisplayName(providerType);
  const displayAccount = email || `this ${providerName} account`;

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
          {/* Warning Icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name="swap-horizontal-outline"
              size={32}
              color={theme.colors.warning}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>Switch Account?</Text>

          {/* Description */}
          <Text style={styles.description}>
            Sign in to{" "}
            <Text style={styles.emailHighlight}>{displayAccount}</Text>?
          </Text>

          {/* Warning note */}
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

          {/* Switch Account button */}
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

          {/* Cancel button */}
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
