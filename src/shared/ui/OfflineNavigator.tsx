/**
 * OfflineNavigator.tsx
 *
 * Architectural Role:
 * Transparent navigation wrapper that monitors network connectivity and enforces
 * the offline-first experience. When device goes offline, automatically routes to
 * the /downloads page (where only cached content is available). Restores the previous
 * route when connectivity is restored. Wraps the root of the app navigation tree.
 *
 * Design Patterns:
 * - Route State Preservation: Stores the pre-offline route in a ref so the app can
 *   return to the exact screen the user was on when connectivity restores. Avoids
 *   abrupt resets to home.
 * - Network-Driven Navigation: Uses NetworkContext to subscribe to connectivity changes
 *   and triggers router.replace() based on network state. Single source of truth.
 * - Ready-State Guard: Checks rootNavigationState?.key before navigating to ensure the
 *   navigation system is ready. Prevents race conditions during app startup.
 * - Passive Wrapper: Component renders children unmodified. All logic is side effects
 *   triggered by network state changes. Pure presentational wrapper pattern.
 *
 * Key Dependencies:
 * - NetworkContext: isOffline and isLoading flags
 * - useRouter: Navigation primitives (replace())
 * - usePathname: Current route detection
 * - useRootNavigationState: Navigation readiness check
 *
 * Consumed By:
 * - App root (wrapper around entire navigation tree)
 */

import React, { useEffect, useRef } from 'react';
import { useRouter, usePathname, useRootNavigationState } from 'expo-router';
import { useNetwork } from '@core/providers/contexts/NetworkContext';

interface OfflineNavigatorProps {
  children: React.ReactNode;
}

/**
 * Component that monitors network status and automatically navigates
 * to the downloads page when offline, and back when online.
 */
export function OfflineNavigator({ children }: OfflineNavigatorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const { isOffline, isLoading } = useNetwork();

  /**
   * Refs to track offline navigation state and preserve the user's previous location.
   * Using refs instead of state avoids re-renders and allows synchronous checks.
   *
   * - previousPathRef: Stores the route the user was on before going offline.
   *   Used to restore them when connectivity returns.
   * - hasNavigatedToOffline: Boolean flag to prevent duplicate navigation checks.
   *   True = we've navigated to /downloads due to offline; false = normal online state.
   */
  const previousPathRef = useRef<string | null>(null);
  const hasNavigatedToOffline = useRef(false);

  /**
   * Detect if currently viewing the downloads page.
   * Checks both exact match and subroutes (e.g., /downloads/media-id).
   */
  const isOnDownloadsPage = pathname === '/downloads' || pathname.startsWith('/downloads/');

  /**
   * Navigation readiness check: Expo Router initializes navigation state asynchronously.
   * We must wait for the key to be set before attempting router.replace().
   * Without this guard, navigation calls during app startup will fail silently.
   */
  // Check if navigation is ready before attempting to navigate
  const navigationReady = rootNavigationState?.key != null;

  /**
   * Effect: Monitor network status and enforce offline-first routing.
   *
   * Two scenarios:
   * 1. Device goes offline (isOffline=true, not already on downloads page):
   *    - Save current path to previousPathRef
   *    - Mark that we've navigated offline (to prevent re-navigation)
   *    - Route to /downloads
   *
   * 2. Connection restored (isOffline=false, was previously offline, on downloads page):
   *    - Clear the offline flag
   *    - Restore previous path if it exists and wasn't /downloads itself
   *    - Fall back to home if no previous path (user wasn't on a cached page)
   *    - Clear the stored path
   *
   * Skips entirely if network is still loading or navigation isn't ready.
   */
  useEffect(() => {
    // Don't do anything while loading initial network state or navigation isn't ready
    if (isLoading || !navigationReady) return;

    // Admin routes work with Firestore (not cached content), so offline
    // redirect is irrelevant and disruptive — skip it entirely.
    const isOnAdminPage = pathname.startsWith('/admin');
    if (isOffline && !isOnDownloadsPage && !isOnAdminPage) {
      // Store current path before navigating to downloads
      previousPathRef.current = pathname;
      hasNavigatedToOffline.current = true;
      router.replace('/downloads');
    } else if (!isOffline && hasNavigatedToOffline.current && isOnDownloadsPage) {
      // Connection restored - navigate back to previous page
      hasNavigatedToOffline.current = false;
      if (previousPathRef.current && previousPathRef.current !== '/downloads') {
        router.replace(previousPathRef.current as any);
      } else {
        router.replace('/(tabs)/home');
      }
      previousPathRef.current = null;
    }
  }, [isOffline, isLoading, isOnDownloadsPage, pathname, navigationReady]);

  return <>{children}</>;
}
