import React, { createContext, useContext, useMemo } from 'react';

export const PREMIUM_ENTITLEMENT_ID = 'premium';

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

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<SubscriptionContextType>(
    () => ({
      isPremium: false,
      isLoading: false,
      isAvailable: false,
      customerInfo: null,
      currentOffering: null,
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

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}

export function usePremiumAccess(isPremiumContent = false) {
  const { isPremium, isLoading } = useSubscription();

  return {
    canAccess: !isPremiumContent || isPremium,
    isPremium,
    isLoading,
    showPaywall: isPremiumContent && !isPremium && !isLoading,
  };
}
