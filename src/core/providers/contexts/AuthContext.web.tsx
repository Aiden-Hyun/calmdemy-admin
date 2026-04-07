/**
 * ============================================================
 * AuthContext.web.tsx — Web-Specific Auth Provider
 *                       (Platform-Specific Implementation)
 * ============================================================
 *
 * Architectural Role:
 *   This is the web (browser) variant of AuthContext.tsx. React Native apps
 *   on iOS/Android use AuthContext.tsx; web apps use this file. Both implement
 *   the same AuthContextType interface, so consumers never know which platform
 *   they're on — they just call useAuth().
 *
 *   This is the Strategy Pattern applied to the entire auth system: different
 *   platforms (native vs web) have completely different implementations, but
 *   unified interfaces via AuthContextType.
 *
 * Key Differences from Native:
 *   - OAuth flows use popups (linkWithPopup, signInWithPopup) instead of
 *     native SDK calls — web browsers can't launch native sign-in sheets
 *   - No Apple Sign-In support yet (commented as "not available in web admin")
 *   - All auth operations are direct useCallbacks (no action factories)
 *   - Simpler structure since web has fewer platform quirks (no native modules)
 *
 * Design Patterns:
 *   - Strategy Pattern: Different platform-specific implementation, same interface
 *   - Provider Pattern: exposes context and useAuth hook
 *   - Simple Factory: useCallbacks construct credentials and execute auth ops
 *
 * Consumed By:
 *   - Web admin dashboard components (if accessed via browser)
 * ============================================================
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  type AuthCredential,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  signInAnonymously as firebaseSignInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  unlink,
  updateEmail,
  type User,
} from 'firebase/auth';

import { auth } from '@/firebase';
import { deleteUserAccount } from '@features/profile/data/profileRepository';
import { deleteAllDownloads } from '@/services/downloadService';
import {
  AuthContextType,
  CredentialCollisionError,
} from '@core/providers/contexts/auth/types';

export { CredentialCollisionError } from '@core/providers/contexts/auth/types';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Factory function: constructs a GoogleAuthProvider with web-specific settings.
 *
 * The prompt: 'select_account' parameter tells Google to show the account picker
 * even if the user is already signed in. This is better UX on web where users
 * may have multiple Google accounts.
 *
 * This is extracted into a function so we don't create a new provider instance
 * for every callback — we create a fresh one each time, but the logic is reusable.
 */
function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

/**
 * Helper: generates an error message for OAuth methods not supported on web.
 *
 * Web auth works via popups/redirects, not native SDK calls. Methods like
 * getGoogleCredential (which use the native Google SDK) don't make sense
 * on web, so we throw with a helpful message.
 */
function createUnsupportedCredentialMessage(provider: 'google' | 'apple') {
  return `${provider === 'google' ? 'Google' : 'Apple'} credentials are popup-based on web.`;
}

