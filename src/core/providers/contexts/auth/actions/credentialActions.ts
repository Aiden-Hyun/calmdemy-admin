import {
  AuthCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  linkWithCredential,
  signInWithCredential,
  User,
} from "firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { auth } from "@/firebase";
import { CredentialCollisionError } from "@core/providers/contexts/auth/types";
import {
  isAppleSignInCancelled,
  isGoogleSignInCancelled,
  logAuthDebug,
} from "@core/providers/contexts/auth/helpers";
import { APPLE_SCOPES } from "@core/providers/contexts/auth/actions/constants";
import { isCredentialInUseError } from "@core/providers/contexts/auth/actions/utils";

/**
 * ============================================================
 * credentialActions.ts — Credential Acquisition & Account Linking
 *                        (Factory Method + Dependency Injection)
 * ============================================================
 *
 * Architectural Role:
 *   This is the most complex of the three action factories. It owns two
 *   responsibilities:
 *   1. **Credential acquisition** — getGoogleCredential / getAppleCredential
 *      talk to native OAuth SDKs and return Firebase-compatible AuthCredentials.
 *   2. **Account linking** — upgradeAnonymous*, linkProvider, linkAnonymousAccount
 *      attach credentials to existing Firebase users, handling the collision
 *      case where the credential already belongs to another account.
 *
 * Design Patterns:
 *   - Factory Method: createCredentialActions is a factory that takes its
 *     dependencies as an argument and returns a bundle of closures. This is
 *     Dependency Injection via closures — the factory doesn't import or
 *     instantiate its deps; they're handed in from the AuthProvider.
 *   - Strategy Pattern: getGoogleCredential and getAppleCredential are
 *     interchangeable credential-acquisition strategies. linkProvider uses
 *     a providerType discriminant to select which strategy to invoke.
 *   - Typed Exception: Every collision path throws a CredentialCollisionError
 *     instead of a raw Error, enabling type-safe recovery in the UI.
 *
 * Key Dependencies:
 *   - GoogleSignin (native Google OAuth flow)
 *   - expo-apple-authentication (native Apple Sign-In)
 *   - firebase/auth (linkWithCredential, signInWithCredential)
 *
 * Consumed By:
 *   AuthContext.tsx (constructs this factory with useMemo), sessionActions.ts
 *   (receives getGoogleCredential/getAppleCredential as injected deps)
 * ============================================================
 */

/**
 * Dependencies injected into the credential action factory.
 * This interface defines the "ports" this module needs — following the
 * Dependency Inversion Principle (SOLID "D"), it depends on abstractions
 * (function signatures) rather than concrete implementations.
 */
interface CredentialActionDeps {
  isAppleSignInAvailable: boolean;
  requireAuthenticatedUser: () => User;
  requireAnonymousUser: () => User;
}

/**
 * Factory function that constructs the credential action bundle.
 *
 * This follows the Factory Method pattern combined with Dependency Injection
 * via closures: the caller passes in the deps this module needs, and gets
 * back an object of action functions that close over those deps. This makes
 * the actions testable (you can pass mock deps) and ensures each factory
 * receives only the dependencies it actually needs (Interface Segregation).
 *
 * @param deps - The minimal set of capabilities this factory requires
 * @returns An object of credential-related action functions
 */
