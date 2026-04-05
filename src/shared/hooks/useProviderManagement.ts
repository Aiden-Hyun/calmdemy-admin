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

const PROVIDER_DISPLAY_INFO: Record<
  string,
  { displayName: string; icon: string }
> = {
  "google.com": { displayName: "Google", icon: "logo-google" },
  "apple.com": { displayName: "Apple", icon: "logo-apple" },
  password: { displayName: "Email & Password", icon: "mail" },
};

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

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collisionError, setCollisionError] =
    useState<CredentialCollisionError | null>(null);

  // Get linked providers from current user
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

  // Determine which providers can still be added
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

  const clearCollisionError = useCallback(() => {
    setCollisionError(null);
  }, []);

  const handleError = useCallback((err: any, action: string) => {
    if (err instanceof CredentialCollisionError) {
      setCollisionError(err);
      return;
    }
    console.error(`Error ${action}:`, err);
    setError(err.message || `Failed to ${action}`);
    Alert.alert("Error", err.message || `Failed to ${action}`);
  }, []);

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
        // Generic message for anti-enumeration
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
