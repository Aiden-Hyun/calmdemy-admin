/**
 * AuthSubscriptionManager
 *
 * Coordinates Firebase Auth with RevenueCat identity to ensure:
 * 1. RevenueCat customer ID always matches Firebase UID
 * 2. Subscription entitlements are account-bound, not device-bound
 * 3. Auth state changes trigger RevenueCat identity sync
 */

import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { env } from "../core/config/env";

// Entitlement ID configured in RevenueCat dashboard
// IMPORTANT: Verify this matches the actual Entitlement Identifier in RevenueCat,
// not the display name (often something simple like "premium")
export const PREMIUM_ENTITLEMENT_ID = env.revenuecat.entitlementId;

// Lazy-loaded RevenueCat module
let Purchases: any = null;

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

export interface CustomerInfo {
  entitlements: {
    active: Record<string, any>;
  };
  activeSubscriptions: string[];
  allExpirationDates: Record<string, string | null>;
  allPurchaseDates: Record<string, string | null>;
}

export interface RestoreResult {
  success: boolean;
  reason?: "no_subscription" | "different_account";
  showRecoveryWizard?: boolean;
  customerInfo?: CustomerInfo;
}

/**
 * Sync RevenueCat identity with Firebase UID.
 * Call this after Firebase auth state is ready.
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
 * Reset RevenueCat identity (logout).
 * Call this when Firebase user logs out.
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
 * Handle Firebase auth state changes and sync RevenueCat identity.
 * Returns the customer info if sync was successful.
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
 * Check if current user has premium entitlement.
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
 * Get current customer info from RevenueCat.
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
 * Restore purchases and determine the appropriate result.
 * This handles the case where a subscription exists on the Apple ID
 * but belongs to a different Firebase account.
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
 * Create a listener for Firebase auth state changes that syncs RevenueCat.
 * Returns an unsubscribe function.
 */
export function createAuthSubscriptionListener(
  onCustomerInfoUpdate?: (customerInfo: CustomerInfo | null) => void
): () => void {
  return onAuthStateChanged(auth, async (user) => {
    const customerInfo = await handleAuthStateChange(user);
    onCustomerInfoUpdate?.(customerInfo);
  });
}
