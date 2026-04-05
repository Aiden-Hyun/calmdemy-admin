import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useAuth, CredentialCollisionError } from "@core/providers/contexts/AuthContext";
import { Theme } from "@/theme";
import { CredentialCollisionModal } from "./CredentialCollisionModal";
import { AccountSwitchWarning } from "./AccountSwitchWarning";

interface AccountPromptModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AccountPromptModal({
  visible,
  onClose,
}: AccountPromptModalProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const {
    upgradeAnonymousWithGoogle,
    upgradeAnonymousWithApple,
    isAppleSignInAvailable,
    signInWithPendingCredential,
  } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [collisionError, setCollisionError] =
    useState<CredentialCollisionError | null>(null);
  const [showSwitchWarning, setShowSwitchWarning] = useState(false);

  const handleGoogleLink = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AccountPromptModal.tsx:handleGoogleLink:entry',message:'handleGoogleLink called',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    setIsLoading(true);
    setLoadingProvider("google");
    try {
      await upgradeAnonymousWithGoogle();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AccountPromptModal.tsx:handleGoogleLink:success',message:'upgradeAnonymousWithGoogle succeeded - THIS SHOULD NOT HAPPEN for collision',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      Alert.alert(
        "Account Secured!",
        "Your subscription is now linked to your Google account."
      );
      onClose();
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AccountPromptModal.tsx:handleGoogleLink:catch',message:'Caught error',data:{errorType:error?.constructor?.name,isCollisionError:error instanceof CredentialCollisionError,errorMessage:error?.message,errorCode:error?.code},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B,D'})}).catch(()=>{});
      // #endregion
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else if (error.message !== "User cancelled") {
        Alert.alert("Error", error.message || "Failed to link Google account");
      }
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const handleAppleLink = async () => {
    setIsLoading(true);
    setLoadingProvider("apple");
    try {
      await upgradeAnonymousWithApple();
      Alert.alert(
        "Account Secured!",
        "Your subscription is now linked to your Apple account."
      );
      onClose();
    } catch (error: any) {
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else if (error.message !== "User cancelled") {
        Alert.alert("Error", error.message || "Failed to link Apple account");
      }
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const handleCollisionSignIn = () => {
    // Show warning before switching accounts
    setShowSwitchWarning(true);
  };

  const handleConfirmSwitch = async () => {
    if (!collisionError?.pendingCredential) return;
    try {
      await signInWithPendingCredential(collisionError.pendingCredential);
      setCollisionError(null);
      onClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to sign in");
    }
  };

  const handleCollisionDifferentMethod = () => {
    setCollisionError(null);
    // User can try a different method
  };

  const handleContinue = () => {
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible && !collisionError}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View
            style={[styles.container, { paddingBottom: insets.bottom + 24 }]}
          >
            {/* Icon */}
            <LinearGradient
              colors={[theme.colors.primary, theme.colors.primaryDark]}
              style={styles.iconContainer}
            >
              <Ionicons name="shield-checkmark-outline" size={32} color="#fff" />
            </LinearGradient>

            {/* Title */}
            <Text style={styles.title}>Secure Your Subscription</Text>

            {/* Description */}
            <Text style={styles.description}>
              Link an account to keep your subscription safe and sync your
              favorites across devices.
            </Text>

            {/* Apple Sign In - show first on iOS */}
            {Platform.OS === "ios" && isAppleSignInAvailable && (
              <Pressable
                style={({ pressed }) => [
                  styles.providerButton,
                  { backgroundColor: "#000" },
                  pressed && styles.buttonPressed,
                  isLoading && styles.buttonDisabled,
                ]}
                onPress={handleAppleLink}
                disabled={isLoading}
              >
                {loadingProvider === "apple" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={20} color="#fff" />
                    <Text style={styles.providerButtonText}>
                      Continue with Apple
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            {/* Google Sign In */}
            <Pressable
              style={({ pressed }) => [
                styles.providerButton,
                { backgroundColor: "#4285F4" },
                pressed && styles.buttonPressed,
                isLoading && styles.buttonDisabled,
              ]}
              onPress={handleGoogleLink}
              disabled={isLoading}
            >
              {loadingProvider === "google" ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={20} color="#fff" />
                  <Text style={styles.providerButtonText}>
                    Continue with Google
                  </Text>
                </>
              )}
            </Pressable>

            {/* Continue without account */}
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleContinue}
              disabled={isLoading}
            >
              <Text style={styles.secondaryButtonText}>Maybe later</Text>
            </Pressable>

            {/* Warning note */}
            <View style={styles.warningNote}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={theme.colors.warning}
              />
              <Text style={styles.warningNoteText}>
                Without linking, you may lose access if you reinstall the app or
                switch devices.
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Credential collision modal */}
      {collisionError && (
        <CredentialCollisionModal
          visible={!!collisionError}
          onClose={() => setCollisionError(null)}
          providerType={collisionError.providerType}
          pendingCredential={collisionError.pendingCredential}
          onSignInToOtherAccount={handleCollisionSignIn}
          onUseDifferentMethod={handleCollisionDifferentMethod}
        />
      )}

      {/* Account switch warning */}
      <AccountSwitchWarning
        visible={showSwitchWarning}
        onClose={() => setShowSwitchWarning(false)}
        onConfirmSwitch={handleConfirmSwitch}
      />
    </>
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
      marginBottom: 24,
    },
    providerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: theme.borderRadius.lg,
      width: "100%",
      marginBottom: 12,
      gap: 10,
    },
    providerButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: "#fff",
    },
    secondaryButton: {
      paddingVertical: 12,
      paddingHorizontal: 32,
      width: "100%",
      alignItems: "center",
    },
    secondaryButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    warningNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: `${theme.colors.warning}10`,
      borderRadius: theme.borderRadius.md,
      padding: 12,
      marginTop: 16,
      gap: 8,
    },
    warningNoteText: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 12,
      color: theme.colors.textMuted,
      lineHeight: 16,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
