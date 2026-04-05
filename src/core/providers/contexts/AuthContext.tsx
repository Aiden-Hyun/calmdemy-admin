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

// Configure Google Sign In
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  console.log('[Startup] AuthProvider rendering');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAppleSignInAvailable, setIsAppleSignInAvailable] = useState(false);

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

    return () => {
      isMounted = false;
    };
  }, []);

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

  const requireAuthenticatedUser = useCallback((): User => {
    if (!user) {
      throw new Error("No user is currently signed in");
    }
    return user;
  }, [user]);

  const requireAnonymousUser = useCallback((): User => {
    const currentUser = requireAuthenticatedUser();
    if (!currentUser.isAnonymous) {
      throw new Error("User is not anonymous");
    }
    return currentUser;
  }, [requireAuthenticatedUser]);

  const getCurrentUser = useCallback(() => user, [user]);

  const credentialActions = useMemo(
    () =>
      createCredentialActions({
        isAppleSignInAvailable,
        requireAuthenticatedUser,
        requireAnonymousUser,
      }),
    [isAppleSignInAvailable, requireAuthenticatedUser, requireAnonymousUser]
  );

  const sessionActions = useMemo(
    () =>
      createSessionActions({
        getGoogleCredential: credentialActions.getGoogleCredential,
        getAppleCredential: credentialActions.getAppleCredential,
      }),
    [credentialActions.getAppleCredential, credentialActions.getGoogleCredential]
  );

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

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      isAnonymous: user?.isAnonymous ?? false,
      signUp: sessionActions.signUp,
      signIn: sessionActions.signIn,
      signInAnonymously: sessionActions.signInAnonymously,
      signInWithGoogle: sessionActions.signInWithGoogle,
      signInWithApple: sessionActions.signInWithApple,
      linkAnonymousAccount: credentialActions.linkAnonymousAccount,
      isAppleSignInAvailable,
      logout: sessionActions.logout,
      deleteAccount: accountActions.deleteAccount,
      upgradeAnonymousWithGoogle: credentialActions.upgradeAnonymousWithGoogle,
      upgradeAnonymousWithApple: credentialActions.upgradeAnonymousWithApple,
      upgradeAnonymousWithEmail: credentialActions.upgradeAnonymousWithEmail,
      signInWithPendingCredential: credentialActions.signInWithPendingCredential,
      getGoogleCredential: credentialActions.getGoogleCredential,
      getAppleCredential: credentialActions.getAppleCredential,
      linkProvider: credentialActions.linkProvider,
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
