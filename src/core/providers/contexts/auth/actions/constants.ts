import * as AppleAuthentication from "expo-apple-authentication";

/**
 * ============================================================
 * constants.ts — Auth Module Constants (DRY Principle)
 * ============================================================
 *
 * Centralizes magic values used across multiple auth action files.
 * Extracting these into a constants module follows the DRY (Don't Repeat
 * Yourself) principle — if the requested OAuth scopes ever change,
 * there's exactly one place to update.
 * ============================================================
 */

/**
 * The OAuth scopes requested during Apple Sign-In.
 *
 * FULL_NAME and EMAIL are the two pieces of user data Apple can share
 * on the first sign-in. Note: Apple only provides this data once — on
 * subsequent sign-ins, the response may omit name and email even if
 * these scopes are requested. This is an Apple platform behavior, not
 * a bug in our code.
 */
export const APPLE_SCOPES = [
  AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
  AppleAuthentication.AppleAuthenticationScope.EMAIL,
];
