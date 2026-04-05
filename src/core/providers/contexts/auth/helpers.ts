import { statusCodes } from "@react-native-google-signin/google-signin";

/**
 * ============================================================
 * helpers.ts — Auth Debugging & Error Classification Utilities
 * ============================================================
 *
 * Architectural Role:
 *   Cross-cutting utility functions shared across all auth action files.
 *   These helpers handle two concerns:
 *   1. Debug telemetry — sending structured auth events to a local
 *      ingestion endpoint during development (dev-only, zero prod impact).
 *   2. Error classification — normalizing platform-specific error codes
 *      into boolean predicates (isGoogleSignInCancelled, isAppleSignInCancelled).
 *
 * Design Patterns:
 *   - Predicate Functions: isGoogleSignInCancelled / isAppleSignInCancelled
 *     are pure predicate functions that encapsulate platform-specific error
 *     code knowledge. Callers don't need to know the raw error codes —
 *     they just ask "was this a cancellation?" This is a form of the
 *     Adapter pattern applied to error handling.
 *   - Feature Flag (Dev Guard): logAuthDebug uses __DEV__ as a compile-time
 *     feature flag to ensure debug traffic never reaches production.
 *
 * Consumed By:
 *   credentialActions.ts (debug logging + cancellation checks)
 * ============================================================
 */

/** Local dev endpoint for auth debug telemetry (never called in production) */
const AUTH_DEBUG_URL =
  "http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d";

interface AuthDebugEvent {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  /** Groups related log entries for hypothesis-driven debugging */
  hypothesisId?: string;
}

/**
 * Sends a structured debug event to the local auth telemetry endpoint.
 *
 * This is a dev-only fire-and-forget logger — the __DEV__ guard ensures
 * zero network traffic in production builds, and the .catch(() => {})
 * swallows any fetch failures silently so debug logging never disrupts
 * the actual auth flow. The hypothesisId field lets developers tag log
 * entries by the bug hypothesis they're investigating.
 */
export function logAuthDebug({
  location,
  message,
  data,
  hypothesisId = "",
}: AuthDebugEvent) {
  if (!__DEV__) return;

  fetch(AUTH_DEBUG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: "debug-session",
      hypothesisId,
    }),
  }).catch(() => {});
}

/**
 * Predicate: determines if a Google Sign-In error represents user cancellation.
 *
 * This Adapter function normalizes two different error representations into a
 * single boolean: the typed statusCodes.SIGN_IN_CANCELLED from the Google SDK,
 * and the raw Android status code "12501" which some device/OS combinations
 * return instead. Without this normalization, every call site would need to
 * know both codes — a violation of the DRY principle.
 */
export function isGoogleSignInCancelled(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === statusCodes.SIGN_IN_CANCELLED || code === "12501";
}

/**
 * Predicate: determines if an Apple Sign-In error represents user cancellation.
 *
 * Same Adapter pattern as isGoogleSignInCancelled — Expo's Apple Auth SDK can
 * return either "ERR_CANCELED" or "ERR_REQUEST_CANCELED" depending on the
 * cancellation path (user tapped Cancel vs. system dismissed the sheet).
 * This predicate shields callers from that inconsistency.
 */
export function isAppleSignInCancelled(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "ERR_CANCELED" || code === "ERR_REQUEST_CANCELED";
}
