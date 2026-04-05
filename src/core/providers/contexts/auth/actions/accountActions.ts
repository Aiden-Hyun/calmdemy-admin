import {
  AuthCredential,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  unlink,
  updateEmail,
  User,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { auth } from "@/firebase";
import { deleteUserAccount } from "@features/profile/data/profileRepository";
import { deleteAllDownloads } from "@/services/downloadService";

/**
 * ============================================================
 * accountActions.ts — Account Management & Lifecycle
 *                     (Factory Method + Dependency Injection)
 * ============================================================
 *
 * Architectural Role:
 *   This factory handles operations that modify the user's account itself:
 *   linking/unlinking providers, changing email, password resets, and the
 *   most sensitive operation — account deletion. These are distinguished
 *   from session actions (which create/destroy sessions) and credential
 *   actions (which acquire and link credentials).
 *
 * Design Patterns:
 *   - Factory Method + DI: Same pattern as the sibling factories.
 *   - Chain of Responsibility: deleteAccount walks through provider types
 *     in priority order (email → Google → Apple) to find a valid
 *     re-authentication path. Each branch either handles re-auth or
 *     passes to the next.
 *   - Defensive Teardown: deleteAccount performs a multi-phase cleanup
 *     (server data → local downloads → AsyncStorage → Google session →
 *     Firebase user) with each phase isolated so failures in one don't
 *     block the others.
 *   - Invariant Guard: unlinkProvider prevents removing the last auth
 *     provider, enforcing the business invariant that every account must
 *     have at least one sign-in method.
 *
 * Key Dependencies:
 *   - firebase/auth (reauthenticate, updateEmail, unlink, sendPasswordResetEmail)
 *   - profileRepository.deleteUserAccount (server-side user data cleanup)
 *   - downloadService.deleteAllDownloads (local offline content cleanup)
 *   - AsyncStorage (local key-value store cleanup)
 *
 * Consumed By:
 *   AuthContext.tsx (constructs this factory with useMemo, wires into context)
 * ============================================================
 */

/**
 * Dependencies for the account action factory.
 * Receives both user accessors and credential acquisition functions,
 * since account operations like deleteAccount need to re-authenticate
 * before performing destructive actions (Firebase security requirement).
 */
interface AccountActionDeps {
  getCurrentUser: () => User | null;
  requireAuthenticatedUser: () => User;
  getGoogleCredential: () => Promise<AuthCredential | null>;
  getAppleCredential: () => Promise<AuthCredential | null>;
}

/**
 * Factory function that constructs the account action bundle.
 *
 * @param deps - User accessors + credential strategies for re-authentication
 * @returns An object of account management functions
 */
export function createAccountActions({
  getCurrentUser,
  requireAuthenticatedUser,
  getGoogleCredential,
  getAppleCredential,
}: AccountActionDeps) {
  /**
   * Removes an auth provider from the user's account.
   *
   * Invariant Guard: the providers.length <= 1 check enforces a critical
   * business rule — every account must retain at least one sign-in method.
   * Without this guard, a user could unlink their last provider and lock
   * themselves out permanently. This is the Precondition pattern: validate
   * the invariant before performing the destructive operation.
   *
   * @param providerId - The Firebase provider ID to unlink (e.g., "google.com")
   */
  const unlinkProvider = async (providerId: string): Promise<void> => {
    const currentUser = requireAuthenticatedUser();
    const providers = currentUser.providerData.map((provider) => provider.providerId);

    if (providers.length <= 1) {
      throw new Error("Cannot remove the last sign-in method");
    }

    await unlink(currentUser, providerId);
  };

  /**
   * Changes the user's email address after re-authentication.
   *
   * Firebase requires recent authentication for sensitive operations like
   * email changes — this is Firebase's "step-up authentication" security
   * model. We reauthenticate with the user's current email + password first,
   * then call updateEmail. If the re-auth fails (wrong password, stale token),
   * the error propagates to the UI for the user to retry.
   *
   * @param newEmail - The new email address to set
   * @param password - The user's current password (for re-authentication)
   */
  const changeEmail = async (newEmail: string, password: string): Promise<void> => {
    const currentUser = requireAuthenticatedUser();

    if (!currentUser.email) {
      throw new Error("No user with email is currently signed in");
    }

    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
    await updateEmail(currentUser, newEmail);
  };

  /** Sends a password reset email via Firebase Auth. Thin Facade over the SDK. */
  const sendPasswordReset = async (email: string): Promise<void> => {
    await sendPasswordResetEmail(auth, email);
  };

  /**
   * Returns the list of provider IDs linked to the current user.
   *
   * This is a synchronous read (no async/await) because Firebase's User
   * object holds providerData in memory. Returns an empty array for
   * unauthenticated users — a Null Object pattern that lets callers skip
   * null-checking.
   */
  const getLinkedProviders = (): string[] => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      return [];
    }
    return currentUser.providerData.map((provider) => provider.providerId);
  };

  /**
   * Permanently deletes the user's account and all associated data.
   *
   * This is the most complex operation in the auth module — a multi-phase
   * Defensive Teardown that must:
   * 1. Re-authenticate (Firebase security requirement for destructive ops)
   * 2. Delete server-side user data (Firestore documents via Cloud Function)
   * 3. Delete local offline downloads
   * 4. Purge AsyncStorage (preserving theme preference for returning users)
   * 5. Sign out of Google (cleanup native SDK state)
   * 6. Delete the Firebase user object
   *
   * The re-authentication phase uses a Chain of Responsibility pattern:
   * it walks through provider types (email → Google → Apple) and uses
   * whichever one the user has linked. If none match (e.g., anonymous user
   * with no linked providers), it attempts deletion without re-auth.
   *
   * @param password - Required if the user has an email/password provider linked
   */
  const deleteAccount = async (password?: string) => {
    const currentUser = requireAuthenticatedUser();
    const userId = currentUser.uid;
    const providerIds = currentUser.providerData.map((provider) => provider.providerId);

    // --- Phase 1: Determine re-authentication strategy ---
    // Provider flags drive the Chain of Responsibility for re-auth
    const isEmailProvider = providerIds.includes("password");
    const isGoogleProvider = providerIds.includes("google.com");
    const isAppleProvider = providerIds.includes("apple.com");

    try {
      // --- Phase 2: Re-authenticate with the appropriate provider ---
      if (isEmailProvider && password) {
        if (!currentUser.email) {
          throw new Error("No user with email is currently signed in");
        }
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
      } else if (isGoogleProvider) {
        const googleCredential = await getGoogleCredential();
        if (!googleCredential) {
          throw new Error("Failed to get Google token for re-authentication");
        }
        await reauthenticateWithCredential(currentUser, googleCredential);
      } else if (isAppleProvider) {
        const appleCredential = await getAppleCredential();
        if (!appleCredential) {
          throw new Error("Failed to get Apple token for re-authentication");
        }
        await reauthenticateWithCredential(currentUser, appleCredential);
      } else if (!isEmailProvider && !isGoogleProvider && !isAppleProvider) {
        console.warn("Unknown auth provider, attempting deletion without re-auth");
      }

      // --- Phase 3: Delete server-side user data (Firestore cleanup) ---
      await deleteUserAccount(userId);

      // --- Phase 4: Delete locally cached offline content ---
      await deleteAllDownloads();

      // --- Phase 5: Purge AsyncStorage while preserving essential keys ---
      // We keep @theme_mode so returning users don't lose their dark/light
      // preference — a small UX kindness. Everything else (tokens, cache,
      // onboarding state) is swept clean. This is a Selective Teardown pattern.
      const keysToKeep = ["@theme_mode"];
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToRemove = allKeys.filter((key) => !keysToKeep.includes(key));

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }

      // --- Phase 6: Clean up native Google SDK state ---
      try {
        await GoogleSignin.signOut();
      } catch {
        // Expected: user may not have signed in with Google — safe to ignore
      }

      // --- Phase 7: Delete the Firebase user object (point of no return) ---
      await currentUser.delete();
    } catch (error: any) {
      // --- Error translation: convert Firebase error codes into user-friendly messages ---
      // This is the Adapter pattern for error handling — Firebase's raw error codes
      // are meaningless to end users, so we translate them into actionable messages.
      if (error?.code === "auth/requires-recent-login") {
        throw new Error("Please sign out and sign back in, then try again.");
      }
      if (error?.code === "auth/wrong-password") {
        throw new Error("Incorrect password. Please try again.");
      }
      throw error;
    }
  };

  return {
    unlinkProvider,
    changeEmail,
    sendPasswordReset,
    getLinkedProviders,
    deleteAccount,
  };
}
