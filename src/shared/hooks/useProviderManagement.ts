/**
 * Provider Management Hook - Multi-Method Authentication
 *
 * ARCHITECTURAL ROLE:
 * High-level ViewModel hook for managing multiple sign-in methods (Google, Apple, Email)
 * on a single account. Handles linking/unlinking providers, switching accounts,
 * password reset, and credential collision errors (when same email used across providers).
 *
 * DESIGN PATTERNS:
 * - Provider Registry: Tracks linked vs available providers (cannot link twice)
 * - Error Categorization: Distinguishes collision errors (special handling) from others
 * - Safety Checks: Prevents unlinking last provider (account lockout protection)
 * - Alternative Flow Detection: Before switching, ensures fallback provider exists
 *
 * KEY RESPONSIBILITIES:
 * 1. Display linked providers (Google, Apple, Email)
 * 2. Suggest available providers to add
 * 3. Link new provider with error handling
 * 4. Unlink provider (with safety check for last provider)
 * 5. Switch provider account (unlink old, link new)
 * 6. Handle credential collision errors (email linked to different Google account)
 * 7. Change email address and reset password flows
 *
 * COLLISION ERROR NOTES:
 * When user tries to link Google with email X, but X already exists in Firebase
 * under different account, we get CredentialCollisionError. Special UI flow lets user:
 * 1. Sign in with the colliding credential (switch accounts)
 * 2. OR cancel and use different email
 * This hook exposes collisionError and signInWithCollisionCredential for that flow.
 *
 * CONSUMERS:
 * - Account settings screens: Manage providers and email
 * - Linked accounts view: Show which providers connected
 * - Credential collision dialog: Handle collision errors
 *
 * DEPENDENCIES:
 * - useAuth: Access to link/unlink/changeEmail functions
 * - Firebase Auth: Underlying provider management
 *
 * IMPORTANT NOTES:
 * - User must always have at least one linked provider
 * - Switching provider requires another provider as fallback
 * - Apple sign-in only available on iOS (isAppleSignInAvailable check)
 * - Collision errors require special handling (separate UI flow)
 */

import { useState, useCallback } from "react";
import { Alert } from "react-native";
import { AuthCredential } from "firebase/auth";
import { useAuth, CredentialCollisionError } from "@core/providers/contexts/AuthContext";

interface ProviderInfo {
  providerId: string;
  displayName: string;
  email?: string | null;
  icon: string;
}

interface UseProviderManagementReturn {
  linkedProviders: ProviderInfo[];
  availableProviders: ProviderInfo[];
  isLoading: boolean;
  error: string | null;
  // Collision state
  collisionError: CredentialCollisionError | null;
  clearCollisionError: () => void;
  // Provider actions
  linkGoogleProvider: () => Promise<void>;
  linkAppleProvider: () => Promise<void>;
  linkEmailProvider: (email: string, password: string) => Promise<void>;
  unlinkProviderById: (providerId: string) => Promise<void>;
  switchGoogleAccount: () => Promise<void>;
  switchAppleAccount: () => Promise<void>;
  changeEmailAddress: (newEmail: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  // For collision handling
  signInWithCollisionCredential: () => Promise<void>;
}

/**
 * PROVIDER DISPLAY METADATA
 * Maps Firebase provider IDs to user-friendly names and icons.
 * Used for provider list UI and alerts.
 */
const PROVIDER_DISPLAY_INFO: Record<
  string,
  { displayName: string; icon: string }
> = {
  "google.com": { displayName: "Google", icon: "logo-google" },
  "apple.com": { displayName: "Apple", icon: "logo-apple" },
  password: { displayName: "Email & Password", icon: "mail" },
};

/**
 * useProviderManagement Hook
 *
 * Manage multiple sign-in methods (Google, Apple, Email) on a user account.
 *
 * @returns Object with provider lists, loading state, and action methods for linking/unlinking
 *
 * USAGE EXAMPLE:
 *   const providers = useProviderManagement();
 *   // Show linked providers
 *   providers.linkedProviders.map(p => <Text>{p.displayName}</Text>)
 *   // Link new provider
 *   <Button onPress={providers.linkGoogleProvider}>Connect Google</Button>
 */
export function useProviderManagement(): UseProviderManagementReturn {
  const {
    user,
    linkProvider,
    unlinkProvider,
    getGoogleCredential,
    getAppleCredential,
    changeEmail,
    sendPasswordReset,
    signInWithPendingCredential,
    isAppleSignInAvailable,
  } = useAuth();

  /**
   * LOCAL STATE
   * isLoading: Action in progress (link/unlink/switch) - shows loading spinners
   * error: General error message from failed operations
   * collisionError: Special error type when email already linked to different account
   */
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collisionError, setCollisionError] =
    useState<CredentialCollisionError | null>(null);

