/**
 * @fileoverview Manager for Firebase Auth and RevenueCat subscription coordination.
 *
 * ARCHITECTURAL ROLE:
 * This manager implements the Mediator Pattern to keep Firebase authentication and
 * RevenueCat subscription identity in sync. It's the single source of truth for
 * subscription state and prevents auth/subscription mismatches.
 *
 * KEY RESPONSIBILITY:
 * - Firebase UID must always match RevenueCat customer ID
 * - Subscription entitlements are bound to user accounts, not devices
 * - Auth state changes (login/logout) trigger automatic identity sync
 * - Handles purchase restoration for cross-device subscriptions
 *
 * DESIGN PATTERNS:
 * - Mediator Pattern: Coordinates auth and subscription systems
 * - Lazy Loading: RevenueCat SDK loaded only when needed
 * - State Synchronization: Two-system consistency
 *
 * KEY FLOWS:
 * 1. User login -> syncRevenueCatIdentity(uid) -> verify entitlements
 * 2. User logout -> resetRevenueCatIdentity() -> clean state
 * 3. Restore purchases -> detect different_account scenario
 *
 * CONSUMERS:
 * - SubscriptionContext: Auth state listener hook
 * - Feature screens: Check hasPremiumEntitlement()
 * - App startup: Initial identity sync
 *
 * EXTERNAL DEPENDENCIES:
 * - firebase/auth: User identity
 * - react-native-purchases (RevenueCat): Subscription data
 * - env config: Premium entitlement ID
 */

import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { env } from "../core/config/env";

/**
 * Entitlement ID from RevenueCat config (env.revenuecat.entitlementId).
 * IMPORTANT: This must match the Entitlement Identifier in the RevenueCat dashboard,
 * NOT the product display name. Common ID format: "premium" or "pro_subscription".
 * Mismatch will cause hasPremiumEntitlement() to always return false.
 */
export const PREMIUM_ENTITLEMENT_ID = env.revenuecat.entitlementId;

/** Cached RevenueCat SDK module (lazy-loaded on first use) */
let Purchases: any = null;

/**
 * Lazy-loads the RevenueCat SDK on first access.
 *
 * WHY LAZY LOAD:
 * - RevenueCat is a React Native library, only available on native platforms
 * - Web/test environments may not have this library installed
 * - Deferring the import until needed prevents hard failures on unsupported platforms
 *
 * PATTERN:
 * - First call: imports module, caches it, returns true
 * - Subsequent calls: return true immediately (already cached)
 * - On import error: logs warning, returns false (graceful degradation)
 *
 * @returns Promise<boolean> - true if RevenueCat loaded successfully, false otherwise
 */
async function loadRevenueCat(): Promise<boolean> {
  if (Purchases) return true;
  try {
    const module = await import("react-native-purchases");
    Purchases = module.default;
    return true;
  } catch (error) {
    console.warn("[AuthSubscriptionManager] RevenueCat not available:", error);
    return false;
  }
}

/**
 * RevenueCat customer subscription and entitlement data.
 * This is a subset of the full RevenueCat CustomerInfo type, containing
 * fields relevant to Calmdemy's premium access logic.
 */
export interface CustomerInfo {
  /** Current active entitlements (one entry per active subscription product) */
  entitlements: {
    active: Record<string, any>;
  };
  /** Product IDs with currently active subscriptions */
  activeSubscriptions: string[];
  /** Product ID -> expiration date (ISO string or null) */
  allExpirationDates: Record<string, string | null>;
  /** Product ID -> purchase date (ISO string or null) */
  allPurchaseDates: Record<string, string | null>;
}

/**
 * Result of purchase restoration workflow.
 * Indicates whether user successfully recovered their subscription
 * and whether recovery wizard should be shown.
 */
export interface RestoreResult {
  /** true if restore was successful and entitlements granted to this account */
  success: boolean;
  /** Failure reason: "no_subscription" (nothing to restore) or "different_account" */
  reason?: "no_subscription" | "different_account";
  /** true if user should see Apple ID recovery flow to switch accounts */
  showRecoveryWizard?: boolean;
  /** Updated customer info after restore attempt */
  customerInfo?: CustomerInfo;
}

