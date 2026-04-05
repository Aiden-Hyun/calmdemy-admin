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

// RevenueCat config
const REVENUECAT_API_KEY = env.revenuecat.apiKey;
export const PREMIUM_ENTITLEMENT_ID = env.revenuecat.entitlementId;

// Lazy load RevenueCat to prevent crash when native modules aren't available
let Purchases: any = null;
let LOG_LEVEL: any = null;

async function loadRevenueCat() {
  if (Purchases) return true;
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

export function SubscriptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [currentOffering, setCurrentOffering] =
    useState<PurchasesOffering | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastSyncedUid, setLastSyncedUid] = useState<string | null>(null);

  // Initialize RevenueCat
  useEffect(() => {
    const initRevenueCat = async () => {
      try {
        const loaded = await loadRevenueCat();
        if (!loaded || !Purchases) {
          console.log("RevenueCat not available, running in demo mode");
          setIsLoading(false);
          return;
        }

        if (!REVENUECAT_API_KEY) {
          console.warn("RevenueCat API key missing; skipping initialization");
          setIsLoading(false);
          return;
        }

        setIsAvailable(true);

        if (LOG_LEVEL) {
          // Use WARN level to reduce noise from expected configuration issues (simulator, pending review)
          Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.WARN : LOG_LEVEL.ERROR);
        }

        // Set custom log handler to filter expected configuration errors
        if (__DEV__ && Purchases.setLogHandler) {
          Purchases.setLogHandler((logLevel: any, message: string) => {
            // Filter out expected configuration errors (empty offerings, products pending review)
            const isExpectedConfigError =
              message.includes("why-are-offerings-empty") ||
              message.includes("None of the products registered") ||
              message.includes("configuration");

            if (isExpectedConfigError) {
              // Silently ignore expected configuration issues
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

        // Configure with API key
        await Purchases.configure({ apiKey: REVENUECAT_API_KEY });
        setIsInitialized(true);

        // Fetch offerings
        await fetchOfferings();
      } catch (error: any) {
        console.error("Error initializing RevenueCat:", error);
        setIsLoading(false);
      }
    };

    initRevenueCat();
  }, []);

  // Sync RevenueCat identity when Firebase user changes
  useEffect(() => {
    if (!isInitialized || !Purchases) return;

    const syncIdentity = async () => {
      const currentUid = user?.uid || null;

      // Skip if already synced to this UID
      if (currentUid === lastSyncedUid) return;

      setIsLoading(true);

      try {
        if (currentUid) {
          // User is logged in - sync RevenueCat to this UID
          const info = await syncRevenueCatIdentity(currentUid);
          if (info) {
            setCustomerInfo(info as CustomerInfo);
            const hasPremium =
              typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !==
              "undefined";
            setIsPremium(hasPremium);
          }
          setLastSyncedUid(currentUid);
        } else {
          // User logged out - reset RevenueCat identity
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

  // Listen for customer info updates
  useEffect(() => {
    if (!isInitialized || !Purchases) return;

    const customerInfoListener = (info: CustomerInfo) => {
      setCustomerInfo(info);
      const hasPremium = typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== "undefined";
      setIsPremium(hasPremium);
    };

    Purchases.addCustomerInfoUpdateListener(customerInfoListener);

    return () => {
      Purchases.removeCustomerInfoUpdateListener(customerInfoListener);
    };
  }, [isInitialized]);

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

  const checkSubscriptionStatus = useCallback(async () => {
    await checkSubscriptionStatusInternal();
  }, []);

  const fetchOfferings = async () => {
    if (!Purchases) return;
    try {
      const offerings = await Purchases.getOfferings();
      
      // Debug logging to help diagnose offering issues
      console.log("[RevenueCat] Offerings response:", {
        hasOfferings: !!offerings,
        hasCurrent: !!offerings?.current,
        currentIdentifier: offerings?.current?.identifier,
        availablePackagesCount: offerings?.current?.availablePackages?.length || 0,
        packageIdentifiers: offerings?.current?.availablePackages?.map((p: any) => p.identifier) || [],
        allOfferingIds: Object.keys(offerings?.all || {}),
      });
      
      if (offerings.current) {
        setCurrentOffering(offerings.current);
      } else if (offerings.all && Object.keys(offerings.all).length > 0) {
        // If no "current" offering but other offerings exist, use the first one
        const firstOfferingKey = Object.keys(offerings.all)[0];
        console.log("[RevenueCat] No current offering set, using first available:", firstOfferingKey);
        setCurrentOffering(offerings.all[firstOfferingKey]);
      } else {
        console.log("[RevenueCat] No offerings available. Check RevenueCat dashboard: ensure products are added to an offering and the offering is set as 'Current'.");
      }
    } catch (error: any) {
      console.log("[RevenueCat] Error fetching offerings:", error.message, error.code);
    }
  };

  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    if (!Purchases) {
      Alert.alert("Not Available", "In-app purchases are not available yet. Please rebuild the app.");
      return false;
    }
    // Do not touch isLoading here — purchase busy state is owned by the caller
    // (OnboardingScreen's isPurchasing). Setting isLoading during a purchase
    // can race with syncIdentity and leave isLoading stuck true after a cancel.
    try {
      const { customerInfo: newInfo } = await Purchases.purchasePackage(pkg);
      setCustomerInfo(newInfo);
      const hasPremium = typeof newInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== "undefined";
      setIsPremium(hasPremium);
      return hasPremium;
    } catch (error: any) {
      if (!error.userCancelled) {
        console.error("Error purchasing package:", error);
        Alert.alert(
          "Purchase Failed",
          error.message || "There was an error processing your purchase. Please try again."
        );
      }
      return false;
    }
  }, []);

  /**
   * Simple restore that shows alerts. Use for basic restore flow.
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

      if (hasPremium) {
        Alert.alert("Success", "Your purchases have been restored!");
      } else {
        Alert.alert(
          "No Purchases Found",
          "We couldn't find any previous purchases to restore."
        );
      }

      return hasPremium;
    } catch (error: any) {
      console.error("Error restoring purchases:", error);
      Alert.alert(
        "Restore Failed",
        error.message ||
          "There was an error restoring your purchases. Please try again."
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Restore with recovery detection.
   * Returns structured result instead of showing alerts.
   * Use this to trigger recovery wizard when subscription belongs to different account.
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
      } catch (error: any) {
        console.error("Error restoring purchases with recovery:", error);
        return { success: false, reason: "no_subscription" };
      } finally {
        setIsLoading(false);
      }
    }, []);

  /**
   * Check if there's an active subscription on the Apple ID
   * that this account may not own.
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

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error("useSubscription must be used within a SubscriptionProvider");
  }
  return context;
}

/**
 * Hook to check if user can access premium content
 * Returns { canAccess, isPremium, showPaywall }
 */
export function usePremiumAccess(isPremiumContent: boolean = false) {
  const { isPremium, isLoading } = useSubscription();

  return {
    canAccess: !isPremiumContent || isPremium,
    isPremium,
    isLoading,
    showPaywall: isPremiumContent && !isPremium && !isLoading,
  };
}

// Re-export types for use in other files
export type {
  PurchasesPackage,
  PurchasesOffering,
  CustomerInfo,
  RestorePurchasesResult,
};