/**
 * Web variant of AuthProvider — simpler than native because there's no native
 * platform-specific setup (no GoogleSignin.configure, no Apple availability check).
 *
 * All auth operations are direct useCallbacks that wrap Firebase methods.
 * No external action factories like the native variant.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Subscribe to Firebase Auth state changes.
   *
   * Same pattern as the native version: onAuthStateChanged returns an unsubscribe
   * function that we return from the effect cleanup. This subscription lasts for
   * the lifetime of the provider.
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const requireAuthenticatedUser = useCallback((): User => {
    if (!user) {
      throw new Error('No user is currently signed in');
    }
    return user;
  }, [user]);

  const requireAnonymousUser = useCallback((): User => {
    const currentUser = requireAuthenticatedUser();
    if (!currentUser.isAnonymous) {
      throw new Error('User is not anonymous');
    }
    return currentUser;
  }, [requireAuthenticatedUser]);

  const getCurrentUser = useCallback(() => user, [user]);

  const signUp = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signInAnonymously = useCallback(async () => {
    await firebaseSignInAnonymously(auth);
  }, []);

  /**
   * Sign in with Google via popup (web-specific strategy).
   *
   * On web, OAuth flows happen via popups or redirects. signInWithPopup opens
   * a popup window where the user signs in with Google, then returns a credential.
   * This is completely different from native, which uses the Google SDK to launch
   * a native sign-in sheet.
   */
  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, createGoogleProvider());
  }, []);

  /**
   * Apple Sign-In is not yet implemented for web.
   *
   * This is a conscious limitation — the team can add it later by implementing
   * a similar popup flow. For now, it throws a clear error.
   */
  const signInWithApple = useCallback(async () => {
    throw new Error('Apple Sign In is not available in the Calmdemy web admin yet.');
  }, []);

  const linkAnonymousAccount = useCallback(
    async (credential: AuthCredential) => {
      await linkWithCredential(requireAnonymousUser(), credential);
    },
    [requireAnonymousUser]
  );

  /**
   * Upgrade anonymous account to Google via popup (web-specific strategy).
   *
   * linkWithPopup is the linking equivalent of signInWithPopup — it opens a
   * popup for the user to sign in with Google, then links that credential to
   * the current anonymous account. No collision handling here (web doesn't use
   * the CredentialCollisionError flow).
   */
  const upgradeAnonymousWithGoogle = useCallback(async () => {
    await linkWithPopup(requireAnonymousUser(), createGoogleProvider());
  }, [requireAnonymousUser]);

  /**
   * Apple upgrade is not yet supported on web.
   */
  const upgradeAnonymousWithApple = useCallback(async () => {
    throw new Error('Apple Sign In is not available in the Calmdemy web admin yet.');
  }, []);

  const upgradeAnonymousWithEmail = useCallback(
    async (email: string, password: string) => {
      const credential = EmailAuthProvider.credential(email, password);
      try {
        await linkWithCredential(requireAnonymousUser(), credential);
      } catch (error: unknown) {
        const firebaseError = error as { code?: string };
        if (firebaseError?.code === 'auth/credential-already-in-use') {
          throw new CredentialCollisionError(credential, 'password', email);
        }
        throw error;
      }
    },
    [requireAnonymousUser]
  );

  const signInWithPendingCredential = useCallback(async (credential: AuthCredential) => {
    await signInWithCredential(auth, credential);
  }, []);

  /**
   * getGoogleCredential is not supported on web.
   *
   * The native variant uses the Google SDK to acquire a credential that can be
   * passed to linkWithCredential. On web, we use linkWithPopup directly, which
   * handles the popup + credential + link in one call. There's no separate
   * credential-acquisition step.
   *
   * This method exists for API compatibility (AuthContextType requires it),
   * but throws to make it clear it's not usable on web.
   */
  const getGoogleCredential = useCallback(async (): Promise<AuthCredential | null> => {
    throw new Error(createUnsupportedCredentialMessage('google'));
  }, []);

  /**
   * getAppleCredential is not supported on web.
   */
  const getAppleCredential = useCallback(async (): Promise<AuthCredential | null> => {
    throw new Error(createUnsupportedCredentialMessage('apple'));
  }, []);

  const linkProvider = useCallback(
    async (
      providerType: 'google.com' | 'apple.com' | 'password',
      emailPassword?: { email: string; password: string }
    ) => {
      const currentUser = requireAuthenticatedUser();

      if (providerType === 'google.com') {
        await linkWithPopup(currentUser, createGoogleProvider());
        return;
      }

      if (providerType === 'apple.com') {
        throw new Error('Apple Sign In is not available in the Calmdemy web admin yet.');
      }

      if (!emailPassword) {
        throw new Error('Email and password are required to link this provider.');
      }

      const credential = EmailAuthProvider.credential(
        emailPassword.email,
        emailPassword.password
      );
      await linkWithCredential(currentUser, credential);
    },
    [requireAuthenticatedUser]
  );

  const unlinkProvider = useCallback(async (providerId: string) => {
    const currentUser = requireAuthenticatedUser();
    const providers = currentUser.providerData.map((provider) => provider.providerId);

    if (providers.length <= 1) {
      throw new Error('Cannot remove the last sign-in method');
    }

    await unlink(currentUser, providerId);
  }, [requireAuthenticatedUser]);

  /**
   * Change email with provider-specific re-authentication.
   *
   * Similar to the native variant, but web uses popup re-auth instead of
   * getting a credential and calling reauthenticateWithCredential. The
   * Chain of Responsibility pattern: try password first, then Google popup.
   *
   * Apple re-auth is not supported on web yet.
   */
  const changeEmail = useCallback(
    async (newEmail: string, password: string) => {
      const currentUser = requireAuthenticatedUser();
      const providers = currentUser.providerData.map((provider) => provider.providerId);

      if (providers.includes('password')) {
        if (!currentUser.email) {
          throw new Error('No user with email is currently signed in');
        }
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
      } else if (providers.includes('google.com')) {
        await reauthenticateWithPopup(currentUser, createGoogleProvider());
      } else {
        throw new Error('Changing email is only supported for password or Google accounts on web.');
      }

      await updateEmail(currentUser, newEmail);
    },
    [requireAuthenticatedUser]
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  const getLinkedProviders = useCallback((): string[] => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      return [];
    }
    return currentUser.providerData.map((provider) => provider.providerId);
  }, [getCurrentUser]);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const deleteAccount = useCallback(async (password?: string) => {
    const currentUser = requireAuthenticatedUser();
    const userId = currentUser.uid;
    const providerIds = currentUser.providerData.map((provider) => provider.providerId);

    try {
      if (providerIds.includes('password')) {
        if (!password || !currentUser.email) {
          throw new Error('Password is required to delete this account.');
        }
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
      } else if (providerIds.includes('google.com')) {
        await reauthenticateWithPopup(currentUser, createGoogleProvider());
      } else if (providerIds.includes('apple.com')) {
        throw new Error('Apple Sign In is not available in the Calmdemy web admin yet.');
      }

      await deleteUserAccount(userId);
      await deleteAllDownloads();
      await currentUser.delete();
    } catch (error: unknown) {
      const firebaseError = error as { code?: string };
      if (firebaseError?.code === 'auth/requires-recent-login') {
        throw new Error('Please sign out and sign back in, then try again.');
      }
      if (firebaseError?.code === 'auth/wrong-password') {
        throw new Error('Incorrect password. Please try again.');
      }
      throw error;
    }
  }, [requireAuthenticatedUser]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      isAnonymous: user?.isAnonymous ?? false,
      signUp,
      signIn,
      signInAnonymously,
      signInWithGoogle,
      signInWithApple,
      linkAnonymousAccount,
      isAppleSignInAvailable: false,
      logout,
      deleteAccount,
      upgradeAnonymousWithGoogle,
      upgradeAnonymousWithApple,
      upgradeAnonymousWithEmail,
      signInWithPendingCredential,
      getGoogleCredential,
      getAppleCredential,
      linkProvider,
      unlinkProvider,
      changeEmail,
      sendPasswordReset,
      getLinkedProviders,
    }),
    [
      user,
      loading,
      signUp,
      signIn,
      signInAnonymously,
      signInWithGoogle,
      signInWithApple,
      linkAnonymousAccount,
      logout,
      deleteAccount,
      upgradeAnonymousWithGoogle,
      upgradeAnonymousWithApple,
      upgradeAnonymousWithEmail,
      signInWithPendingCredential,
      getGoogleCredential,
      getAppleCredential,
      linkProvider,
      unlinkProvider,
      changeEmail,
      sendPasswordReset,
      getLinkedProviders,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
