/**
 * ============================================================
 * SubscriptionContext.web.tsx — Web-Specific Subscription Provider
 *                               (Platform-Specific Stub)
 * ============================================================
 *
 * Architectural Role:
 *   This is the web (browser) variant of SubscriptionContext.tsx. It implements
 *   the same SubscriptionContextType interface, but always returns mock data
 *   (isPremium: false, all methods throw or return false).
 *
 *   This is a Stub implementation: the interface matches the native version,
 *   but the functionality is deliberately disabled. This allows web admin
 *   dashboards to use the same codebase without crashing — they just see
 *   all content as non-premium and can't make purchases.
 *
 * Design Patterns:
 *   - Strategy Pattern: Different platform-specific implementation (web vs mobile),
 *     but unified interface via SubscriptionContextType
 *   - Stub Pattern: All methods exist but throw or return sensible defaults
 *   - No-Op Implementation: Methods are functional stubs that don't do anything
 *
 * Why a stub instead of conditional imports?
 *   React Native has platform-specific extensions (.web.tsx, .native.tsx, etc.)
 *   that are resolved at build time. Using this file (resolved for web builds)
 *   is cleaner than runtime checks throughout the native variant.
 *
 * Consumed By:
 *   - Web admin dashboard components (if accessed via browser)
 * ============================================================
 */

import React, { createContext, useContext, useMemo } from 'react';

export const PREMIUM_ENTITLEMENT_ID = 'premium';

// Type definitions (same as native variant for compatibility)
export interface PurchasesPackage {
  identifier: string;
  product: {
    price: number;
    priceString: string;
    title: string;
    description: string;
  };
}

export interface CustomerInfo {
  entitlements: {
    active: Record<string, unknown>;
  };
  activeSubscriptions: string[];
  allExpirationDates: Record<string, string | null>;
  allPurchaseDates: Record<string, string | null>;
}

export interface PurchasesOffering {
  identifier: string;
  monthly?: PurchasesPackage;
  annual?: PurchasesPackage;
  availablePackages: PurchasesPackage[];
}

export interface RestorePurchasesResult {
  success: boolean;
  reason?: 'no_subscription' | 'different_account';
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
 * Web stub provider — always returns "not premium" mock data.
 *
 * All methods throw errors or return sensible defaults. This allows web
 * components to use useSubscription() without crashing, but makes it clear
 * that subscriptions aren't available on web.
 */
export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<SubscriptionContextType>(
    () => ({
      isPremium: false,  // Always false on web
      isLoading: false,
      isAvailable: false,
      customerInfo: null,
      currentOffering: null,
      // All methods throw to make it clear they're not available
      purchasePackage: async () => {
        throw new Error('In-app purchases are not available on the Calmdemy web admin.');
      },
      restorePurchases: async () => false,
      restorePurchasesWithRecovery: async () => ({ success: false, reason: 'no_subscription' }),
      checkSubscriptionStatus: async () => undefined,
      hasActiveSubscriptionOnAppleId: () => false,
    }),
    []
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

/**
 * Custom hook: useSubscription — access subscription state (all mocked on web).
 *
 * @throws Error if used outside a SubscriptionProvider
 * @returns SubscriptionContextType with mock data (isPremium: false, methods throw)
 */
export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}

/**
 * Custom hook: usePremiumAccess — premium content gating helper (web stub).
 *
 * Same interface as the native variant, but on web, isPremium is always false,
 * so canAccess is always based on whether the content is marked premium.
 * For premium content, showPaywall will be true (since isPremium is false and
 * isLoading is false).
 *
 * @param isPremiumContent - Whether this content requires premium (default: false)
 * @returns { canAccess, isPremium, isLoading, showPaywall }
 */
export function usePremiumAccess(isPremiumContent = false) {
  const { isPremium, isLoading } = useSubscription();

  return {
    canAccess: !isPremiumContent || isPremium,
    isPremium,
    isLoading,
    showPaywall: isPremiumContent && !isPremium && !isLoading,
  };
}
