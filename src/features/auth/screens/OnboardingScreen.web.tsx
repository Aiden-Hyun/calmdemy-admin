/**
 * @file OnboardingScreen.web.tsx
 *
 * Architectural Role:
 *   Web onboarding route handler. Web does not use the native onboarding flow (no carousel).
 *   Instead, routes directly to admin dashboard or login based on auth state.
 *
 * Design Patterns:
 *   - Strategy: Platform-specific variant (web stub; see OnboardingScreen.tsx for native)
 *   - Fallthrough Routing: Web onboarding is skipped; users go straight to login/admin
 *
 * Key Dependencies:
 *   - AuthContext: useAuth() hook for user/loading state
 *   - expo-router: Redirect for routing
 *
 * Routing Logic:
 *   1. Loading → returns null (defer navigation)
 *   2. Authenticated user → /admin
 *   3. No user → /login
 *
 * Consumed By:
 *   - expo-router when /onboarding is accessed on web (redirects immediately)
 */

import { Redirect } from "expo-router";

import { useAuth } from "@core/providers/contexts/AuthContext";

export default function OnboardingScreenWeb() {
  const { user, loading } = useAuth();

  // Wait for auth initialization before routing
  if (loading) {
    return null;
  }

  // Skip onboarding on web; route directly to admin or login
  return <Redirect href={user ? "/admin" : "/login"} />;
}
