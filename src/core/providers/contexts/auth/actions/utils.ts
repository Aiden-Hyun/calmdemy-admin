/**
 * ============================================================
 * utils.ts — Auth Action Shared Predicates
 * ============================================================
 *
 * Small utility predicates shared across the action factory modules.
 * Extracted here to follow DRY — both credentialActions and accountActions
 * need to detect credential collision errors from Firebase.
 * ============================================================
 */

/**
 * Predicate: checks if a Firebase error code indicates a credential collision.
 *
 * Firebase uses two distinct error codes for what is conceptually the same
 * problem ("this identity is already taken"):
 *   - "auth/credential-already-in-use" — the OAuth credential (Google/Apple)
 *     is already linked to a different Firebase account.
 *   - "auth/email-already-in-use" — the email address is already registered
 *     with a different sign-in method (e.g., email/password).
 *
 * This predicate normalizes both into a single check, which callers use to
 * decide whether to throw a CredentialCollisionError with structured recovery
 * data. This is the Adapter pattern applied to Firebase error classification.
 */
export function isCredentialInUseError(code?: string) {
  return code === "auth/credential-already-in-use" || code === "auth/email-already-in-use";
}
