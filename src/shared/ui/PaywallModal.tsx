/**
 * Paywall/Subscription Modal Component
 *
 * Architectural Role:
 * Presentation layer component for subscription purchase flow. Integrates with
 * SubscriptionContext (via RevenueCat) to handle purchases, subscription recovery,
 * and anonymous user account prompts. Part of the monetization feature in MVVM.
 *
 * Design Patterns:
 * - Controlled Component: Modal visibility controlled by parent via visible/onClose props
 * - State Machine: Multi-step recovery flow (normal purchase vs. recovery-first UI)
 * - Composition: Embeds AccountPromptModal and RecoveryWizard for orchestrated flows
 * - Memoized Styling: useMemo for theme-dependent styles to prevent unnecessary recalculations
 *
 * Key Dependencies:
 * - useSubscription: RevenueCat integration, package fetching, purchase orchestration
 * - useTheme: Theme colors and typography
 * - useAuth: User authentication state (to show account prompt for anonymous users)
 * - useSafeAreaInsets: Safe area padding for notches/home indicators
 *
 * Consumed By:
 * - PremiumGate component (gates premium content)
 * - Premium features throughout the app when user lacks subscription
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useAuth } from "@core/providers/contexts/AuthContext";
import {
  useSubscription,
  PurchasesPackage,
} from "@core/providers/contexts/SubscriptionContext";
import { AccountPromptModal } from "./AccountPromptModal";
import { RecoveryWizard } from "./RecoveryWizard";
import { Theme } from "@/theme";

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/** Feature list highlighting premium benefits; displayed prominently in the paywall */
const FEATURES = [
  { icon: "infinite-outline", text: "Unlimited meditations & courses" },
  { icon: "moon-outline", text: "All sleep content & stories" },
  { icon: "musical-notes-outline", text: "Full music & sound library" },
  { icon: "cloud-download-outline", text: "Offline downloads" },
  { icon: "sparkles-outline", text: "New content weekly" },
];

/**
 * PaywallModal - Subscription purchase interface with smart recovery flow
 *
 * Intelligently switches between two UI flows:
 * 1. Normal Purchase Flow: New/non-premium users see subscription options
 * 2. Recovery-First Flow: Users with active Apple ID subscription but no current
 *    account premium status see account recovery UI first
 *
 * This prevents friction when users have subscriptions on their device but are
 * logged into a different account.
 */
