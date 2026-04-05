import {
  AuthCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInAnonymously as firebaseSignInAnonymously,
  signInWithCredential,
} from "firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { auth } from "@/firebase";

/**
 * ============================================================
 * sessionActions.ts — Session Lifecycle Management
 *                     (Factory Method + Dependency Injection)
 * ============================================================
 *
 * Architectural Role:
 *   This factory owns the session lifecycle: creating new accounts (signUp),
 *   establishing sessions (signIn*), and tearing them down (logout). It's
 *   the simplest of the three action factories because it delegates credential
 *   acquisition to credentialActions — it only deals with Firebase session
 *   primitives (createUser, signIn, signOut).
 *
 * Design Patterns:
 *   - Factory Method + DI: Same pattern as credentialActions — dependencies
 *     are injected via the constructor argument, not imported directly.
 *     Notice that sessionActions receives getGoogleCredential and
 *     getAppleCredential as injected functions. This creates a clean
 *     dependency chain: AuthProvider → credentialActions → sessionActions,
 *     where each layer depends only on the abstractions it needs.
 *   - Facade: Each method wraps a Firebase SDK call in a simpler interface.
 *     For example, signInWithGoogle is a two-step operation (get credential →
 *     sign in) condensed into a single async call for the UI layer.
 *   - Null Object Pattern: signInWithGoogle/Apple return early (no-op) when
 *     the credential is null (user cancelled), rather than throwing.
 *
 * Key Dependencies:
 *   - firebase/auth (session primitives)
 *   - credentialActions (via injected getGoogleCredential, getAppleCredential)
 *
 * Consumed By:
 *   AuthContext.tsx (constructs this factory with useMemo, wires into context)
 * ============================================================
 */

/**
 * Dependencies this factory needs. Note how it only asks for the credential
 * acquisition functions — not the full credentialActions object. This is
 * Interface Segregation: sessionActions doesn't know about linking, upgrading,
 * or collision handling. It only knows how to get a credential and sign in.
 */
interface SessionActionDeps {
  getGoogleCredential: () => Promise<AuthCredential | null>;
  getAppleCredential: () => Promise<AuthCredential | null>;
}

/**
 * Factory function that constructs the session action bundle.
 *
 * @param deps - Credential acquisition strategies injected from credentialActions
 * @returns An object of session lifecycle functions
 */
export function createSessionActions({
  getGoogleCredential,
  getAppleCredential,
}: SessionActionDeps) {
  /** Creates a new Firebase account with email/password credentials. */
  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  /** Authenticates an existing user with email/password credentials. */
  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  /**
   * Creates an anonymous Firebase session.
   *
   * Anonymous auth is Calmdemy's "try before you buy" strategy — users get
   * a real Firebase UID and can use free content immediately, with the option
   * to upgrade to a permanent account later (see credentialActions.upgradeAnonymous*).
   * The import alias (firebaseSignInAnonymously) avoids naming collision with
   * this wrapper function.
   */
  const signInAnonymously = async () => {
    await firebaseSignInAnonymously(auth);
  };

  /**
   * Signs in with Google via a two-step flow: acquire credential → sign in.
   *
   * The null check on googleCredential implements the Null Object pattern —
   * if the user cancelled the Google sign-in sheet, we silently no-op rather
   * than throwing. This keeps the UI simple: it calls signInWithGoogle() and
   * doesn't need to distinguish between "cancelled" and "succeeded".
   */
  const signInWithGoogle = async () => {
    const googleCredential = await getGoogleCredential();
    if (!googleCredential) {
      return; // User cancelled — soft abort, not an error
    }
    await signInWithCredential(auth, googleCredential);
  };

  /** Signs in with Apple. Same two-step pattern as signInWithGoogle. */
  const signInWithApple = async () => {
    const appleCredential = await getAppleCredential();
    if (!appleCredential) {
      return; // User cancelled — soft abort
    }
    await signInWithCredential(auth, appleCredential);
  };

  /**
   * Tears down the current session.
   *
   * The Google sign-out is wrapped in a try/catch because the user may not
   * have signed in with Google — in that case, GoogleSignin.signOut() throws,
   * but that's expected and harmless. The Firebase signOut always runs regardless.
   * This is a Defensive Programming pattern: clean up what you can, ignore
   * what you can't, and ensure the critical operation (Firebase signOut) always
   * executes.
   */
  const logout = async () => {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Expected: user may not have signed in with Google — safe to ignore
    }
    await signOut(auth);
  };

  return {
    signUp,
    signIn,
    signInAnonymously,
    signInWithGoogle,
    signInWithApple,
    logout,
  };
}