/**
 * Authenticates with RevenueCat and associates the current device/session
 * with a Firebase user account.
 *
 * BEHAVIOR:
 * - Calls Purchases.logIn(firebaseUid) to identify this user in RevenueCat
 * - Returns CustomerInfo if successful (entitlements loaded)
 * - Returns null if RevenueCat unavailable or network error
 *
 * USAGE:
 * - Call immediately after Firebase user authenticates (login flow)
 * - Call on app startup with current Firebase UID to reconnect
 * - Must happen before checking hasPremiumEntitlement()
 *
 * ERROR HANDLING:
 * - Logs errors to console but returns null rather than throwing
 * - Allows app to continue even if RevenueCat is unreachable
 * - Free users can use app without subscription data
 *
 * @param firebaseUid - Firebase user UID from auth.currentUser.uid
 * @returns Promise<CustomerInfo | null> - User's subscription data, or null on failure
 */
export async function syncRevenueCatIdentity(
  firebaseUid: string
): Promise<CustomerInfo | null> {
  const loaded = await loadRevenueCat();
  if (!loaded || !Purchases) {
    console.log("[AuthSubscriptionManager] RevenueCat not available for sync");
    return null;
  }

  try {
    const { customerInfo } = await Purchases.logIn(firebaseUid);
    console.log(
      "[AuthSubscriptionManager] Synced RevenueCat identity for UID:",
      firebaseUid
    );
    return customerInfo;
  } catch (error) {
    console.error("[AuthSubscriptionManager] Error syncing RevenueCat:", error);
    return null;
  }
}

/**
 * Clears RevenueCat authentication and resets to anonymous state.
 *
 * BEHAVIOR:
 * - Calls Purchases.logOut() to detach this device from the user account
 * - Device returns to anonymous state (no user-specific subscriptions)
 * - Subsequent calls to getCustomerInfo() will be anonymous
 *
 * USAGE:
 * - Call immediately when Firebase user logs out
 * - Call on account deletion to clean up RevenueCat state
 *
 * IDEMPOTENCY:
 * - Safe to call even if not currently logged in
 * - Safe to call if RevenueCat is unavailable
 *
 * @returns Promise<void> - Resolves when logout completes; errors are logged silently
 */
export async function resetRevenueCatIdentity(): Promise<void> {
  const loaded = await loadRevenueCat();
  if (!loaded || !Purchases) return;

  try {
    await Purchases.logOut();
    console.log("[AuthSubscriptionManager] Reset RevenueCat identity");
  } catch (error) {
    console.error(
      "[AuthSubscriptionManager] Error resetting RevenueCat:",
      error
    );
  }
}

/**
 * Synchronizes auth and subscription state during Firebase auth changes.
 *
 * FLOW:
 * - User logout (user=null): calls resetRevenueCatIdentity(), returns null
 * - User login (user=User): calls syncRevenueCatIdentity(uid), returns CustomerInfo
 *
 * USE CASE:
 * - Typically called from onAuthStateChanged() listener
 * - Ensures subscription state stays consistent with auth state
 *
 * @param user - Firebase user object (null if logged out)
 * @returns Promise<CustomerInfo | null> - Updated subscription data or null
 */
export async function handleAuthStateChange(
  user: User | null
): Promise<CustomerInfo | null> {
  if (!user) {
    await resetRevenueCatIdentity();
    return null;
  }
  return syncRevenueCatIdentity(user.uid);
}

/**
 * Checks if CustomerInfo contains the premium entitlement.
 *
 * LOGIC:
 * - Looks up PREMIUM_ENTITLEMENT_ID in the active entitlements map
 * - Returns true if the key exists (entitlement is active)
 * - Returns false if key missing or undefined
 *
 * PERFORMANCE:
 * - Synchronous function (no async overhead)
 * - Safe to call in renders
 * - Requires CustomerInfo to be already loaded from syncRevenueCatIdentity()
 *
 * @param customerInfo - RevenueCat customer data from syncRevenueCatIdentity()
 * @returns boolean - true if user has active premium entitlement
 */
export function hasPremiumEntitlement(customerInfo: CustomerInfo): boolean {
  return (
    typeof customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !==
    "undefined"
  );
}

/**
 * Detect if the Apple ID has an active subscription that this account doesn't own.
 * Uses the most direct signals available in CustomerInfo.
 *
 * Priority order (most reliable first):
 * 1. activeSubscriptions array - contains product IDs currently active
 * 2. Check entitlements for any active entitlement (covers edge cases)
 * 3. Fall back to allExpirationDates with future expiration
 *
 * Note: allPurchaseDates alone is insufficient as it includes expired/cancelled
 */
