/**
 * @file IndexScreen.web.tsx
 *
 * Architectural Role:
 *   Web platform entry point. Simplified routing for admin/web audience.
 *   Part of the MVVM View layer for the auth feature (web variant).
 *
 * Design Patterns:
 *   - Strategy: Platform-specific variant (web implementation; see IndexScreen.tsx for native)
 *   - Conditional Routing: Simpler than native—no onboarding flow needed on web
 *
 * Key Dependencies:
 *   - AuthContext: useAuth() hook for user/loading state
 *   - expo-router: Redirect for routing (works on web via react-navigation)
 *
 * Routing Logic:
 *   1. Loading → returns null (router will defer navigation)
 *   2. Authenticated user → /admin (admin dashboard)
 *   3. No user → /login (admin login page)
 *
 * Consumed By:
 *   - expo-router as the initial web root
 */

import { Redirect } from 'expo-router';

import { useAuth } from '@core/providers/contexts/AuthContext';

export default function IndexScreenWeb() {
  const { user, loading } = useAuth();

  // Wait for auth state to initialize before routing
  if (loading) {
    return null;
  }

  // Route authenticated admins to dashboard; others to login
  return <Redirect href={user ? '/admin' : '/login'} />;
}
