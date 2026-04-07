/**
 * ============================================================
 * AccountPromptModal.tsx — Account Linking Modal Dialog
 * (Modal Composition Pattern, State Machine, Error Handling)
 * ============================================================
 *
 * Architectural Role:
 *   This modal component prompts anonymous users to secure their subscription
 *   by linking an OAuth provider (Google or Apple). It's displayed early in
 *   the app lifecycle to encourage account persistence and cross-device sync.
 *   It acts as a Gatekeeper at the subscription boundary — ensuring that users
 *   don't lose access to paid content if they reinstall or switch devices.
 *
 * Design Patterns:
 *   - Modal Composition: Manages multiple overlapping modals in a coordinated way
 *     using local state flags (collisionError, showSwitchWarning). Each modal
 *     has its own visibility flag and event handlers, but they're all orchestrated
 *     from a single parent component.
 *   - State Machine (implicit): Transitions between states:
 *     1. Initial (showing sign-in buttons)
 *     2. Loading (one provider in progress, buttons disabled)
 *     3. Collision (credential email taken on another account, show nested modal)
 *     4. Warning (user confirmed they want to switch accounts, show confirmation)
 *   - Error Recovery: Catches CredentialCollisionError and routes it to a
 *     specialized modal (CredentialCollisionModal) rather than failing the flow
 *   - Provider Strategy Pattern: Conditionally renders Apple Sign-In only on iOS
 *     if the native capability is available (runtime capability detection).
 *   - Uncontrolled Component (props-only): visible and onClose props make this
 *     fully uncontrolled — the parent decides visibility, this component never
 *     initiates its own dismissal except via onClose callbacks.
 *
 * Consumed By:
 *   Subscription/Account initialization flows, typically called from a ViewModel
 *   hook that checks whether the current user is anonymous and prompts if needed.
 *
 * Key Dependencies:
 *   - useAuth: Provides OAuth linking methods (upgradeAnonymousWithGoogle/Apple)
 *   - useTheme: Supplies color and typography for this modal's styling
 *   - CredentialCollisionModal: Child modal for handling email collisions
 *   - AccountSwitchWarning: Child modal for confirming account switches
 * ============================================================
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useAuth, CredentialCollisionError } from "@core/providers/contexts/AuthContext";
import { Theme } from "@/theme";
import { ModalFrame } from "./ModalFrame";
import { CredentialCollisionModal } from "./CredentialCollisionModal";
import { AccountSwitchWarning } from "./AccountSwitchWarning";

interface AccountPromptModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * AccountPromptModal — Account Linking Orchestrator
 *
 * This modal orchestrates the account linking flow, handling three scenarios:
 * 1. Happy path: User links with Google or Apple successfully
 * 2. Collision: Email is already registered with another provider
 * 3. Account switch: User accepts the collision and switches accounts
 *
 * The component manages local state for each scenario and coordinates three
 * distinct modal surfaces (AccountPromptModal → CredentialCollisionModal →
 * AccountSwitchWarning) using a state machine approach with multiple boolean
 * flags. See inline comments for each state transition.
 */
