/**
 * ============================================================
 * SubscriptionContext.tsx — Subscription & In-App Purchase Management
 *                           (Lazy Loading + Graceful Degradation)
 * ============================================================
 *
 * Architectural Role:
 *   Manages premium subscription state and in-app purchases via RevenueCat.
 *   RevenueCat is a third-party SDK that abstracts away platform-specific
 *   purchase flows (iOS, Android) into a unified API.
 *
 *   This provider handles:
 *   1. RevenueCat initialization and configuration
 *   2. Syncing Firebase user ID with RevenueCat identity
 *   3. Checking premium entitlement status
 *   4. Handling purchases and restore flows
 *   5. Detecting lost subscriptions (e.g., subscription on different Apple ID)
 *
 * Design Patterns:
 *   - Provider Pattern: exposes subscription state and actions via useSubscription
 *   - Lazy Loading: RevenueCat module is loaded at module scope with try/catch,
 *     so crashes if the native module is missing don't crash the entire app
 *   - Graceful Degradation: if RevenueCat unavailable, context returns mock data
 *     (isPremium: false) and the app keeps working in demo mode
 *   - Dependency Injection: syncs with AuthContext to know which user is logged in
 *   - Event Subscription: listens to RevenueCat's customer info update events
 *
 * Key Dependencies:
 *   - react-native-purchases (RevenueCat SDK, optional native module)
 *   - AuthContext (depends on current logged-in user)
 *   - AuthSubscriptionManager (helper functions for sync, restore, detection)
 *
 * Consumed By:
 *   - Paywall screens (to show/hide premium content)
 *   - Settings screen (to show subscription status)
 * ============================================================
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { Alert } from "react-native";
import { useAuth } from "./AuthContext";
import {
  syncRevenueCatIdentity,
  resetRevenueCatIdentity,
  hasPremiumEntitlement,
  detectActiveSubscriptionOnAppleId,
  restorePurchasesWithRecovery,
  type CustomerInfo as ManagerCustomerInfo,
  type RestoreResult,
} from "@/managers/AuthSubscriptionManager";
import { env } from "@core/config/env";

// RevenueCat configuration from environment variables
const REVENUECAT_API_KEY = env.revenuecat.apiKey;
export const PREMIUM_ENTITLEMENT_ID = env.revenuecat.entitlementId;

/**
 * Module-level lazy loading: Load RevenueCat SDK with graceful fallback.
 *
 * This runs once when the module is imported, with a try/catch so if the
 * native RevenueCat module isn't available (testing, web, or missing dependency),
 * the app doesn't crash. Instead, it runs in "demo mode" with isPremium: false
 * hardcoded.
 *
 * This is Graceful Degradation: lose the purchase feature, but don't break
 * the entire app.
 */
let Purchases: any = null;
let LOG_LEVEL: any = null;

/**
 * Helper: Lazy load RevenueCat module on first use.
 *
 * This uses dynamic import() to defer loading until the provider initializes,
 * not at module load time. If the module is missing, returns false and the
 * provider runs in demo mode. Subsequent calls return true if already loaded.
 */
async function loadRevenueCat() {
  if (Purchases) return true;  // Already loaded, bail out
  try {
    const module = await import("react-native-purchases");
    Purchases = module.default;
    LOG_LEVEL = module.LOG_LEVEL;
    return true;
  } catch (error) {
    console.warn("RevenueCat not available (native module not installed):", error);
    return false;
  }
}

// Type definitions (since we're dynamically importing)
interface PurchasesPackage {
  identifier: string;
  product: {
    price: number;
    priceString: string;
    title: string;
    description: string;
  };
}

interface CustomerInfo {
  entitlements: {
    active: Record<string, any>;
  };
  activeSubscriptions: string[];
  allExpirationDates: Record<string, string | null>;
  allPurchaseDates: Record<string, string | null>;
}

interface PurchasesOffering {
  identifier: string;
  monthly?: PurchasesPackage;
  annual?: PurchasesPackage;
  availablePackages: PurchasesPackage[];
}

interface RestorePurchasesResult {
  success: boolean;
  reason?: "no_subscription" | "different_account";
  showRecoveryWizard?: boolean;
}