export function detectActiveSubscriptionOnAppleId(
  customerInfo: CustomerInfo
): boolean {
  // 1. Best signal: activeSubscriptions contains product IDs currently active
  if (
    customerInfo.activeSubscriptions &&
    customerInfo.activeSubscriptions.length > 0
  ) {
    return true;
  }

  // 2. Check if any entitlement is active (covers edge cases)
  const anyActiveEntitlement =
    Object.keys(customerInfo.entitlements?.active || {}).length > 0;
  if (anyActiveEntitlement) {
    return true;
  }

  // 3. Fallback: Check expiration dates for non-expired subscriptions
  const now = new Date();
  const expirationDates = customerInfo.allExpirationDates || {};
  for (const [, expirationDate] of Object.entries(expirationDates)) {
    if (expirationDate && new Date(expirationDate) > now) {
      return true;
    }
  }

  // No active subscription detected - don't send user to recovery wizard
  return false;
}

/**
 * Retrieves current subscription data from RevenueCat cache.
 *
 * BEHAVIOR:
 * - Returns in-memory cached CustomerInfo (no network call)
 * - May be stale if subscriptions changed on another device
 * - For fresh data, call syncRevenueCatIdentity() first
 *
 * USAGE:
 * - Quick checks after login (already synced)
 * - Periodic polling to detect subscription changes
 * - Don't use during critical flows (use syncRevenueCatIdentity for fresh data)
 *
 * @returns Promise<CustomerInfo | null> - Cached customer info, or null if unavailable
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  const loaded = await loadRevenueCat();
  if (!loaded || !Purchases) return null;

  try {
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.error(
      "[AuthSubscriptionManager] Error getting customer info:",
      error
    );
    return null;
  }
}

/**
 * Attempts to restore subscriptions from the device's Apple ID.
 *
 * WORKFLOW:
 * 1. Calls Purchases.restorePurchases() to fetch Apple ID subscriptions
 * 2. Checks if current account has the premium entitlement
 * 3. If yes: returns success (restore completed)
 * 4. If no: checks for active subscription on different account
 *    - If found: returns different_account with recovery wizard flag
 *    - If not found: returns no_subscription
 *
 * RECOVERY SCENARIO:
 * - User has subscription on Apple ID but it's tied to different Firebase account
 * - restorePurchasesWithRecovery() detects this mismatch
 * - App shows recovery wizard to prompt user to switch Apple IDs
 * - Prevents accidental loss of paid subscriptions
 *
 * ERROR HANDLING:
 * - Returns { success: false, reason: "no_subscription" } on error
 * - Does not throw exceptions (graceful degradation)
 *
 * @returns Promise<RestoreResult> - Restore status, reason, and recovery flag
 */
export async function restorePurchasesWithRecovery(): Promise<RestoreResult> {
  const loaded = await loadRevenueCat();
  if (!loaded || !Purchases) {
    return { success: false, reason: "no_subscription" };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();

    // Check if current account has the entitlement
    const hasEntitlement = hasPremiumEntitlement(customerInfo);
    if (hasEntitlement) {
      return { success: true, customerInfo };
    }

    // Check if Apple ID has an active subscription that this account doesn't own
    const hasActiveOnAppleId = detectActiveSubscriptionOnAppleId(customerInfo);
    if (hasActiveOnAppleId) {
      return {
        success: false,
        reason: "different_account",
        showRecoveryWizard: true,
        customerInfo,
      };
    }

    return { success: false, reason: "no_subscription", customerInfo };
  } catch (error) {
    console.error("[AuthSubscriptionManager] Error restoring purchases:", error);
    return { success: false, reason: "no_subscription" };
  }
}

/**
 * Creates a persistent listener for Firebase auth state changes.
 *
 * BEHAVIOR:
 * - Subscribes to onAuthStateChanged() from Firebase
 * - On auth change: calls handleAuthStateChange() to sync RevenueCat
 * - On sync complete: calls onCustomerInfoUpdate callback with new subscription data
 * - Listener persists until unsubscribe function is called
 *
 * USAGE PATTERN:
 * - Typically called in app root/startup (SubscriptionContext)
 * - Unsubscribe function should be saved and called on app cleanup
 *
 * EXAMPLE:
 * const unsubscribe = createAuthSubscriptionListener((customerInfo) => {
 *   console.log("Subscription data updated", customerInfo);
 * });
 * // On app exit:
 * unsubscribe();
 *
 * @param onCustomerInfoUpdate - Optional callback fired when subscription data changes
 * @returns () => void - Unsubscribe function; call to remove listener
 */
export function createAuthSubscriptionListener(
  onCustomerInfoUpdate?: (customerInfo: CustomerInfo | null) => void
): () => void {
  return onAuthStateChanged(auth, async (user) => {
    const customerInfo = await handleAuthStateChange(user);
    onCustomerInfoUpdate?.(customerInfo);
  });
}
