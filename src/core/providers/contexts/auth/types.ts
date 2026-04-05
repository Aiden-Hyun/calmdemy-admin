import { User, AuthCredential } from "firebase/auth";

/**
 * ============================================================
 * types.ts — Auth Module Type Definitions (Interface Segregation)
 * ============================================================
 *
 * Architectural Role:
 *   This is the contract layer for the entire auth module. Every action
 *   factory (credentialActions, sessionActions, accountActions) and the
 *   AuthContext provider depend on these types. By centralizing type
 *   definitions here, we follow the Single Source of Truth principle —
 *   if the auth contract changes, there's exactly one file to update.
 *
 * Design Patterns:
 *   - Interface Segregation (SOLID "I"): AuthContextType is the public
 *     API surface that consumers see via useAuth(). It's intentionally
 *     flat — every method is at the top level — so consumers don't need
 *     to know which internal action factory owns which method.
 *   - Custom Error Class (CredentialCollisionError): A domain-specific
 *     exception that carries structured data (pendingCredential, providerType,
 *     email) instead of just a string message. This enables the UI layer to
 *     present provider-aware error recovery flows without parsing strings.
 *
 * Consumed By:
 *   - AuthContext.tsx (implements this interface)
 *   - Every screen/component that calls useAuth()
 *   - Action factories reference CredentialCollisionError for collision handling
 * ============================================================
 */

/**
 * Domain-specific error thrown when a credential link attempt collides
 * with an existing Firebase account.
 *
 * This is a classic Typed Exception pattern: instead of throwing a generic
 * Error and forcing callers to parse the message, we attach structured fields
 * (pendingCredential, providerType, email) that the UI can use directly.
 * For example, the sign-in screen can catch this error and offer the user
 * a "Sign in with your existing account, then link" recovery flow — using
 * pendingCredential to complete the link after re-authentication.
 *
 * @see credentialActions.ts — where this error is thrown on collision
 */
export class CredentialCollisionError extends Error {
  constructor(
    /** The OAuth/email credential that failed to link — hold onto it for retry */
    public readonly pendingCredential: AuthCredential,
    /** Discriminated union tag identifying which provider caused the collision */
    public readonly providerType: "google.com" | "apple.com" | "password",
    /** The email associated with the colliding account, if recoverable */
    public readonly email: string | null = null
  ) {
    super("This credential is already linked to another account");
    this.name = "CredentialCollisionError";
  }
}

/**
 * The public contract of the AuthContext provider.
 *
 * This interface acts as a Facade — it flattens methods from three internal
 * action factories (credential, session, account) into a single unified API.
 * Consumers call useAuth() and get this shape; they never import or know about
 * the action factories directly. This is Interface Segregation in practice:
 * the consumer sees one clean surface, while the implementation is decomposed
 * into cohesive modules behind the scenes.
 *
 * The methods are grouped logically (session lifecycle, credential acquisition,
 * anonymous-to-permanent upgrades, account management) even though TypeScript
 * interfaces are structurally flat.
 */
export interface AuthContextType {
  // --- Session state (read-only observables from Firebase Auth) ---
  user: User | null;
  loading: boolean;
  isAnonymous: boolean;
  // --- Session lifecycle (from sessionActions) ---
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInAnonymously: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  logout: () => Promise<void>;

  // --- Credential acquisition & linking (from credentialActions) ---
  linkAnonymousAccount: (credential: AuthCredential) => Promise<void>;
  isAppleSignInAvailable: boolean;
  signInWithPendingCredential: (credential: AuthCredential) => Promise<void>;
  getGoogleCredential: () => Promise<AuthCredential | null>;
  getAppleCredential: () => Promise<AuthCredential | null>;
  linkProvider: (
    providerType: "google.com" | "apple.com" | "password",
    emailPassword?: { email: string; password: string }
  ) => Promise<void>;

  // --- Anonymous-to-permanent upgrade flows (from credentialActions) ---
  upgradeAnonymousWithGoogle: () => Promise<void>;
  upgradeAnonymousWithApple: () => Promise<void>;
  upgradeAnonymousWithEmail: (email: string, password: string) => Promise<void>;

  // --- Account management (from accountActions) ---
  deleteAccount: (password?: string) => Promise<void>;
  unlinkProvider: (providerId: string) => Promise<void>;
  changeEmail: (newEmail: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  getLinkedProviders: () => string[];
}
