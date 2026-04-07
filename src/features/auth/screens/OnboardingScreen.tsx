/**
 * @file OnboardingScreen.tsx (Native)
 *
 * Architectural Role:
 *   Multipage onboarding carousel for new/anonymous users. Educates on app features,
 *   pricing tiers, and facilitates guest checkout (anonymous sign-in + subscription).
 *   Part of the MVVM View layer for the auth feature.
 *
 * Design Patterns:
 *   - Strategy: Platform-specific variant (native carousel; see OnboardingScreen.web.tsx for web stub)
 *   - Carousel/Pager: Horizontal ScrollView with momentum scrolling for multi-page navigation
 *   - State Deferral: Pending purchase is stored until auth completes, then executed (race condition safety)
 *   - Theme Binding: Computes styles dynamically via useMemo to respond to theme changes
 *
 * Key Dependencies:
 *   - AuthContext: useAuth() for user state, anonymous sign-in, and auth loading
 *   - SubscriptionContext: useSubscription() for package data and purchase logic
 *   - ThemeContext: useTheme() for colors and spacing
 *   - onboardingStorage: markOnboardingSeen() to persist completion
 *   - expo-router: useRouter() for navigation
 *   - expo-linear-gradient: Animated gradient backgrounds per page
 *
 * Three-Page Flow:
 *   Page 0: "Free content to begin" — highlights free meditation/sleep content
 *   Page 1: "Psychology-based courses" — highlights premium CBT/ACT courses
 *   Page 2: "Choose subscription" — plan selector and checkout
 *
 * Consumed By:
 *   - expo-router on /onboarding route (new/anonymous users)
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useAuth } from "@core/providers/contexts/AuthContext";
import {
  PurchasesPackage,
  useSubscription,
} from "@core/providers/contexts/SubscriptionContext";
import { markOnboardingSeen } from "@features/auth/utils/onboardingStorage";
import { Theme } from "@/theme";

// Feature highlights for the free tier page
const FREE_CONTENT_ITEMS = [
  { icon: "leaf-outline", label: "Guided meditations" },
  { icon: "moon-outline", label: "Sleep stories" },
  { icon: "musical-notes-outline", label: "White noise" },
] as const;

// Feature highlights for the premium tier page
const COURSE_ITEMS = [
  { icon: "school-outline", label: "Structured self-help" },
  { icon: "sparkles-outline", label: "CBT, ACT, and more" },
  { icon: "checkmark-done-outline", label: "Practical mental tools" },
] as const;

type OnboardingDestination = "/login" | "/(tabs)/home";

/**
 * Helper for Pressable state styling. Applies pressed style dynamically when user taps.
 * Used throughout for consistent press feedback without duplicating logic.
 */
const pressableStyle = (
  baseStyle: StyleProp<ViewStyle>,
  pressedStyle?: StyleProp<ViewStyle>
) => ({ pressed }: { pressed: boolean }) => [
  baseStyle,
  pressed && pressedStyle,
];