interface SubscriptionContextType {
  isPremium: boolean;
  isLoading: boolean;
  isAvailable: boolean;
  customerInfo: CustomerInfo | null;
  currentOffering: PurchasesOffering | null;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  restorePurchasesWithRecovery: () => Promise<RestorePurchasesResult>;
  checkSubscriptionStatus: () => Promise<void>;
  hasActiveSubscriptionOnAppleId: () => boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

/**
 * SubscriptionProvider component — initializes RevenueCat and manages subscriptions.
 */
export function SubscriptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Get current logged-in user from AuthContext
  const { user } = useAuth();

  // --- Subscription state ---
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [currentOffering, setCurrentOffering] =
    useState<PurchasesOffering | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastSyncedUid, setLastSyncedUid] = useState<string | null>(null);

  /**
   * Effect 1: Initialize RevenueCat SDK on mount.
   *
   * This effect runs once (empty dependency array) to:
   * 1. Load the RevenueCat native module
   * 2. Check for API key
   * 3. Configure log levels (WARN in dev, ERROR in prod)
   * 4. Set up custom log handler to filter expected errors
   * 5. Call Purchases.configure() with the API key
   * 6. Fetch available offerings
   *
   * If RevenueCat isn't available or API key is missing, we gracefully
   * degrade to demo mode (isPremium always false) without crashing.
   */
  useEffect(() => {
    const initRevenueCat = async () => {
      try {
        const loaded = await loadRevenueCat();
        if (!loaded || !Purchases) {
          if (__DEV__) console.log("RevenueCat not available, running in demo mode");
          setIsLoading(false);
          return;
        }

        if (!REVENUECAT_API_KEY) {
          console.warn("RevenueCat API key missing; skipping initialization");
          setIsLoading(false);
          return;
        }

        setIsAvailable(true);

        // Configure log level: reduce noise in dev, strict in prod
        if (LOG_LEVEL) {
          Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.WARN : LOG_LEVEL.ERROR);
        }

        /**
         * Custom log handler: filters expected errors from RevenueCat logs.
         *
         * RevenueCat logs many configuration-related warnings (empty offerings,
         * products pending review, etc.) that are expected during development.
         * We filter these out to reduce noise while still logging real errors.
         * This is a selective filter pattern: allow real errors, silence expected ones.
         */
        if (__DEV__ && Purchases.setLogHandler) {
          Purchases.setLogHandler((logLevel: any, message: string) => {
            // Detect expected configuration-related errors
            const isExpectedConfigError =
              message.includes("why-are-offerings-empty") ||
              message.includes("None of the products registered") ||
              message.includes("configuration");

            if (isExpectedConfigError) {
              // Silently ignore — these are expected in dev
              return;
            }

            // Log other messages normally
            if (logLevel === "ERROR") {
              console.error("[RevenueCat]", message);
            } else if (logLevel === "WARN") {
              console.warn("[RevenueCat]", message);
            } else {
              console.log("[RevenueCat]", message);
            }
          });
        }

        // Configure RevenueCat with API key
        await Purchases.configure({ apiKey: REVENUECAT_API_KEY });
        setIsInitialized(true);

        // Fetch available offerings (subscription packages)
        await fetchOfferings();
      } catch (error: unknown) {
        console.error("Error initializing RevenueCat:", error);
        setIsLoading(false);
      }
    };

    initRevenueCat();
  }, []);

  /**
   * Effect 2: Sync Firebase user ID with RevenueCat.
   *
   * When the user logs in, we sync their Firebase UID with RevenueCat so that
   * purchases are associated with their account. When they log out, we reset
   * the RevenueCat identity.
   *
   * The lastSyncedUid state variable prevents redundant syncs if the user.uid
   * hasn't changed. This is an optimization: we only sync when the UID actually
   * changes, not on every render.
   *
   * Dependency array: [user?.uid, isInitialized, lastSyncedUid]. Changes to
   * any of these trigger a resync.
   */
  useEffect(() => {
    if (!isInitialized || !Purchases) return;

    const syncIdentity = async () => {
      const currentUid = user?.uid || null;

      // Optimization: skip if we're already synced to this UID
      if (currentUid === lastSyncedUid) return;

      setIsLoading(true);

      try {
        if (currentUid) {
          // User is logged in: sync RevenueCat to this Firebase UID
          const info = await syncRevenueCatIdentity(currentUid);
          if (info) {
            setCustomerInfo(info as CustomerInfo);
            // Check if user has the premium entitlement
            const hasPremium =
              typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !==
              "undefined";
            setIsPremium(hasPremium);
          }
          setLastSyncedUid(currentUid);
        } else {
          // User logged out: reset RevenueCat to anonymous identity
          await resetRevenueCatIdentity();
          setCustomerInfo(null);
          setIsPremium(false);
          setLastSyncedUid(null);
        }
      } catch (error) {
        console.error("Error syncing RevenueCat identity:", error);
      } finally {
        setIsLoading(false);
      }
    };

    syncIdentity();
  }, [user?.uid, isInitialized, lastSyncedUid]);

  /**
   * Effect 3: Subscribe to RevenueCat customer info updates.
   *
   * RevenueCat emits a "customer info updated" event whenever the user's
   * subscription status changes (e.g., a purchase completes, subscription expires).
   * This effect sets up a listener to react to those events.
   *
   * The listener callback updates our local state to reflect the new customer info.
   * The cleanup function removes the listener on unmount.
   *
   * This is the Observer Pattern: we're observing RevenueCat events and
   * reacting to them by updating our state.
   */
  useEffect(() => {
    if (!isInitialized || !Purchases) return;

    const customerInfoListener = (info: CustomerInfo) => {
      setCustomerInfo(info);
      // Check if the premium entitlement is active
      const hasPremium = typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== "undefined";
      setIsPremium(hasPremium);
    };

    Purchases.addCustomerInfoUpdateListener(customerInfoListener);

    // Cleanup: remove listener on unmount
    return () => {
      Purchases.removeCustomerInfoUpdateListener(customerInfoListener);
    };
  }, [isInitialized]);

  /**
   * Helper: Check the current subscription status by fetching customer info from RevenueCat.
   *
   * This is extracted to a separate function so it can be called both from
   * checkSubscriptionStatus (the public API) and potentially from other places.
   * It's not a useCallback because it doesn't need to be memoized or exposed
   * (it's internal to this provider).
   */
  const checkSubscriptionStatusInternal = async () => {
    if (!Purchases) {
      setIsLoading(false);
      return;
    }
    try {
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
      const hasPremium = typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== "undefined";
      setIsPremium(hasPremium);
    } catch (error) {
      console.error("Error checking subscription status:", error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Action: Manually check subscription status.
   *
   * This is a thin useCallback wrapper around checkSubscriptionStatusInternal,
   * exposed in the context so screens can call it (e.g., "Refresh" button).
   */
  const checkSubscriptionStatus = useCallback(async () => {
    await checkSubscriptionStatusInternal();
  }, []);

  /**
   * Helper: Fetch available offerings (subscription packages) from RevenueCat.
   *
   * This is called during initialization to populate the context with available
   * packages (monthly, annual, etc.). It includes extensive debug logging to
   * help diagnose offering configuration issues on the RevenueCat dashboard.
   *
   * Strategy: prefer offerings.current, but fall back to the first offering if
   * current isn't set. This handles both properly-configured dashboards and
   * partially-configured ones.
   */
  const fetchOfferings = async () => {
    if (!Purchases) return;
    try {
      const offerings = await Purchases.getOfferings();

      // Debug logging to help diagnose offering issues
      if (__DEV__) {
        console.log("[RevenueCat] Offerings response:", {
          hasOfferings: !!offerings,
          hasCurrent: !!offerings?.current,
          currentIdentifier: offerings?.current?.identifier,
          availablePackagesCount: offerings?.current?.availablePackages?.length || 0,
          packageIdentifiers: offerings?.current?.availablePackages?.map((p: any) => p.identifier) || [],
          allOfferingIds: Object.keys(offerings?.all || {}),
        });
      }

      if (offerings.current) {
        setCurrentOffering(offerings.current);
      } else if (offerings.all && Object.keys(offerings.all).length > 0) {
        // Fallback: if no "current" offering but others exist, use the first
        const firstOfferingKey = Object.keys(offerings.all)[0];
        if (__DEV__) console.log("[RevenueCat] No current offering set, using first available:", firstOfferingKey);
        setCurrentOffering(offerings.all[firstOfferingKey]);
      } else {
        // No offerings at all — likely a configuration issue on RevenueCat dashboard
        if (__DEV__) console.log("[RevenueCat] No offerings available. Check RevenueCat dashboard: ensure products are added to an offering and the offering is set as 'Current'.");
      }
    } catch (error: unknown) {
      const revenuecatError = error as { message?: string; code?: string };
      if (__DEV__) console.log("[RevenueCat] Error fetching offerings:", revenuecatError.message, revenuecatError.code);
    }
  };

  /**
   * Action: Purchase a subscription package.
   *
   * This calls RevenueCat's purchasePackage method and updates local state
   * with the result. Note the explicit comment about NOT managing isLoading —
   * the caller (OnboardingScreen) manages its own isPurchasing state. If we
   * touched isLoading here, it could race with the syncIdentity effect and
   * get stuck in a loading state after the user cancels.
   *
   * @param pkg - The package to purchase (monthly, annual, etc.)
   * @returns true if purchase succeeded and user now has premium, false otherwise
   */
  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    if (!Purchases) {
      Alert.alert("Not Available", "In-app purchases are not available yet. Please rebuild the app.");
      return false;
    }
    /**
     * Critical note: We deliberately DON'T manage isLoading during purchase.
     *
     * The caller (OnboardingScreen) owns the purchase busy state via its own
     * isPurchasing state. If we set isLoading here, it can race with the
     * syncIdentity effect. Here's the race:
     * 1. User taps "Purchase"
     * 2. purchasePackage sets isLoading = true
     * 3. Purchase completes, customerInfo updates (from RevenueCat event listener)
     * 4. User cancels the purchase UI
     * 5. syncIdentity effect runs and might set isLoading = false LATER
     * 6. Now isLoading is stuck true after the flow is complete
     *
     * Solution: let the caller manage its own busy state, don't manage it here.
     */
    try {
      const { customerInfo: newInfo } = await Purchases.purchasePackage(pkg);
      setCustomerInfo(newInfo);
      const hasPremium = typeof newInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== "undefined";
      setIsPremium(hasPremium);
      return hasPremium;
    } catch (error: unknown) {
      // Only show alert if user didn't cancel (RevenueCat sets userCancelled on manual cancels)
      const revenuecatError = error as { userCancelled?: boolean; message?: string };
      if (!revenuecatError.userCancelled) {
        console.error("Error purchasing package:", error);
        Alert.alert(
          "Purchase Failed",
          revenuecatError.message || "There was an error processing your purchase. Please try again."
        );
      }
      return false;
    }
  }, []);

  /**
   * Action: Restore purchases with simple alert-based feedback.
   *
   * This is the "basic" restore flow for iOS/Android restore. It shows the user
   * alerts to let them know whether the restore succeeded or if no purchases were found.
   * Use this for straightforward restore scenarios.
   *
   * @returns true if purchases were restored and user now has premium, false otherwise
   */
  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!Purchases) {
      Alert.alert(
        "Not Available",
        "In-app purchases are not available yet. Please rebuild the app."
      );
      return false;
    }
    try {
      setIsLoading(true);
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const hasPremium =
        typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== "undefined";
      setIsPremium(hasPremium);

      // User feedback: show success or "no purchases found" alert
      if (hasPremium) {
        Alert.alert("Success", "Your purchases have been restored!");
      } else {
        Alert.alert(
          "No Purchases Found",
          "We couldn't find any previous purchases to restore."
        );
      }

      return hasPremium;
    } catch (error: unknown) {
      console.error("Error restoring purchases:", error);
      const revenuecatError = error as { message?: string };
      Alert.alert(
        "Restore Failed",
        revenuecatError.message ||
          "There was an error restoring your purchases. Please try again."
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Action: Restore purchases with recovery detection (advanced).
   *
   * This is a more sophisticated restore flow that detects if the user has an
   * active subscription on their Apple ID that belongs to a DIFFERENT account.
   * This can happen when:
   * 1. User purchased on Apple ID A
   * 2. User switched to Apple ID B (or family sharing changed)
   * 3. App synced with Firebase user C (unrelated to the subscription)
   *
   * The recovery wizard helps the user recover their subscription by signing in
   * with the correct Apple ID or Firebase account.
   *
   * Returns a structured result (not alerts) so the caller can decide how to
   * present the recovery flow (wizard, toast, etc.).
   *
   * @returns { success, reason, showRecoveryWizard } — caller decides next action
   */
  const restorePurchasesWithRecoveryFlow =
    useCallback(async (): Promise<RestorePurchasesResult> => {
      if (!Purchases) {
        return { success: false, reason: "no_subscription" };
      }

      try {
        setIsLoading(true);
        const result = await restorePurchasesWithRecovery();

        if (result.customerInfo) {
          setCustomerInfo(result.customerInfo as CustomerInfo);
          const hasPremium = hasPremiumEntitlement(
            result.customerInfo as ManagerCustomerInfo
          );
          setIsPremium(hasPremium);
        }

        return {
          success: result.success,
          reason: result.reason,
          showRecoveryWizard: result.showRecoveryWizard,
        };
      } catch (error: unknown) {
        console.error("Error restoring purchases with recovery:", error);
        return { success: false, reason: "no_subscription" };
      } finally {
        setIsLoading(false);
      }
    }, []);

  /**
   * Query: Check if user has an active subscription on their Apple ID.
   *
   * This is used to detect the "lost subscription" case: the user has a
   * valid subscription on their Apple ID, but it's not associated with the
   * currently logged-in Firebase account. This is where showRecoveryWizard
   * would help them re-link the subscription to their account.
   *
   * @returns true if subscription exists on Apple ID, false otherwise
   */
  const hasActiveSubscriptionOnAppleId = useCallback((): boolean => {
    if (!customerInfo) return false;
    return detectActiveSubscriptionOnAppleId(
      customerInfo as ManagerCustomerInfo
    );
  }, [customerInfo]);

  const value = {
    isPremium,
    isLoading,
    isAvailable,
    customerInfo,
    currentOffering,
    purchasePackage,
    restorePurchases,
    restorePurchasesWithRecovery: restorePurchasesWithRecoveryFlow,
    checkSubscriptionStatus,
    hasActiveSubscriptionOnAppleId,
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

/**
 * Custom hook: useSubscription — access subscription state and purchase methods.
 *
 * @throws Error if used outside a SubscriptionProvider
 * @returns SubscriptionContextType with isPremium, isLoading, offerings, and purchase methods
 */
export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error("useSubscription must be used within a SubscriptionProvider");
  }
  return context;
}

/**
 * Custom hook: usePremiumAccess — simplified helper for premium content gating.
 *
 * This is a convenience hook for screens that need to check if content is
 * premium and whether to show a paywall. It encodes a common pattern:
 *   - If content is NOT premium, always show it (canAccess: true)
 *   - If content IS premium:
 *     - Show if user has premium (canAccess: true)
 *     - Otherwise show paywall (showPaywall: true)
 *     - Unless we're still loading (don't show paywall while checking status)
 *
 * Usage example:
 *   const { canAccess, showPaywall } = usePremiumAccess(isMeditationPremium);
 *   if (canAccess) return <MeditationContent />;
 *   if (showPaywall) return <PaywallScreen />;
 *   return <LoadingSpinner />;
 *
 * @param isPremiumContent - Whether this content requires premium (default: false)
 * @returns { canAccess, isPremium, isLoading, showPaywall }
 */
export function usePremiumAccess(isPremiumContent: boolean = false) {
  const { isPremium, isLoading } = useSubscription();

  return {
    canAccess: !isPremiumContent || isPremium,  // If not premium content, or user has premium
    isPremium,
    isLoading,
    showPaywall: isPremiumContent && !isPremium && !isLoading,  // Show paywall only if premium AND user lacks it AND loaded
  };
}

// Re-export types for use in other files (convenience for consumers)
export type {
  PurchasesPackage,
  PurchasesOffering,
  CustomerInfo,
  RestorePurchasesResult,
};