  /**
   * LINKED PROVIDERS - Derived from Firebase User object
   * Transform Firebase providerData into UI-friendly ProviderInfo objects.
   * Used to show which methods are already connected to this account.
   *
   * EXAMPLE:
   * Firebase user.providerData = [
   *   { providerId: 'google.com', email: 'user@gmail.com' },
   *   { providerId: 'password', email: 'user@example.com' },
   * ]
   * Maps to:
   * [
   *   { providerId: 'google.com', displayName: 'Google', email: 'user@gmail.com', icon: '...' },
   *   { providerId: 'password', displayName: 'Email & Password', email: 'user@example.com', icon: '...' },
   * ]
   */
  const linkedProviders: ProviderInfo[] = (user?.providerData || []).map(
    (provider) => ({
      providerId: provider.providerId,
      displayName:
        PROVIDER_DISPLAY_INFO[provider.providerId]?.displayName ||
        provider.providerId,
      email: provider.email,
      icon: PROVIDER_DISPLAY_INFO[provider.providerId]?.icon || "person",
    })
  );

  /**
   * AVAILABLE PROVIDERS - Providers not yet linked
   * Calculate which sign-in methods user can still add.
   * Can't link same provider twice (linkGoogleProvider after already linked fails).
   * Apple only available on iOS (isAppleSignInAvailable check).
   *
   * LOGIC:
   * For each provider:
   * 1. Check if already linked
   * 2. Check if available on platform (Apple only on iOS)
   * 3. If not linked AND available, add to availableProviders list
   *
   * This list is shown in "Add Sign-In Method" screen for user to choose from.
   */
  const linkedProviderIds = linkedProviders.map((p) => p.providerId);
  const availableProviders: ProviderInfo[] = [];

  if (!linkedProviderIds.includes("google.com")) {
    availableProviders.push({
      providerId: "google.com",
      displayName: "Google",
      icon: "logo-google",
    });
  }
  if (!linkedProviderIds.includes("apple.com") && isAppleSignInAvailable) {
    availableProviders.push({
      providerId: "apple.com",
      displayName: "Apple",
      icon: "logo-apple",
    });
  }
  if (!linkedProviderIds.includes("password")) {
    availableProviders.push({
      providerId: "password",
      displayName: "Email & Password",
      icon: "mail",
    });
  }

  /**
   * CLEAR COLLISION ERROR (useCallback)
   * Dismiss collision error dialog after user resolves it.
   * Called when user chooses to sign in with collision credential or cancel.
   */
  const clearCollisionError = useCallback(() => {
    setCollisionError(null);
  }, []);

  /**
   * HANDLE ERROR HELPER (useCallback)
   * Categorize error and show appropriate UI feedback.
   *
   * TWO ERROR PATHS:
   * 1. CredentialCollisionError: Email already exists on different account
   *    - Store in collisionError state for special collision UI flow
   *    - Don't show alert (handled by separate UI flow)
   * 2. Other errors: Show alert to user
   *    - Log to console for debugging
   *    - Store error message in state
   *
   * DEPENDENCY: [] (pure function wrapper)
   */
  const handleError = useCallback((err: any, action: string) => {
    if (err instanceof CredentialCollisionError) {
      setCollisionError(err);
      return;
    }
    console.error(`Error ${action}:`, err);
    setError(err.message || `Failed to ${action}`);
    Alert.alert("Error", err.message || `Failed to ${action}`);
  }, []);