export function AccountPromptModal({
  visible,
  onClose,
}: AccountPromptModalProps) {
  const { theme, isDark } = useTheme();
  // useMemo memoizes the StyleSheet object to prevent unnecessary recalculations
  // on every render. The dependency array [theme, isDark] ensures styles only
  // regenerate when the theme or dark mode setting actually changes.
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const {
    upgradeAnonymousWithGoogle,
    upgradeAnonymousWithApple,
    isAppleSignInAvailable,
    signInWithPendingCredential,
  } = useAuth();

  // --- State Management: Three overlapping modals, each with its own visibility flag ---
  // isLoading: global loading state (disables all buttons)
  // loadingProvider: tracks which OAuth provider is currently in flight (for per-button spinners)
  // collisionError: captures the CredentialCollisionError and shows the collision modal
  // showSwitchWarning: shows the account-switch confirmation modal
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [collisionError, setCollisionError] =
    useState<CredentialCollisionError | null>(null);
  const [showSwitchWarning, setShowSwitchWarning] = useState(false);

  /**
   * Upgrades the anonymous user to a Google OAuth account.
   *
   * This implements a classic async handler pattern: set loading state, call
   * the ViewModel method, handle success/error, and clear loading state. The
   * error handling is defensive — it explicitly checks for CredentialCollisionError
   * (a known, recoverable error) before falling back to a generic alert.
   *
   * The "User cancelled" check is a guard clause that prevents noise alerts
   * when the user dismisses the native OAuth dialog intentionally.
   */
  const handleGoogleLink = async () => {
    setIsLoading(true);
    setLoadingProvider("google");
    try {
      await upgradeAnonymousWithGoogle();
      // Success path: user is now authenticated with Google
      Alert.alert(
        "Account Secured!",
        "Your subscription is now linked to your Google account."
      );
      onClose();
    } catch (error: unknown) {
      // Defensive error handling: check the specific error type first
      // CredentialCollisionError is recoverable — route to the collision modal
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else {
        const errorMessage = error instanceof Error ? error.message : "Failed to link Google account";
        if (errorMessage !== "User cancelled") {
          // Guard clause: suppress alerts for intentional user cancellations
          Alert.alert("Error", errorMessage);
        }
      }
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  /**
   * Apple Sign-In equivalent to handleGoogleLink.
   * Follows the same error-handling pattern and state management.
   */
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
    } catch (error: unknown) {
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else {
        const errorMessage = error instanceof Error ? error.message : "Failed to link Apple account";
        if (errorMessage !== "User cancelled") {
          Alert.alert("Error", errorMessage);
        }
      }
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  /**
   * Handles the "sign in to the other account" button from CredentialCollisionModal.
   * Transitions from the collision state to the switch-warning state, showing a
   * confirmation modal before actually executing the account switch.
   *
   * This is a State Machine transition: collisionError exists → showSwitchWarning = true
   */
  const handleCollisionSignIn = () => {
    // State transition: collision modal → switch warning modal
    setShowSwitchWarning(true);
  };

  /**
   * Confirms the account switch after the user reviewed the warning.
   * Uses the pendingCredential from the collision error to sign in to the
   * other account, then clears both error states and closes the modal.
   *
   * Guard clause: if pendingCredential is missing, bail silently (defensive programming).
   */
  const handleConfirmSwitch = async () => {
    // Guard clause: missing credential indicates a corrupted state
    if (!collisionError?.pendingCredential) return;
    try {
      await signInWithPendingCredential(collisionError.pendingCredential);
      setCollisionError(null);
      onClose();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to sign in";
      Alert.alert("Error", errorMessage);
    }
  };

  /**
   * Resets the collision error state, allowing the user to try a different
   * authentication method. This is the "Back" path from the collision modal.
   */
  const handleCollisionDifferentMethod = () => {
    setCollisionError(null);
    // User is returned to the main sign-in buttons; they can try Google or Apple again
  };

  /**
   * Closes the modal without linking an account. Implements the "Maybe later" path.
   */
  const handleContinue = () => {
    onClose();
  };

  return (
    <>
      {/* --- Main Modal: Sign-in buttons (hidden when collision error exists) --- */}
      <ModalFrame
        visible={visible && !collisionError}
        onDismiss={onClose}
        showCloseButton={false}
      >
        {/* Branded icon header with gradient background */}
        <LinearGradient
          colors={[theme.colors.primary, theme.colors.primaryDark]}
          style={styles.iconContainer}
        >
          <Ionicons name="shield-checkmark-outline" size={32} color="#fff" />
        </LinearGradient>

        <Text style={styles.title}>Secure Your Subscription</Text>
        <Text style={styles.description}>
          Link an account to keep your subscription safe and sync your
          favorites across devices.
        </Text>

        {/* --- Platform-specific rendering: Apple Sign-In only on iOS --- */}
        {/* Strategy Pattern: runtime capability check. If Apple Sign-In is not
            available on this device (e.g., iOS simulator, older OS), this
            Pressable is not rendered at all. */}
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
            {/* Conditional rendering: show spinner while this provider is loading,
                icon + text otherwise. This provides visual feedback that a specific
                OAuth provider is in flight. */}
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

        {/* Google Sign-In button (available on all platforms) */}
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

        {/* Escape hatch: user can dismiss without linking */}
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

        {/* Informational callout: communicates the risk of not linking */}
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
      </ModalFrame>

      {/* --- Modal 2: Credential Collision Handling --- */}
      {/* Conditional rendering: only shown when collisionError is non-null.
          This is a Composition pattern — the parent orchestrates child modals
          based on its local state. CredentialCollisionModal is a specialized
          UI for handling the specific case of "email already registered". */}
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

      {/* --- Modal 3: Account Switch Confirmation --- */}
      {/* Defensive composition: AccountSwitchWarning only receives the callback
          if collisionError exists (so pendingCredential is available). This
          prevents the warning from being shown without context. */}
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
