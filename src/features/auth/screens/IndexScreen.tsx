/**
 * @file IndexScreen.tsx (Native)
 *
 * Architectural Role:
 *   Entry point screen that routes users based on authentication state and onboarding status.
 *   Part of the MVVM View layer for the auth feature.
 *
 * Design Patterns:
 *   - Strategy: Platform-specific variant (native implementation; see IndexScreen.web.tsx for web)
 *   - Conditional Routing: Uses expo-router Redirect based on auth + onboarding state
 *   - Memory Leak Prevention: isMounted flag prevents state updates on unmounted components
 *
 * Key Dependencies:
 *   - AuthContext: useAuth() hook for user/loading state
 *   - onboardingStorage: getHasSeenOnboarding() async check from local storage/AsyncStorage
 *   - expo-router: Redirect component for deep-linking and stack navigation
 *
 * Routing Logic:
 *   1. Loading → LoadingScreen
 *   2. Not seen onboarding + anonymous/no user → /onboarding
 *   3. Authenticated user → /(tabs)/home (main app)
 *   4. No user → /login
 *
 * Consumed By:
 *   - expo-router as the initial stack root (index.tsx)
 */

import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@core/providers/contexts/AuthContext";
import { LoadingScreen } from "@shared/ui/LoadingScreen";
import { getHasSeenOnboarding } from "@features/auth/utils/onboardingStorage";

export default function Index() {
  const { user, loading } = useAuth();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(
    null
  );

  /**
   * Check onboarding status from storage on mount.
   * This must complete before routing to avoid showing blank screens or incorrect flows.
   */
  useEffect(() => {
    // Flag prevents state updates if component unmounts while async operation is in flight
    let isMounted = true;

    getHasSeenOnboarding()
      .then((value) => {
        if (isMounted) {
          setHasSeenOnboarding(value);
        }
      })
      .catch(() => {
        // Treat storage read failure as "not seen" to err on the side of showing onboarding
        if (isMounted) {
          setHasSeenOnboarding(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Show loading screen while auth context initializes or storage is being read
  if (loading || hasSeenOnboarding === null) {
    return <LoadingScreen message="Preparing your first session..." />;
  }

  // Route new/anonymous users through onboarding flow
  if (!hasSeenOnboarding && (!user || user.isAnonymous)) {
    return <Redirect href="/onboarding" />;
  }

  // Route authenticated users to main app; unauthenticated users to login
  return user ? <Redirect href="/(tabs)/home" /> : <Redirect href="/login" />;
}