export function createCredentialActions({
  isAppleSignInAvailable,
  requireAuthenticatedUser,
  requireAnonymousUser,
}: CredentialActionDeps) {
  /**
   * Acquires a Google OAuth credential via the native sign-in flow.
   *
   * This is one of the two credential-acquisition Strategies. The flow:
   * 1. Check Google Play Services availability (Android-specific prerequisite)
   * 2. Launch the native Google sign-in sheet
   * 3. Extract the idToken from the result
   * 4. Wrap it in a Firebase-compatible GoogleAuthProvider.credential
   *
   * Returns null (not throw) on user cancellation — this is intentional.
   * Cancellation is a normal user action, not an error, so we use a
   * null return as a "soft abort" signal. Callers check for null and
   * gracefully bail out. Actual errors (network, config) still throw.
   */
  const getGoogleCredential = async (): Promise<AuthCredential | null> => {
    try {
      logAuthDebug({
        location: "AuthContext.tsx:getGoogleCredential:beforeSignIn",
        message: "About to call GoogleSignin.signIn",
        data: {
          currentUserId: auth.currentUser?.uid,
          isAnonymous: auth.currentUser?.isAnonymous,
        },
        hypothesisId: "E",
      });

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();

      logAuthDebug({
        location: "AuthContext.tsx:getGoogleCredential:afterSignIn",
        message: "GoogleSignin.signIn returned",
        data: {
          currentUserId: auth.currentUser?.uid,
          isAnonymous: auth.currentUser?.isAnonymous,
          hasIdToken: !!signInResult.data?.idToken,
        },
        hypothesisId: "E",
      });

      const idToken = signInResult.data?.idToken;
      if (!idToken) {
        return null;
      }

      return GoogleAuthProvider.credential(idToken);
    } catch (error: unknown) {
      if (isGoogleSignInCancelled(error)) {
        return null;
      }
      throw error;
    }
  };

  /**
   * Acquires an Apple OAuth credential via the native sign-in flow.
   *
   * The second credential-acquisition Strategy, symmetric with getGoogleCredential.
   * Uses Expo's AppleAuthentication SDK to launch the native Apple sign-in sheet,
   * then wraps the identity token in a Firebase OAuthProvider credential.
   *
   * Gatekeeper pattern: the availability check at the top is a precondition guard —
   * if Apple Sign-In isn't available on this device (Android, old iOS), we fail
   * fast with a clear error rather than letting the native SDK throw an opaque one.
   *
   * @returns A Firebase AuthCredential, or null if the user cancelled
   */
  const getAppleCredential = async (): Promise<AuthCredential | null> => {
    // Gatekeeper: fail fast if Apple Sign-In is unavailable on this platform
    if (!isAppleSignInAvailable) {
      throw new Error("Apple Sign In is not available on this device");
    }

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: APPLE_SCOPES,
      });

      const { identityToken } = credential;
      if (!identityToken) {
        return null;
      }

      const provider = new OAuthProvider("apple.com");
      return provider.credential({ idToken: identityToken });
    } catch (error: unknown) {
      if (isAppleSignInCancelled(error)) {
        return null;
      }
      throw error;
    }
  };

  /**
   * Links an externally-acquired credential to the current anonymous user.
   *
   * This is the low-level linking primitive — it trusts the caller to have
   * already acquired the credential and validated the user is anonymous.
   * The higher-level upgradeAnonymousWithGoogle/Apple/Email methods handle
   * the full flow including credential acquisition and collision detection.
   */
  const linkAnonymousAccount = async (credential: AuthCredential) => {
    const currentUser = requireAnonymousUser();
    await linkWithCredential(currentUser, credential);
  };

  /**
   * Upgrades an anonymous user to a Google-authenticated account.
   *
   * This is a Composite operation that orchestrates two sub-operations:
   * 1. Acquire a Google credential (via getGoogleCredential)
   * 2. Link it to the current anonymous user (via linkWithCredential)
   *
   * The critical complexity is collision handling: if the Google account
   * is already linked to a different Firebase user, Firebase throws
   * "auth/credential-already-in-use". We catch this and throw a
   * CredentialCollisionError — a domain-specific Typed Exception that
   * carries the pending credential and email, enabling the UI to offer
   * a "sign in to your existing account and merge" recovery flow.
   */
  const upgradeAnonymousWithGoogle = async (): Promise<void> => {
    const currentUser = requireAnonymousUser();

    logAuthDebug({
      location: "AuthContext.tsx:upgradeAnonymousWithGoogle:entry",
      message: "upgradeAnonymousWithGoogle called",
      data: {
        hasUser: !!currentUser,
        isAnonymous: currentUser.isAnonymous,
        userId: currentUser.uid,
      },
      hypothesisId: "A,E",
    });

    const credential = await getGoogleCredential();

    logAuthDebug({
      location: "AuthContext.tsx:upgradeAnonymousWithGoogle:afterGetCred",
      message: "Got Google credential",
      data: {
        hasCredential: !!credential,
        userStillAnonymous: currentUser.isAnonymous,
        userId: currentUser.uid,
      },
      hypothesisId: "E",
    });

    if (!credential) {
      throw new Error("User cancelled");
    }

    // --- Phase 2: Attempt to link credential to anonymous user ---
    // This is where collisions surface. Firebase's linkWithCredential will
    // reject if the credential is already associated with another account.
    try {
      logAuthDebug({
        location: "AuthContext.tsx:upgradeAnonymousWithGoogle:beforeLink",
        message: "About to call linkWithCredential",
        data: {
          userId: currentUser.uid,
          isAnonymous: currentUser.isAnonymous,
        },
        hypothesisId: "C",
      });

      await linkWithCredential(currentUser, credential);

      logAuthDebug({
        location: "AuthContext.tsx:upgradeAnonymousWithGoogle:linkSuccess",
        message: "linkWithCredential SUCCEEDED - no collision",
        data: { userId: currentUser.uid },
        hypothesisId: "C",
      });
    } catch (error: unknown) {
      const firebaseError = error as { code?: string; message?: string; name?: string };
      logAuthDebug({
        location: "AuthContext.tsx:upgradeAnonymousWithGoogle:linkError",
        message: "linkWithCredential threw error",
        data: {
          errorCode: firebaseError?.code,
          errorMessage: firebaseError?.message,
          errorName: firebaseError?.name,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error) as any),
        },
        hypothesisId: "B",
      });

      // --- Collision detection: convert Firebase error into a typed domain exception ---
      // The CredentialCollisionError carries the credential + email so the UI
      // can offer a recovery flow: "Sign in to your existing account, then link."
      if (firebaseError?.code === "auth/credential-already-in-use") {
        const googleUser = await GoogleSignin.getCurrentUser();
        const email = googleUser?.user?.email || null;
        throw new CredentialCollisionError(credential, "google.com", email);
      }

      throw error;
    }
  };

  /**
   * Upgrades an anonymous user to an Apple-authenticated account.
   *
   * Structurally mirrors upgradeAnonymousWithGoogle — same two-phase pattern
   * (acquire credential → link to anonymous user) with the same collision
   * detection. The main difference is that Apple credential acquisition is
   * inline here rather than delegated to getAppleCredential, because the
   * upgrade flow needs to capture the email from the Apple response for
   * the collision error — data that getAppleCredential doesn't expose.
   */
  const upgradeAnonymousWithApple = async (): Promise<void> => {
    const currentUser = requireAnonymousUser();

    if (!isAppleSignInAvailable) {
      throw new Error("Apple Sign In is not available on this device");
    }

    let appleEmail: string | null = null;
    let credential: AuthCredential;

    try {
      const appleResponse = await AppleAuthentication.signInAsync({
        requestedScopes: APPLE_SCOPES,
      });

      const { identityToken, email } = appleResponse;
      appleEmail = email || null;

      if (!identityToken) {
        throw new Error("User cancelled");
      }

      const provider = new OAuthProvider("apple.com");
      credential = provider.credential({ idToken: identityToken });
    } catch (error: unknown) {
      if (isAppleSignInCancelled(error)) {
        throw new Error("User cancelled");
      }
      throw error;
    }

    try {
      await linkWithCredential(currentUser, credential);
    } catch (error: unknown) {
      const firebaseError = error as { code?: string };
      if (firebaseError?.code === "auth/credential-already-in-use") {
        throw new CredentialCollisionError(credential, "apple.com", appleEmail);
      }
      throw error;
    }
  };

  /**
   * Upgrades an anonymous user to an email/password account.
   *
   * The simplest of the three upgrade paths — no native OAuth SDK involved.
   * EmailAuthProvider.credential constructs the credential synchronously from
   * the email and password, then linkWithCredential attaches it to the
   * anonymous user. Same collision detection pattern as the OAuth variants.
   */
  const upgradeAnonymousWithEmail = async (
    email: string,
    password: string
  ): Promise<void> => {
    const currentUser = requireAnonymousUser();
    const credential = EmailAuthProvider.credential(email, password);

    try {
      await linkWithCredential(currentUser, credential);
    } catch (error: unknown) {
      const firebaseError = error as { code?: string };
      if (isCredentialInUseError(firebaseError?.code)) {
        throw new CredentialCollisionError(credential, "password", email);
      }
      throw error;
    }
  };

  /**
   * Signs in with a credential that was previously captured during a collision.
   *
   * This is the second half of the collision recovery flow: after the user
   * re-authenticates with their existing account, the UI calls this method
   * with the pendingCredential from the CredentialCollisionError to complete
   * the originally-intended sign-in. This is the Retry pattern applied to
   * auth — store the failed intent, resolve the blocker, then retry.
   */
  const signInWithPendingCredential = async (credential: AuthCredential) => {
    await signInWithCredential(auth, credential);
  };

  /**
   * Links an additional auth provider to an already-authenticated (non-anonymous) user.
   *
   * This uses the Strategy pattern with a providerType discriminant to select
   * the correct credential-acquisition path: Google → getGoogleCredential,
   * Apple → getAppleCredential, password → EmailAuthProvider.credential.
   * Once the credential is acquired, the same linkWithCredential call handles
   * all three cases uniformly — a classic example of polymorphic dispatch.
   *
   * @param providerType - Which provider to link ("google.com", "apple.com", or "password")
   * @param emailPassword - Required when providerType is "password"
   */
  const linkProvider = async (
    providerType: "google.com" | "apple.com" | "password",
    emailPassword?: { email: string; password: string }
  ): Promise<void> => {
    const currentUser = requireAuthenticatedUser();

    let credential: AuthCredential | null = null;
    let providerEmail: string | null = null;

    if (providerType === "google.com") {
      credential = await getGoogleCredential();
      if (credential) {
        const googleUser = await GoogleSignin.getCurrentUser();
        providerEmail = googleUser?.user?.email || null;
      }
    } else if (providerType === "apple.com") {
      credential = await getAppleCredential();
    } else if (providerType === "password" && emailPassword) {
      credential = EmailAuthProvider.credential(
        emailPassword.email,
        emailPassword.password
      );
      providerEmail = emailPassword.email;
    }

    if (!credential) {
      return;
    }

    try {
      await linkWithCredential(currentUser, credential);
    } catch (error: unknown) {
      const firebaseError = error as { code?: string };
      if (isCredentialInUseError(firebaseError?.code)) {
        throw new CredentialCollisionError(credential, providerType, providerEmail);
      }
      throw error;
    }
  };

  return {
    getGoogleCredential,
    getAppleCredential,
    linkAnonymousAccount,
    upgradeAnonymousWithGoogle,
    upgradeAnonymousWithApple,
    upgradeAnonymousWithEmail,
    signInWithPendingCredential,
    linkProvider,
  };
}
