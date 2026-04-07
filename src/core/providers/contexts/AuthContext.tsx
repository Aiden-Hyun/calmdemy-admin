/**
 * ============================================================
 * AuthContext.tsx — Core Auth Provider (React Native/Expo)
 *                   (Provider Pattern + Composition Root)
 * ============================================================
 *
 * Architectural Role:
 *   This is the composition root for the entire auth system. It wires together
 *   three independently-tested action factories (credential, session, account),
 *   manages Firebase Auth lifecycle via onAuthStateChanged subscription, and
 *   exposes a unified AuthContextType API to the entire app via useAuth().
 *
 *   The component is a Composition Root in the Dependency Injection pattern —
 *   it assembles the full dependency graph and passes each factory only what it
 *   needs via carefully-scoped useMemo closures. Callers never see the factories
 *   directly; they see a flat AuthContextType surface that hides the internal
 *   decomposition.
 *
 * Design Patterns:
 *   - Provider Pattern: Exposes context and custom hook (useAuth) for consumers
 *   - Composition Root: Wires together all action factories and dependencies
 *   - Factory Method: Creates three independent action bundles via createXAction
 *   - Observer Pattern: Subscribes to Firebase onAuthStateChanged to reactively
 *     sync UI when auth state changes
 *   - Dependency Injection via Closures: useMemo closures capture only the
 *     dependencies each factory needs, preventing unnecessary re-renders
 *
 * Key Dependencies:
 *   - Firebase Auth (onAuthStateChanged subscription)
 *   - @react-native-google-signin (native Google sign-in)
 *   - expo-apple-authentication (native Apple sign-in)
 *   - Three action factories: credentialActions, sessionActions, accountActions
 *
 * Consumed By:
 *   - Every screen/component in the app (via useAuth hook)
 *   - Particularly: AuthNavigation, OnboardingScreen, SettingsScreen
 * ============================================================
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import { User, onAuthStateChanged } from "firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { auth } from "@/firebase";
import { env } from "@core/config/env";
import {
  AuthContextType,
  CredentialCollisionError,
} from "@core/providers/contexts/auth/types";
import { createCredentialActions } from "@core/providers/contexts/auth/actions/credentialActions";
import { createSessionActions } from "@core/providers/contexts/auth/actions/sessionActions";
import { createAccountActions } from "@core/providers/contexts/auth/actions/accountActions";

export { CredentialCollisionError } from "@core/providers/contexts/auth/types";

/**
 * Module-level initialization: Configure Google Sign-In SDK on first load.
 * This runs once when the module is imported (before components render).
 *
 * This is a side effect at module scope — not ideal from a pure FP perspective,
 * but necessary because the Google SDK requires one-time global configuration.
 * We log startup progress here for debugging provider mounting order.
 */
