/**
 * ProtectedRoute Component
 *
 * Architectural Role:
 * Authentication guard for protected routes. Prevents access to authenticated
 * screens before the user has verified their identity. Handles navigation timing
 * issues with Expo Router's navigation readiness.
 *
 * Design Patterns:
 * - Route Guard: Conditional route access based on auth state
 * - Loading Boundaries: Distinct UI states for loading, authenticated, unauthenticated
 *
 * Key Dependencies:
 * - useAuth: Auth state (user, loading)
 * - useRouter: Expo Router for navigation
 * - useRootNavigationState: Navigation readiness detection
 *
 * Consumed By:
 * - App navigation structure (wraps authenticated routes)
 *
 * Important: Navigation must be ready before router.replace() is called,
 * otherwise the navigation command is silently ignored. This is why we check
 * rootNavigationState?.key.
 */

import React, { useEffect } from 'react';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { useRouter, useRootNavigationState } from 'expo-router';
import { LoadingScreen } from './LoadingScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute - Authentication guard for protected screens
 *
 * Renders children only if user is authenticated.
 * Redirects unauthenticated users to /login route.
 * Shows loading screen while auth state is being determined.
 *
 * Critical: This respects Expo Router's navigation readiness to prevent
 * "replace" being called before the navigation tree is initialized.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();

  /**
   * Navigation readiness check:
   * Expo Router navigation isn't immediately available. We must wait for
   * rootNavigationState to be initialized (key will be non-null) before
   * calling router.replace(), otherwise the navigation is silently ignored.
   */
  const navigationReady = rootNavigationState?.key != null;

  useEffect(() => {
    // Only redirect when: auth is done loading, user is not authenticated, AND navigation is ready
    if (!loading && !user && navigationReady) {
      router.replace('/login');
    }
  }, [loading, user, router, navigationReady]);

  // While auth is being checked, show a loading screen
  if (loading) {
    return <LoadingScreen message="Checking authentication..." />;
  }

  // Auth check is done, but user is not authenticated
  // Return null to avoid rendering protected content while redirect is pending
  if (!user) {
    return null;
  }

  // User is authenticated, safe to render protected content
  return <>{children}</>;
}