  /**
   * LINK GOOGLE PROVIDER (useCallback)
   * Add Google sign-in to user's account. Shows native Google sign-in UI.
   *
   * ERROR HANDLING:
   * - Collision: Email already linked to different Google account (see handleError)
   * - Others: Show alert with error message
   *
   * SUCCESS:
   * Show confirmation alert. User can now sign in with Google from login screen.
   *
   * DEPENDENCY: [linkProvider, handleError]
   */
  const linkGoogleProvider = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await linkProvider("google.com");
      Alert.alert("Success", "Google account linked successfully!");
    } catch (err: any) {
      handleError(err, "link Google account");
    } finally {
      setIsLoading(false);
    }
  }, [linkProvider, handleError]);

  /**
   * LINK APPLE PROVIDER (useCallback)
   * Add Apple sign-in to user's account (iOS only). Shows native Apple sign-in UI.
   *
   * SAME PATTERN AS LINK GOOGLE:
   * - Show Apple native dialog
   * - Handle collision/errors
   * - Show success alert
   *
   * DEPENDENCY: [linkProvider, handleError]
   */
  const linkAppleProvider = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await linkProvider("apple.com");
      Alert.alert("Success", "Apple account linked successfully!");
    } catch (err: any) {
      handleError(err, "link Apple account");
    } finally {
      setIsLoading(false);
    }
  }, [linkProvider, handleError]);

  /**
   * LINK EMAIL PROVIDER (useCallback)
   * Add email/password sign-in to user's account.
   *
   * REQUIRED PARAMETERS:
   * - email: Unique email address for password recovery
   * - password: User's chosen password (must meet strength requirements)
   *
   * NON-OBVIOUS:
   * User can link email even if they signed up with Google/Apple.
   * This allows password-based login as fallback if social services are down.
   *
   * DEPENDENCY: [linkProvider, handleError]
   */
  const linkEmailProvider = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await linkProvider("password", { email, password });
        Alert.alert("Success", "Email and password linked successfully!");
      } catch (err: any) {
        handleError(err, "link email");
      } finally {
        setIsLoading(false);
      }
    },
    [linkProvider, handleError]
  );

  /**
   * UNLINK PROVIDER (useCallback)
   * Remove sign-in method from account.
   *
   * SAFETY CHECK:
   * If user has only 1 provider, prevent unlinking (would lock them out).
   * Show alert: "You must have at least one sign-in method"
   * Force user to link new provider first.
   *
   * SUCCESS:
   * Show confirmation. User can no longer sign in with this method.
   * Other linked methods still work.
   *
   * DEPENDENCY: [unlinkProvider, linkedProviders.length, handleError]
   * Includes linkedProviders.length for safety check.
   */
  const unlinkProviderById = useCallback(
    async (providerId: string) => {
      if (linkedProviders.length <= 1) {
        Alert.alert(
          "Cannot Remove",
          "You must have at least one sign-in method linked to your account."
        );
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        await unlinkProvider(providerId);
        Alert.alert("Success", "Sign-in method removed successfully!");
      } catch (err: any) {
        handleError(err, "remove sign-in method");
      } finally {
        setIsLoading(false);
      }
    },
    [unlinkProvider, linkedProviders.length, handleError]
  );

  /**
   * SWITCH GOOGLE ACCOUNT (useCallback)
   * Unlink current Google account and link different Google account.
   *
   * SAFETY CHECK:
   * Before switching, ensure user has another provider (Email or Apple).
   * If only Google linked, prevent switch (would lock them out).
   * Alert message explains to add Email/Apple first.
   *
   * FLOW:
   * 1. Verify alternative provider exists
   * 2. Show native Google sign-in for new Google account
   * 3. Unlink old Google
   * 4. Link new Google
   * 5. Show success alert
   *
   * ERROR HANDLING:
   * If user cancels Google sign-in (getGoogleCredential returns null), exit silently.
   *
   * USE CASE:
   * User wants to link different Google account (e.g., work account instead of personal).
   *
   * DEPENDENCY: [linkedProviders, getGoogleCredential, unlinkProvider, linkProvider, handleError]
   */
  const switchGoogleAccount = useCallback(async () => {
    // Check if user has another provider to fall back on
    const hasOtherProvider = linkedProviders.some(
      (p) => p.providerId !== "google.com"
    );

    if (!hasOtherProvider) {
      Alert.alert(
        "Add Another Method First",
        "Before switching Google accounts, please add another sign-in method (like Email or Apple) to ensure you don't lose access to your account.",
        [{ text: "OK" }]
      );
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Get new Google credential
      const newCredential = await getGoogleCredential();
      if (!newCredential) {
        setIsLoading(false);
        return; // User cancelled
      }

      // Unlink old Google, link new
      await unlinkProvider("google.com");
      await linkProvider("google.com");
      Alert.alert("Success", "Google account switched successfully!");
    } catch (err: any) {
      handleError(err, "switch Google account");
    } finally {
      setIsLoading(false);
    }
  }, [
    linkedProviders,
    getGoogleCredential,
    unlinkProvider,
    linkProvider,
    handleError,
  ]);

  /**
   * SWITCH APPLE ACCOUNT (useCallback)
   * Unlink current Apple account and link different Apple account (iOS only).
   *
   * SAME PATTERN AS SWITCH GOOGLE:
   * - Safety check for fallback provider
   * - Get new Apple credential from native UI
   * - Unlink old, link new
   * - Show success
   *
   * DEPENDENCY: [linkedProviders, getAppleCredential, unlinkProvider, linkProvider, handleError]
   */
  const switchAppleAccount = useCallback(async () => {
    // Check if user has another provider to fall back on
    const hasOtherProvider = linkedProviders.some(
      (p) => p.providerId !== "apple.com"
    );

    if (!hasOtherProvider) {
      Alert.alert(
        "Add Another Method First",
        "Before switching Apple accounts, please add another sign-in method (like Email or Google) to ensure you don't lose access to your account.",
        [{ text: "OK" }]
      );
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Get new Apple credential
      const newCredential = await getAppleCredential();
      if (!newCredential) {
        setIsLoading(false);
        return; // User cancelled
      }

      // Unlink old Apple, link new
      await unlinkProvider("apple.com");
      await linkProvider("apple.com");
      Alert.alert("Success", "Apple account switched successfully!");
    } catch (err: any) {
      handleError(err, "switch Apple account");
    } finally {
      setIsLoading(false);
    }
  }, [
    linkedProviders,
    getAppleCredential,
    unlinkProvider,
    linkProvider,
    handleError,
  ]);

  /**
   * CHANGE EMAIL ADDRESS (useCallback)
   * Update email address for password-based sign-in.
   *
   * REQUIRED:
   * - newEmail: New email address (must be unique across all Firebase accounts)
   * - password: User's current password (for re-authentication)
   *
   * PROCESS:
   * 1. Re-authenticate user with password (security check)
   * 2. Update email in Firebase Auth
   * 3. Show confirmation alert
   *
   * DEPENDENCY: [changeEmail, handleError]
   */
  const changeEmailAddress = useCallback(
    async (newEmail: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await changeEmail(newEmail, password);
        Alert.alert("Success", "Email address updated successfully!");
      } catch (err: any) {
        handleError(err, "change email");
      } finally {
        setIsLoading(false);
      }
    },
    [changeEmail, handleError]
  );

  /**
   * RESET PASSWORD (useCallback)
   * Send password reset email to user's email address.
   *
   * PARAMETER:
   * - email: Email to send reset link to (must be registered in Firebase)
   *
   * ANTI-ENUMERATION:
   * Always show same success message regardless of whether email exists.
   * This prevents attackers from discovering which emails are registered.
   * Legitimate users can verify by checking email inbox.
   *
   * DEPENDENCY: [sendPasswordReset]
   */
  const resetPassword = useCallback(
    async (email: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await sendPasswordReset(email);
        Alert.alert(
          "Email Sent",
          "Check your inbox for password reset instructions."
        );
      } catch (err: any) {
        // Anti-enumeration: always show same message (don't reveal if email exists)
        Alert.alert(
          "Email Sent",
          "If an account exists with this email, you'll receive reset instructions."
        );
      } finally {
        setIsLoading(false);
      }
    },
    [sendPasswordReset]
  );

  /**
   * SIGN IN WITH COLLISION CREDENTIAL (useCallback)
   * Handle credential collision error by signing in with the colliding credential.
   *
   * SCENARIO:
   * 1. User has account A with email@gmail.com (via Email signup)
   * 2. User tries to link Google
   * 3. Google returns same email@gmail.com
   * 4. Firebase detects collision - this email already has Email provider
   * 5. collisionError is set (contains the credential from Google)
   * 6. User taps "Sign In" in collision UI
   * 7. This function uses stored credential to sign in to Account A
   *
   * AFTER COLLISION RESOLUTION:
   * - User logged into Account A
   * - Google credential is now linked (no more collision)
   * - Clear collision state to dismiss dialog
   *
   * DEPENDENCY: [collisionError, signInWithPendingCredential, handleError]
   */
  const signInWithCollisionCredential = useCallback(async () => {
    if (!collisionError?.pendingCredential) {
      return;
    }
    setIsLoading(true);
    try {
      await signInWithPendingCredential(collisionError.pendingCredential);
      setCollisionError(null);
    } catch (err: any) {
      handleError(err, "sign in");
    } finally {
      setIsLoading(false);
    }
  }, [collisionError, signInWithPendingCredential, handleError]);

  /**
   * RETURN VALUE - Interface for account settings screens
   *
   * STATE:
   * - linkedProviders: Currently linked sign-in methods (Google, Apple, Email)
   * - availableProviders: Methods that can still be added
   * - isLoading: Action in progress (show spinner on buttons)
   * - error: General error message from failed action
   * - collisionError: Special error when email already linked to different account
   *
   * ACTIONS:
   * - linkGoogleProvider/linkAppleProvider/linkEmailProvider(): Add sign-in method
   * - unlinkProviderById(id): Remove sign-in method (with safety check)
   * - switchGoogleAccount/switchAppleAccount(): Change which account linked
   * - changeEmailAddress(email, password): Update email for password login
   * - resetPassword(email): Send password reset email
   * - signInWithCollisionCredential(): Resolve email collision
   * - clearCollisionError(): Dismiss collision dialog
   */
  return {
    linkedProviders,
    availableProviders,
    isLoading,
    error,
    collisionError,
    clearCollisionError,
    linkGoogleProvider,
    linkAppleProvider,
    linkEmailProvider,
    unlinkProviderById,
    switchGoogleAccount,
    switchAppleAccount,
    changeEmailAddress,
    resetPassword,
    signInWithCollisionCredential,
  };
}