export function PaywallModal({
  visible,
  onClose,
  onSuccess,
}: PaywallModalProps) {
  const { theme, isDark } = useTheme();
  const { isAnonymous } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const {
    currentOffering,
    purchasePackage,
    restorePurchasesWithRecovery,
    isLoading,
    hasActiveSubscriptionOnAppleId,
    isPremium,
  } = useSubscription();
  const [selectedPackage, setSelectedPackage] =
    useState<PurchasesPackage | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [showAccountPrompt, setShowAccountPrompt] = useState(false);
  const [showRecoveryWizard, setShowRecoveryWizard] = useState(false);

  /**
   * Recovery-First UI Logic:
   * If the device's App Store account has an active subscription, but the currently
   * logged-in user doesn't have premium status, we show recovery UI instead of the
   * purchase flow. This happens when a user logs into a different account on a device
   * that already has a subscription under a different Apple ID.
   */
  const shouldShowRecoveryFirst =
    hasActiveSubscriptionOnAppleId() && !isPremium;

  /**
   * Package Extraction:
   * RevenueCat Offering structure is flexible. We try standard properties first,
   * then fall back to searching availablePackages array. This handles variations
   * in backend RevenueCat configuration.
   */
  const monthlyPackage = currentOffering?.monthly ||
    currentOffering?.availablePackages?.find(p =>
      p.identifier === '$rc_monthly' ||
      p.identifier.toLowerCase().includes('monthly')
    );
  const annualPackage = currentOffering?.annual ||
    currentOffering?.availablePackages?.find(p =>
      p.identifier === '$rc_annual' ||
      p.identifier.toLowerCase().includes('annual') ||
      p.identifier.toLowerCase().includes('yearly')
    );

  // Derived state to simplify conditional rendering
  const hasPackages = monthlyPackage || annualPackage;
  const isLoadingOfferings = isLoading && !currentOffering;

  /**
   * Savings Calculation:
   * Compare annual cost to monthly cost * 12 to show savings percentage.
   * Memoized to avoid unnecessary recalculation on parent re-renders.
   */
  const annualSavings = useMemo(() => {
    if (!monthlyPackage || !annualPackage) return null;
    const monthlyPrice = monthlyPackage.product.price;
    const annualPrice = annualPackage.product.price;
    const yearlyIfMonthly = monthlyPrice * 12;
    const savings = Math.round(((yearlyIfMonthly - annualPrice) / yearlyIfMonthly) * 100);
    return savings > 0 ? savings : null;
  }, [monthlyPackage, annualPackage]);

  /**
   * Purchase Handler:
   * Executes RevenueCat purchase flow. On success, shows account creation prompt
   * for anonymous users (common in trial scenarios).
   */
  const handlePurchase = async () => {
    if (!selectedPackage) return;

    setIsPurchasing(true);
    const success = await purchasePackage(selectedPackage);
    setIsPurchasing(false);

    if (success) {
      onSuccess?.();
      onClose();
      // Anonymous users should create an account to preserve their subscription
      // and access across devices
      if (isAnonymous) {
        setShowAccountPrompt(true);
      }
    }
  };

  /**
   * Restore Purchases Handler:
   * Calls RevenueCat's restore with built-in recovery logic. If the restore
   * detects a subscription on the Apple ID but not on the current account,
   * it triggers the recovery wizard flow.
   */
  const handleRestore = async () => {
    setIsPurchasing(true);
    const result = await restorePurchasesWithRecovery();
    setIsPurchasing(false);

    if (result.success) {
      onSuccess?.();
      onClose();
    } else if (result.showRecoveryWizard) {
      // Defer recovery UI to be shown in a separate modal
      setShowRecoveryWizard(true);
    }
  };

  /**
   * Recovery Success Callback:
   * User successfully recovered their subscription and signed into the correct account.
   */
  const handleRecoverySuccess = () => {
    setShowRecoveryWizard(false);
    onSuccess?.();
    onClose();
  };

  /**
   * Opens device mail client with pre-filled support email.
   * Uses URL encoding for proper email client handling.
   */
  const handleContactSupport = () => {
    const subject = encodeURIComponent("Subscription Help");
    const body = encodeURIComponent(
      "Hi,\n\nI need help with my subscription.\n\nThank you"
    );
    Linking.openURL(
      `mailto:support@calmnest.app?subject=${subject}&body=${body}`
    );
  };

  /** Format RevenueCat price string with period (e.g., "$9.99/month") */
  const formatPrice = (pkg: PurchasesPackage | undefined, period: string) => {
    if (!pkg) return "...";
    return `${pkg.product.priceString}/${period}`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={24} color={theme.colors.textLight} />
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <LinearGradient
              colors={[theme.colors.primaryLight, theme.colors.primary]}
              style={styles.iconContainer}
            >
              <Ionicons name="leaf" size={48} color="#fff" />
            </LinearGradient>
            <Text style={styles.title}>Unlock Calmdemy Premium</Text>
            <Text style={styles.subtitle}>
              Get unlimited access to all meditations, sleep content, and more.
            </Text>
          </View>

          {/* Features */}
          <View style={styles.featuresContainer}>
            {FEATURES.map((feature, index) => (
              <View key={index} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Ionicons
                    name={feature.icon as any}
                    size={20}
                    color={theme.colors.primary}
                  />
                </View>
                <Text style={styles.featureText}>{feature.text}</Text>
              </View>
            ))}
          </View>

          {/* Recovery-first UI when Apple ID has subscription but current account doesn't */}
          {shouldShowRecoveryFirst && (
            <View style={styles.recoveryContainer}>
              <View style={styles.recoveryIconContainer}>
                <Ionicons
                  name="alert-circle-outline"
                  size={48}
                  color={theme.colors.warning}
                />
              </View>
              <Text style={styles.recoveryTitle}>
                You already have an active subscription
              </Text>
              <Text style={styles.recoveryDescription}>
                This Apple ID has a Calmdemy subscription, but it's linked to a
                different account. Recover access to continue using premium
                features.
              </Text>
              <TouchableOpacity
                style={styles.recoveryButton}
                onPress={() => setShowRecoveryWizard(true)}
              >
                <Ionicons name="key-outline" size={20} color="#fff" />
                <Text style={styles.recoveryButtonText}>
                  Recover My Subscription
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.recoveryHelpButton}
                onPress={handleContactSupport}
              >
                <Text style={styles.recoveryHelpText}>Contact Support</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Subscription options - only show if not in recovery-first mode */}
          {!shouldShowRecoveryFirst && (
          <View style={styles.optionsContainer}>
            {/* Loading State */}
            {isLoadingOfferings && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={styles.loadingText}>
                  Loading subscription plans...
                </Text>
              </View>
            )}

            {/* No Products Available */}
            {!isLoadingOfferings && !hasPackages && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textMuted} />
                <Text style={styles.errorTitle}>Plans Unavailable</Text>
                <Text style={styles.errorText}>
                  Subscription plans are temporarily unavailable. Please try again later or contact support.
                </Text>
                <TouchableOpacity 
                  style={styles.retryButton}
                  onPress={onClose}
                >
                  <Text style={styles.retryButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Annual */}
            {annualPackage && (
              <Pressable
                style={[
                  styles.optionCard,
                  selectedPackage?.identifier === annualPackage.identifier &&
                    styles.optionCardSelected,
                ]}
                onPress={() => setSelectedPackage(annualPackage)}
              >
                {annualSavings && (
                  <View style={styles.savingsBadge}>
                    <Text style={styles.savingsText}>Save {annualSavings}%</Text>
                  </View>
                )}
                <View style={styles.optionContent}>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>Annual</Text>
                    <Text style={styles.optionPrice}>
                      {formatPrice(annualPackage, "year")}
                    </Text>
                    <View style={styles.trialBadge}>
                      <Ionicons name="gift-outline" size={12} color={theme.colors.primary} />
                      <Text style={styles.trialText}>14-day free trial</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.radioOuter,
                      selectedPackage?.identifier === annualPackage.identifier &&
                        styles.radioOuterSelected,
                    ]}
                  >
                    {selectedPackage?.identifier === annualPackage.identifier && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                </View>
              </Pressable>
            )}

            {/* Monthly */}
            {monthlyPackage && (
              <Pressable
                style={[
                  styles.optionCard,
                  selectedPackage?.identifier === monthlyPackage.identifier &&
                    styles.optionCardSelected,
                ]}
                onPress={() => setSelectedPackage(monthlyPackage)}
              >
                <View style={styles.optionContent}>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>Monthly</Text>
                    <Text style={styles.optionPrice}>
                      {formatPrice(monthlyPackage, "month")}
                    </Text>
                    <View style={styles.trialBadge}>
                      <Ionicons name="gift-outline" size={12} color={theme.colors.primary} />
                      <Text style={styles.trialText}>7-day free trial</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.radioOuter,
                      selectedPackage?.identifier === monthlyPackage.identifier &&
                        styles.radioOuterSelected,
                    ]}
                  >
                    {selectedPackage?.identifier === monthlyPackage.identifier && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                </View>
              </Pressable>
            )}
          </View>
          )}
        </ScrollView>

        {/* Bottom actions - different for recovery-first mode */}
        <View
          style={[styles.bottomContainer, { paddingBottom: insets.bottom + 16 }]}
        >
          {!shouldShowRecoveryFirst && (
            <>
              <TouchableOpacity
                style={[
                  styles.purchaseButton,
                  (!selectedPackage || isPurchasing) &&
                    styles.purchaseButtonDisabled,
                ]}
                onPress={handlePurchase}
                disabled={!selectedPackage || isPurchasing}
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.purchaseButtonText}>
                    {selectedPackage ? "Subscribe Now" : "Select a Plan"}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.restoreButton}
                onPress={handleRestore}
                disabled={isPurchasing}
              >
                <Text style={styles.restoreButtonText}>Restore Purchases</Text>
              </TouchableOpacity>

              <Text style={styles.legalText}>
                Cancel anytime. Subscription auto-renews until cancelled.
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Account prompt for anonymous users after purchase */}
      <AccountPromptModal
        visible={showAccountPrompt}
        onClose={() => setShowAccountPrompt(false)}
      />

      {/* Recovery wizard for subscription recovery */}
      <RecoveryWizard
        visible={showRecoveryWizard}
        onClose={() => setShowRecoveryWizard(false)}
        onSuccess={handleRecoverySuccess}
      />
    </Modal>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    closeButton: {
      position: "absolute",
      top: 16,
      right: 16,
      zIndex: 10,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      ...theme.shadows.sm,
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 60,
      paddingBottom: 24,
    },
    hero: {
      alignItems: "center",
      marginBottom: 32,
    },
    iconContainer: {
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 24,
    },
    title: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 28,
      color: theme.colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    subtitle: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 16,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 24,
      paddingHorizontal: 16,
    },
    featuresContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: 20,
      marginBottom: 24,
      ...theme.shadows.sm,
    },
    featureRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
    },
    featureIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: `${theme.colors.primary}15`,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 16,
    },
    featureText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.text,
      flex: 1,
    },
    optionsContainer: {
      gap: 12,
    },
    loadingContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 40,
      gap: 16,
    },
    loadingText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.textLight,
    },
    errorContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 32,
      paddingHorizontal: 24,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      gap: 12,
    },
    errorTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 18,
      color: theme.colors.text,
    },
    errorText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 20,
    },
    retryButton: {
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 24,
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.md,
    },
    retryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: "#fff",
    },
    optionCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      padding: 20,
      borderWidth: 2,
      borderColor: "transparent",
      ...theme.shadows.sm,
    },
    optionCardSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: `${theme.colors.primary}08`,
    },
    optionContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    optionTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 18,
      color: theme.colors.text,
      marginBottom: 4,
    },
    optionInfo: {
      flex: 1,
    },
    optionPrice: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.textLight,
    },
    trialBadge: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
      gap: 4,
    },
    trialText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.primary,
    },
    savingsBadge: {
      position: "absolute",
      top: -10,
      right: 16,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
    },
    savingsText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 12,
      color: "#fff",
    },
    radioOuter: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.colors.gray[300],
      alignItems: "center",
      justifyContent: "center",
    },
    radioOuterSelected: {
      borderColor: theme.colors.primary,
    },
    radioInner: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: theme.colors.primary,
    },
    bottomContainer: {
      paddingHorizontal: 24,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: theme.colors.gray[200],
      backgroundColor: theme.colors.background,
    },
    purchaseButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.lg,
      paddingVertical: 18,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    purchaseButtonDisabled: {
      backgroundColor: theme.colors.gray[300],
    },
    purchaseButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 17,
      color: "#fff",
    },
    restoreButton: {
      paddingVertical: 12,
      alignItems: "center",
    },
    restoreButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.primary,
    },
    legalText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 12,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: 8,
    },
    // Recovery-first styles
    recoveryContainer: {
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: 32,
      ...theme.shadows.sm,
    },
    recoveryIconContainer: {
      marginBottom: 16,
    },
    recoveryTitle: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 20,
      color: theme.colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    recoveryDescription: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 22,
      marginBottom: 24,
    },
    recoveryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.lg,
      paddingVertical: 16,
      paddingHorizontal: 24,
      width: "100%",
      gap: 8,
      marginBottom: 12,
    },
    recoveryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: "#fff",
    },
    recoveryHelpButton: {
      paddingVertical: 12,
    },
    recoveryHelpText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
  });