console.log('[Startup] AuthContext module loaded — configuring GoogleSignin');
if (!env.google.webClientId && !env.google.iosClientId) {
  console.warn("[Startup] Google Sign-In client IDs missing; check environment variables");
}
try {
  GoogleSignin.configure({
    webClientId: env.google.webClientId,
    iosClientId: env.google.iosClientId,
  });
  console.log('[Startup] GoogleSignin.configure() succeeded');
} catch (e) {
  console.error('[Startup] GoogleSignin.configure() threw:', e);
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider component — composes the entire auth system.
 *
 * This is the Provider Pattern in action: it manages auth state (user, loading,
 * Apple availability), sets up Firebase subscriptions, constructs three action
 * factories, and exposes everything via AuthContextType. Components consume
 * it via useAuth().
 *
 * @param children - React components that use useAuth within this subtree
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  console.log('[Startup] AuthProvider rendering');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAppleSignInAvailable, setIsAppleSignInAvailable] = useState(false);

  /**
   * Effect 1: Check Apple Sign-In availability (iOS only).
   *
   * The `isMounted` flag is a Race Condition guard — ensures that state updates
   * from async operations don't fire after the component unmounts, which would
   * cause React warnings. This is a common pattern in React effect cleanup.
   *
   * This runs once on mount (empty dependency array), checking availability
   * only if Platform.OS === 'ios'. On Android/web, Apple Sign-In is unavailable
   * so we skip the check.
   */
  useEffect(() => {
    console.log('[Startup] AuthProvider mounted — checking Apple auth availability');
    let isMounted = true;

    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync()
        .then((available) => {
          console.log('[Startup] Apple auth available:', available);
          if (isMounted) {
            setIsAppleSignInAvailable(available);
          }
        })
        .catch((e) => {
          console.warn('[Startup] Apple auth availability check failed:', e);
          if (isMounted) {
            setIsAppleSignInAvailable(false);
          }
        });
    }

    // Cleanup function: mark unmounted so async callback skips state update
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Effect 2: Subscribe to Firebase Auth state changes.
   *
   * This is the Observer Pattern applied to Firebase — onAuthStateChanged returns
   * an unsubscribe function that we return from the effect cleanup. Firebase fires
   * this callback immediately with the current user (even if null), then whenever
   * auth state changes (sign-in, sign-out, token refresh).
   *
   * The subscription automatically cleans up on unmount because we return the
   * unsubscribe function from the effect. This is the React effect cleanup pattern.
   *
   * Dependency array is empty: we want exactly one subscription for the lifetime
   * of the provider (from mount to unmount).
   */
  useEffect(() => {
    console.log('[Startup] Subscribing to Firebase onAuthStateChanged');
    try {
      const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        console.log('[Startup] onAuthStateChanged fired — user:', nextUser ? nextUser.uid : 'null');
        setUser(nextUser);
        setLoading(false);
      });
      console.log('[Startup] Firebase auth subscription active');
      return unsubscribe;
    } catch (e) {
      console.error('[Startup] onAuthStateChanged threw:', e);
      setLoading(false);
    }
  }, []);

  /**
   * Guard function: requires a non-null, authenticated user (not anonymous).
   *
   * This is the Precondition pattern — throw early if an invariant is violated.
   * Used by account actions to ensure operations like deleteAccount only run
   * when a real user is logged in (not an anonymous session).
   *
   * @throws Error if no user is signed in
   * @returns The current authenticated user
   */
  const requireAuthenticatedUser = useCallback((): User => {
    if (!user) {
      throw new Error("No user is currently signed in");
    }
    return user;
  }, [user]);

  /**
   * Guard function: requires an anonymous user (opposite of requireAuthenticatedUser).
   *
   * Used by credential actions during upgrade flows — we can only link/upgrade
   * an anonymous session, not a persistent one. If called on a persistent user,
   * this throws an error.
   *
   * @throws Error if user is not anonymous
   * @returns The current anonymous user
   */
  const requireAnonymousUser = useCallback((): User => {
    const currentUser = requireAuthenticatedUser();
    if (!currentUser.isAnonymous) {
      throw new Error("User is not anonymous");
    }
    return currentUser;
  }, [requireAuthenticatedUser]);

  /**
   * Simple accessor: return current user (null if not logged in).
   * Unlike require* guards, this doesn't throw. Used by actions that
   * gracefully handle null users.
   */
  const getCurrentUser = useCallback(() => user, [user]);

  /**
   * Construct the credential actions factory.
   *
   * This factory is MEMOIZED to prevent unnecessary re-renders of consumers.
   * The dependency array lists everything the factory needs: Apple availability,
   * user guards. If any dependency changes, the factory is reconstructed and
   * consumer components re-render. This is a critical performance optimization.
   *
   * The factory takes these deps as an argument, not imports them directly,
   * following Dependency Inversion (SOLID "D") — it depends on abstractions
   * (function interfaces), not concrete implementations.
   */
  const credentialActions = useMemo(
    () =>
      createCredentialActions({
        isAppleSignInAvailable,
        requireAuthenticatedUser,
        requireAnonymousUser,
      }),
    [isAppleSignInAvailable, requireAuthenticatedUser, requireAnonymousUser]
  );

  /**
   * Construct the session actions factory.
   *
   * This factory depends only on credential acquisition functions from
   * credentialActions. It doesn't need requireAuthenticatedUser or any other
   * dependencies — Interface Segregation in action. The dependency array
   * references only getGoogleCredential and getAppleCredential from the
   * credentialActions closure.
   */
  const sessionActions = useMemo(
    () =>
      createSessionActions({
        getGoogleCredential: credentialActions.getGoogleCredential,
        getAppleCredential: credentialActions.getAppleCredential,
      }),
    [credentialActions.getAppleCredential, credentialActions.getGoogleCredential]
  );

  /**
   * Construct the account actions factory.
   *
   * This is the "richest" factory — it needs user accessors and credential
   * functions for re-authentication during sensitive operations (email change,
   * account deletion). The dependencies are carefully scoped: only what this
   * factory actually uses.
   */
  const accountActions = useMemo(
    () =>
      createAccountActions({
        getCurrentUser,
        requireAuthenticatedUser,
        getGoogleCredential: credentialActions.getGoogleCredential,
        getAppleCredential: credentialActions.getAppleCredential,
      }),
    [
      credentialActions.getAppleCredential,
      credentialActions.getGoogleCredential,
      getCurrentUser,
      requireAuthenticatedUser,
    ]
  );

  /**
   * Flatten all action methods into a single AuthContextType value.
   *
   * This is the Facade pattern in action: consumers see one unified interface
   * (AuthContextType) that hides the three underlying factories. They call
   * useAuth() and get this flat surface. The implementation is decomposed for
   * testability and maintainability, but the API surface is simple.
   *
   * MEMOIZED to prevent unnecessary re-renders. The dependency array includes
   * every action method and state variable so that changes to any of them
   * trigger a new context value. React compares this value to the old value;
   * if they differ, all consumers re-render.
   *
   * This is one of the largest dependency arrays in the codebase — a sign that
   * we've properly decomposed the action factories (each has small dependencies).
   */
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      isAnonymous: user?.isAnonymous ?? false,
      // Session lifecycle (from sessionActions)
      signUp: sessionActions.signUp,
      signIn: sessionActions.signIn,
      signInAnonymously: sessionActions.signInAnonymously,
      signInWithGoogle: sessionActions.signInWithGoogle,
      signInWithApple: sessionActions.signInWithApple,
      logout: sessionActions.logout,
      // Credential acquisition & linking (from credentialActions)
      linkAnonymousAccount: credentialActions.linkAnonymousAccount,
      isAppleSignInAvailable,
      upgradeAnonymousWithGoogle: credentialActions.upgradeAnonymousWithGoogle,
      upgradeAnonymousWithApple: credentialActions.upgradeAnonymousWithApple,
      upgradeAnonymousWithEmail: credentialActions.upgradeAnonymousWithEmail,
      signInWithPendingCredential: credentialActions.signInWithPendingCredential,
      getGoogleCredential: credentialActions.getGoogleCredential,
      getAppleCredential: credentialActions.getAppleCredential,
      linkProvider: credentialActions.linkProvider,
      // Account management (from accountActions)
      deleteAccount: accountActions.deleteAccount,
      unlinkProvider: accountActions.unlinkProvider,
      changeEmail: accountActions.changeEmail,
      sendPasswordReset: accountActions.sendPasswordReset,
      getLinkedProviders: accountActions.getLinkedProviders,
    }),
    [
      accountActions.changeEmail,
      accountActions.deleteAccount,
      accountActions.getLinkedProviders,
      accountActions.sendPasswordReset,
      accountActions.unlinkProvider,
      credentialActions.getAppleCredential,
      credentialActions.getGoogleCredential,
      credentialActions.linkAnonymousAccount,
      credentialActions.linkProvider,
      credentialActions.signInWithPendingCredential,
      credentialActions.upgradeAnonymousWithApple,
      credentialActions.upgradeAnonymousWithEmail,
      credentialActions.upgradeAnonymousWithGoogle,
      isAppleSignInAvailable,
      loading,
      sessionActions.logout,
      sessionActions.signIn,
      sessionActions.signInAnonymously,
      sessionActions.signInWithApple,
      sessionActions.signInWithGoogle,
      sessionActions.signUp,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Custom hook: useAuth hook for accessing the auth context.
 *
 * This is the standard React Context API pattern. Consumers call this hook
 * (within an AuthProvider subtree) to get the AuthContextType API. If called
 * outside a provider, we throw an error — this is a runtime invariant check
 * that prevents subtle bugs where components forget to mount the provider.
 *
 * @throws Error if used outside an AuthProvider
 * @returns The AuthContextType context value
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
