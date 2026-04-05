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

function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function createUnsupportedCredentialMessage(provider: 'google' | 'apple') {
  return `${provider === 'google' ? 'Google' : 'Apple'} credentials are popup-based on web.`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, createGoogleProvider());
  }, []);

  const signInWithApple = useCallback(async () => {
    throw new Error('Apple Sign In is not available in the Calmdemy web admin yet.');
  }, []);

  const linkAnonymousAccount = useCallback(
    async (credential: AuthCredential) => {
      await linkWithCredential(requireAnonymousUser(), credential);
    },
    [requireAnonymousUser]
  );

  const upgradeAnonymousWithGoogle = useCallback(async () => {
    await linkWithPopup(requireAnonymousUser(), createGoogleProvider());
  }, [requireAnonymousUser]);

  const upgradeAnonymousWithApple = useCallback(async () => {
    throw new Error('Apple Sign In is not available in the Calmdemy web admin yet.');
  }, []);

  const upgradeAnonymousWithEmail = useCallback(
    async (email: string, password: string) => {
      const credential = EmailAuthProvider.credential(email, password);
      try {
        await linkWithCredential(requireAnonymousUser(), credential);
      } catch (error: any) {
        if (error?.code === 'auth/credential-already-in-use') {
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

  const getGoogleCredential = useCallback(async (): Promise<AuthCredential | null> => {
    throw new Error(createUnsupportedCredentialMessage('google'));
  }, []);

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
    } catch (error: any) {
      if (error?.code === 'auth/requires-recent-login') {
        throw new Error('Please sign out and sign back in, then try again.');
      }
      if (error?.code === 'auth/wrong-password') {
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
