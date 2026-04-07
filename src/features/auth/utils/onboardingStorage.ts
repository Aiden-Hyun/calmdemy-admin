/**
 * @fileoverview Onboarding state persistence utility for auth feature.
 *
 * ARCHITECTURAL ROLE:
 * Manages persistent local state for onboarding flow completion.
 * Uses React Native AsyncStorage (device-level key-value store).
 *
 * DESIGN PATTERNS:
 * - Facade Pattern: Abstracts AsyncStorage API with simple boolean interface
 * - Persistence Layer: Bridges app state with device storage
 * - Version Keying: Uses versioned key (v1) for safe migration if schema changes
 *
 * USE CASE:
 * - Skip onboarding screen on app restart if user already completed it
 * - Called from navigation logic to conditionally show onboarding flow
 *
 * PLATFORM NOTES:
 * - React Native: Persists to device's encrypted local storage
 * - Web/Expo: Uses browser localStorage
 * - AsyncStorage is async-only (no synchronous API)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// Versioned storage key to enable safe schema migration
// If onboarding structure changes, increment to "v2" and create migration
const ONBOARDING_SEEN_KEY = "calmdemy_onboarding_seen_v1";

/**
 * Checks if user has completed the onboarding flow.
 *
 * RETURN VALUE:
 * - true: User has seen onboarding (will skip on next app launch)
 * - false: User has never completed onboarding (show flow)
 *
 * ASYNC PATTERN:
 * - AsyncStorage queries are network-like operations
 * - Always await before checking navigation state
 *
 * @returns Promise<boolean> - true if onboarding seen, false otherwise
 */
export async function getHasSeenOnboarding(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
  return value === "true";
}

/**
 * Marks onboarding as complete.
 *
 * SIDE EFFECT:
 * - Persists "true" to device storage
 * - Called after user completes final onboarding screen
 * - Triggers app to skip onboarding on next launch
 *
 * @returns Promise<void>
 */
export async function markOnboardingSeen(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "true");
}