export default function OnboardingScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const { theme, isDark } = useTheme();
  const { user, loading: authLoading, signInAnonymously } = useAuth();
  const {
    currentOffering,
    purchasePackage,
    isLoading: subscriptionLoading,
  } = useSubscription();

  // Pagination state: 0 = free content, 1 = courses, 2 = subscribe
  const [activeIndex, setActiveIndex] = useState(0);
  // Currently selected plan for purchase
  const [selectedPackage, setSelectedPackage] =
    useState<PurchasesPackage | null>(null);
  // Deferred purchase: stored while signing in anonymously, then executed once auth completes
  const [pendingPackage, setPendingPackage] =
    useState<PurchasesPackage | null>(null);
  // Tracks active purchase operation
  const [isPurchasing, setIsPurchasing] = useState(false);
  // Tracks anonymous sign-in step during guest checkout flow
  const [isPreparingGuestCheckout, setIsPreparingGuestCheckout] =
    useState(false);

  // Memoized styles prevent recreation on every render; updates only when theme changes
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  /**
   * Resolve monthly package from RevenueCat offering.
   * Tries explicit .monthly property first, then searches availablePackages by ID/name.
   * Falls back to null if not found (UI disables plan selection).
   */
  const monthlyPackage =
    currentOffering?.monthly ||
    currentOffering?.availablePackages?.find(
      (pkg) =>
        pkg.identifier === "$rc_monthly" ||
        pkg.identifier.toLowerCase().includes("monthly")
    ) ||
    null;

  /**
   * Resolve annual package from RevenueCat offering.
   * Tries explicit .annual property first, then searches availablePackages.
   * Matches both "annual" and "yearly" naming conventions.
   */
  const annualPackage =
    currentOffering?.annual ||
    currentOffering?.availablePackages?.find(
      (pkg) =>
        pkg.identifier === "$rc_annual" ||
        pkg.identifier.toLowerCase().includes("annual") ||
        pkg.identifier.toLowerCase().includes("yearly")
    ) ||
    null;

  /**
   * Auto-select best plan when packages load.
   * Prefers annual (higher LTV) but falls back to monthly.
   * Uses (current ?? value) to never override user's manual selection.
   */
  useEffect(() => {
    if (annualPackage) {
      setSelectedPackage((current) => current ?? annualPackage);
      return;
    }

    if (monthlyPackage) {
      setSelectedPackage((current) => current ?? monthlyPackage);
    }
  }, [annualPackage, monthlyPackage]);

  /**
   * Calculate annual plan savings percentage as a marketing badge.
   * Example: monthly $9.99 * 12 = $119.88; annual $79.99 → 33% savings.
   * Returns null if savings not meaningful (annual costs more) or packages unavailable.
   */
  const annualSavings = useMemo(() => {
    if (!monthlyPackage || !annualPackage) return null;

    const monthlyPrice = monthlyPackage.product.price;
    const annualPrice = annualPackage.product.price;
    const yearlyIfMonthly = monthlyPrice * 12;
    const savings = Math.round(
      ((yearlyIfMonthly - annualPrice) / yearlyIfMonthly) * 100
    );

    return savings > 0 ? savings : null;
  }, [annualPackage, monthlyPackage]);

  /**
   * CTA (Call-To-Action) busy state. Excludes subscriptionLoading intentionally:
   * when currentOffering is absent, the button is already disabled via !selectedPackage.
   * Including subscriptionLoading caused race condition bugs where button stayed disabled
   * after user cancelled a purchase if the identity sync was still loading.
   */
  const ctaBusy = isPurchasing || isPreparingGuestCheckout;
  const isLoadingPackages = subscriptionLoading && !currentOffering;

  /**
   * Complete onboarding and navigate to destination.
   * Persists onboarding completion flag and clears IndexScreen's check.
   */
  const completeOnboarding = useCallback(
    async (target: OnboardingDestination) => {
      await markOnboardingSeen();
      router.replace(target);
    },
    [router]
  );

  /**
   * Execute purchase and advance to home on success.
   * Returns boolean for caller to handle failure (e.g., user cancelled, payment declined).
   * Always resets isPurchasing to allow retries.
   */
  const executePurchase = useCallback(
    async (pkg: PurchasesPackage): Promise<boolean> => {
      setIsPurchasing(true);

      try {
        const success = await purchasePackage(pkg);
        if (success) {
          await completeOnboarding("/(tabs)/home");
        }
        return success;
      } finally {
        setIsPurchasing(false);
      }
    },
    [completeOnboarding, purchasePackage]
  );

  /**
   * Deferred purchase handler: executes pending purchase once auth + subscription context stabilize.
   * Pattern: Guest taps "Subscribe" → sign in anonymously → once user exists, execute purchase.
   * Prevents race conditions by waiting for authLoading and subscriptionLoading to settle.
   */
  useEffect(() => {
    if (
      !pendingPackage ||
      authLoading ||
      !user ||
      subscriptionLoading ||
      isPurchasing
    ) {
      return;
    }

    // Clear pending state and execute once all conditions met
    const pkg = pendingPackage;
    setPendingPackage(null);
    void executePurchase(pkg);
  }, [
    authLoading,
    executePurchase,
    isPurchasing,
    pendingPackage,
    subscriptionLoading,
    user,
  ]);

  /**
   * Navigate to a specific page (0-2) with animated scroll.
   * Clamps index and skips scroll if already on page 2 (subscription page).
   */
  const goToPage = useCallback(
    (index: number, animated = true) => {
      const nextIndex = Math.max(0, Math.min(index, 2));
      setActiveIndex(nextIndex);
      if (nextIndex < 2) {
        scrollRef.current?.scrollTo({
          x: nextIndex * width,
          animated,
        });
      }
    },
    [width]
  );

  /**
   * Advance one page or reach the subscription page.
   * Wired to "Next" button in header.
   */
  const handleNext = useCallback(() => {
    if (activeIndex < 2) {
      goToPage(activeIndex + 1);
    }
  }, [activeIndex, goToPage]);

  /**
   * Update activeIndex when user manually swipes.
   * Fired by onMomentumScrollEnd on the horizontal ScrollView.
   */
  const handlePagerEnd = useCallback(
    (event: {
      nativeEvent: { contentOffset: { x: number } };
    }) => {
      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
      setActiveIndex(Math.max(0, Math.min(nextIndex, 2)));
    },
    [width]
  );

  /**
   * Complete onboarding and navigate to login screen.
   * Allows users to skip onboarding and create a named account later.
   */
  const handleSignIn = useCallback(async () => {
    await completeOnboarding("/login");
  }, [completeOnboarding]);

  /**
   * Handle subscription button press.
   * Two flows:
   * 1. No user: Sign in anonymously first (guest checkout), then queue purchase via pendingPackage
   * 2. User exists: Execute purchase immediately
   *
   * The pendingPackage effect will kick in once auth completes, executing the queued purchase.
   */
  const handleSubscribe = useCallback(async () => {
    if (!selectedPackage || isPurchasing) {
      return;
    }

    if (!user) {
      // Guest checkout: queue purchase and sign in anonymously
      try {
        setPendingPackage(selectedPackage);
        setIsPreparingGuestCheckout(true);
        await signInAnonymously();
        // Once signInAnonymously completes, pendingPackage effect will fire executePurchase
      } catch (error: unknown) {
        setPendingPackage(null);
        const errorMessage = error instanceof Error ? error.message : "Please try again in a moment.";
        Alert.alert(
          "Unable to start checkout",
          errorMessage
        );
      } finally {
        setIsPreparingGuestCheckout(false);
      }
      return;
    }

    // User already exists; execute purchase directly
    const success = await executePurchase(selectedPackage);
    if (!success) {
      // User cancelled or payment failed; reset for retry
      setPendingPackage(null);
      setIsPreparingGuestCheckout(false);
    }
  }, [executePurchase, isPurchasing, selectedPackage, signInAnonymously, user]);

  /**
   * Render feature list with icons. Used on pages 0 and 1 of the carousel.
   */
  const renderFeatureList = (
    items: ReadonlyArray<{
      icon: keyof typeof Ionicons.glyphMap;
      label: string;
    }>
  ) => (
    <View style={styles.featureList}>
      {items.map((item) => (
        <View key={item.label} style={styles.featureRow}>
          <View style={styles.featureIconWrap}>
            <Ionicons name={item.icon} size={20} color={theme.colors.primary} />
          </View>
          <Text style={styles.featureText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );

  /**
   * Render a subscription plan card with toggle, price, and highlight badge.
   * Disabled if pkg is null (plan not loaded from RevenueCat).
   */
  const renderPlanCard = (
    title: string,
    description: string,
    pkg: PurchasesPackage | null,
    highlight?: string
  ) => {
    const isSelected = selectedPackage?.identifier === pkg?.identifier;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.planCard,
          isSelected && styles.planCardSelected,
          !pkg && styles.planCardDisabled,
          pressed && pkg && styles.buttonPressed,
        ]}
        onPress={() => pkg && setSelectedPackage(pkg)}
        disabled={!pkg}
      >
        <View style={styles.planTopRow}>
          <View style={styles.planCopy}>
            <Text style={styles.planTitle}>{title}</Text>
            <Text style={styles.planPrice}>
              {pkg ? pkg.product.priceString : "Loading..."}
              {title === "Monthly" ? "/month" : "/year"}
            </Text>
            <Text style={styles.planDescription}>{description}</Text>
          </View>
          <View
            style={[
              styles.planRadio,
              isSelected && styles.planRadioSelected,
            ]}
          >
            {isSelected && <View style={styles.planRadioInner} />}
          </View>
        </View>

        {highlight ? (
          <View style={styles.highlightBadge}>
            <Text style={styles.highlightText}>{highlight}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  /**
   * Render header action button based on current page.
   * Pages 0-1: "Next" button advances carousel
   * Page 2: "Sign In" button skips subscribe and goes to login
   */
  const renderHeaderAction = () => {
    if (activeIndex === 2) {
      return (
        <Pressable
          onPress={handleSignIn}
          hitSlop={8}
          style={pressableStyle(styles.headerButton, styles.buttonPressed)}
        >
          <Text style={styles.headerButtonText}>Sign In</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={handleNext}
        hitSlop={8}
        style={pressableStyle(styles.headerButton, styles.buttonPressed)}
      >
        <Text style={styles.headerButtonText}>Next</Text>
      </Pressable>
    );
  };

  /**
   * Render page 2: subscription selection and checkout.
   * Shows plan cards, calculates savings, and triggers handleSubscribe on CTA.
   */
  const renderSubscribePage = () => (
    <ScrollView
      style={styles.subscribePage}
      contentContainerStyle={styles.subscribePageContent}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {/* Hero section with gradient and copy */}
      <LinearGradient
        colors={
          isDark
            ? [theme.colors.primaryDark, theme.colors.background]
            : [theme.colors.accentLight, theme.colors.background]
        }
        style={styles.heroCardCompact}
      >
        <View
          style={[
            styles.heroIconBubbleSmall,
            { backgroundColor: theme.colors.accent },
          ]}
        >
          <Ionicons name="sparkles" size={28} color="#fff" />
        </View>
        <Text style={styles.eyebrow}>Unlock full access</Text>
        <Text style={styles.titleCompact}>Choose your subscription</Text>
        <Text style={styles.bodyCompact}>
          Subscribe for all courses and the full premium library.
        </Text>
      </LinearGradient>

      <View style={styles.planList}>
        {renderPlanCard("Monthly", "Flexible access", monthlyPackage)}
        {renderPlanCard(
          "Yearly",
          annualSavings ? `Best value · save ${annualSavings}%` : "Best value",
          annualPackage,
          annualSavings ? `Save ${annualSavings}%` : "Best value"
        )}
      </View>

      <Text style={styles.subscriptionHint}>
        {monthlyPackage || annualPackage
          ? "Full access includes all courses and the premium meditation, sleep, and sound library."
          : "Subscription plans are loading. If they do not appear, use Sign In and try again from inside the app."}
      </Text>

      <Pressable
        onPress={handleSubscribe}
        disabled={!selectedPackage || ctaBusy}
        style={({ pressed }) => [
          styles.subscribeButton,
          (!selectedPackage || ctaBusy) && styles.primaryButtonDisabled,
          pressed && !ctaBusy && styles.buttonPressed,
        ]}
      >
        {ctaBusy || isLoadingPackages ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.subscribeButtonText}>
            Continue with Subscription
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );

  return (
    <View style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.progressWrap}>
          <Text style={styles.progressLabel}>{activeIndex + 1} / 3</Text>
          <View style={styles.progressTrack}>
            {[0, 1, 2].map((index) => (
              <View
                key={index}
                style={[
                  styles.progressSegment,
                  index <= activeIndex && styles.progressSegmentActive,
                ]}
              />
            ))}
          </View>
        </View>
        {renderHeaderAction()}
      </View>

      {/* Carousel pages 0 and 1 */}
      {activeIndex < 2 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onMomentumScrollEnd={handlePagerEnd}
          scrollEventThrottle={16}
        >
          <View style={[styles.page, { width }]}>
            <View style={styles.pageInner}>
              <LinearGradient
                colors={
                  isDark
                    ? [theme.colors.surface, theme.colors.background]
                    : [theme.colors.primaryLight, theme.colors.background]
                }
                style={styles.heroCard}
              >
                <View style={styles.heroIconBubble}>
                  <Ionicons name="leaf" size={34} color="#fff" />
                </View>
                <Text style={styles.eyebrow}>Start free</Text>
                <Text style={styles.title}>Free content to begin</Text>
                <Text style={styles.body}>
                  Guided meditations, sleep stories, and white noise are available
                  without a subscription.
                </Text>
              </LinearGradient>

              {renderFeatureList(FREE_CONTENT_ITEMS)}

              <View style={styles.swipeHintRow}>
                <Ionicons
                  name="swap-horizontal-outline"
                  size={16}
                  color={theme.colors.textLight}
                />
                <Text style={styles.swipeHintText}>Swipe to keep exploring</Text>
              </View>
            </View>
          </View>

          <View style={[styles.page, { width }]}>
            <View style={styles.pageInner}>
              <LinearGradient
                colors={
                  isDark
                    ? [theme.colors.surfaceElevated, theme.colors.background]
                    : [theme.colors.secondaryLight, theme.colors.background]
                }
                style={styles.heroCard}
              >
                <View
                  style={[
                    styles.heroIconBubble,
                    { backgroundColor: theme.colors.secondary },
                  ]}
                >
                  <Ionicons name="school" size={34} color="#fff" />
                </View>
                <Text style={styles.eyebrow}>Go beyond meditation</Text>
                <Text style={styles.title}>Psychology-based courses</Text>
                <Text style={styles.body}>
                  Explore self-help courses inspired by CBT, ACT, and other
                  practical approaches to emotional wellbeing.
                </Text>
              </LinearGradient>

              {renderFeatureList(COURSE_ITEMS)}

              <View style={styles.swipeHintRow}>
                <Ionicons
                  name="swap-horizontal-outline"
                  size={16}
                  color={theme.colors.textLight}
                />
                <Text style={styles.swipeHintText}>Swipe again for plans</Text>
              </View>
            </View>
          </View>

          <View style={[styles.page, { width }]} />
        </ScrollView>
      ) : (
        renderSubscribePage()
      )}
    </View>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingTop: 24,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.md,
      gap: theme.spacing.md,
    },
    progressWrap: {
      flex: 1,
      gap: theme.spacing.sm,
    },
    progressLabel: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 13,
      color: theme.colors.textLight,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    progressTrack: {
      flexDirection: "row",
      gap: theme.spacing.sm,
    },
    progressSegment: {
      flex: 1,
      height: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.gray[200],
    },
    progressSegmentActive: {
      backgroundColor: theme.colors.primary,
    },
    headerButton: {
      minHeight: 42,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.borderRadius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.text,
    },
    page: {
      flex: 1,
    },
    pageInner: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.lg,
    },
    subscribePage: {
      flex: 1,
    },
    subscribePageContent: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.lg,
    },
    heroCard: {
      borderRadius: theme.borderRadius.xxl,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.xxl,
      minHeight: 280,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: isDark ? theme.colors.border : `${theme.colors.primary}20`,
    },
    heroCardCompact: {
      borderRadius: theme.borderRadius.xxl,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.xl,
      alignItems: "center",
      borderWidth: 1,
      borderColor: isDark ? theme.colors.border : `${theme.colors.primary}20`,
    },
    heroIconBubble: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.lg,
      ...theme.shadows.md,
    },
    heroIconBubbleSmall: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.md,
      ...theme.shadows.sm,
    },
    eyebrow: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: theme.colors.textLight,
      marginBottom: theme.spacing.sm,
    },
    title: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 32,
      lineHeight: 38,
      color: theme.colors.text,
      textAlign: "center",
      marginBottom: theme.spacing.md,
    },
    titleCompact: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 28,
      lineHeight: 34,
      color: theme.colors.text,
      textAlign: "center",
      marginBottom: theme.spacing.sm,
    },
    body: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 16,
      lineHeight: 25,
      color: theme.colors.textLight,
      textAlign: "center",
      maxWidth: 320,
    },
    bodyCompact: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 15,
      lineHeight: 23,
      color: theme.colors.textLight,
      textAlign: "center",
      maxWidth: 320,
    },
    featureList: {
      gap: theme.spacing.md,
    },
    featureRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.borderRadius.xl,
      backgroundColor: theme.colors.surface,
      ...theme.shadows.sm,
    },
    featureIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: `${theme.colors.primary}15`,
      alignItems: "center",
      justifyContent: "center",
    },
    featureText: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.text,
    },
    swipeHintRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing.sm,
      marginTop: "auto",
      paddingTop: theme.spacing.md,
    },
    swipeHintText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: theme.colors.textLight,
    },
    planList: {
      gap: theme.spacing.md,
    },
    planCard: {
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      ...theme.shadows.sm,
    },
    planCardSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: isDark ? theme.colors.surfaceElevated : "#FFFFFF",
    },
    planCardDisabled: {
      opacity: 0.7,
    },
    planTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: theme.spacing.md,
    },
    planCopy: {
      flex: 1,
    },
    planTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 18,
      color: theme.colors.text,
      marginBottom: 6,
    },
    planPrice: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 24,
      color: theme.colors.text,
      marginBottom: 6,
    },
    planDescription: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textLight,
    },
    planRadio: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    planRadioSelected: {
      borderColor: theme.colors.primary,
    },
    planRadioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.primary,
    },
    highlightBadge: {
      alignSelf: "flex-start",
      marginTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.borderRadius.full,
      backgroundColor: `${theme.colors.primary}16`,
    },
    highlightText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 12,
      color: theme.colors.primaryDark,
    },
    subscriptionHint: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.textLight,
      textAlign: "center",
    },
    subscribeButton: {
      minHeight: 56,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.sm,
      ...theme.shadows.md,
    },
    subscribeButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: theme.colors.textOnPrimary,
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    buttonPressed: {
      opacity: 0.9,
      transform: [{ scale: 0.98 }],
    },
  });
