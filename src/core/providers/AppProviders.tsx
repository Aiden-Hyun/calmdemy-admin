/**
 * ============================================================
 * AppProviders.tsx — Root Provider Composition
 *                    (Composition Root + Provider Nesting)
 * ============================================================
 *
 * Architectural Role:
 *   This is the composition root for all app-level providers. It nests all
 *   context providers in dependency order, so each provider can depend on
 *   hooks from its ancestors (e.g., SubscriptionProvider uses useAuth).
 *
 * Provider Stack (outside-in, execution order):
 *   1. QueryProvider — TanStack Query (must be outermost for useQuery hooks)
 *   2. ThemeProvider — app theme (light/dark)
 *   3. AuthProvider — authentication & session state
 *   4. SubscriptionProvider — in-app purchases (depends on useAuth for user sync)
 *   5. NetworkProvider — network connectivity
 *   6. SleepTimerProvider — meditation timer state
 *   7. OfflineNavigator — UI wrapper showing offline status
 *   8. children — the actual app content
 *
 * Dependency Order (why each provider is where it is):
 *   - QueryProvider first: TanStack Query must wrap everything that might call useQuery
 *   - ThemeProvider early: needs to be available for all styled components
 *   - AuthProvider before SubscriptionProvider: subscriptions depend on knowing the user
 *   - NetworkProvider and SleepTimerProvider order doesn't matter (independent)
 *   - OfflineNavigator wraps children to show overlay UI
 *
 * Design Patterns:
 *   - Composition Root: assembles the full provider tree
 *   - Decorator Pattern: each provider "wraps" its children
 *   - Nesting: dependencies are ordered correctly so hooks can be called safely
 *
 * Consumed By:
 *   - Root app component (App.tsx or index.tsx)
 *
 * Debugging Aid:
 *   - ProviderBreadcrumb logs provider mount order during startup
 *   - Useful for debugging initialization order issues or startup hangs
 * ============================================================
 */

import React, { useEffect } from 'react';
import { AuthProvider } from '@core/providers/contexts/AuthContext';
import { ThemeProvider } from '@core/providers/contexts/ThemeContext';
import { NetworkProvider } from '@core/providers/contexts/NetworkContext';
import { SleepTimerProvider } from '@core/providers/contexts/SleepTimerContext';
import { SubscriptionProvider } from '@core/providers/contexts/SubscriptionContext';
import { OfflineNavigator } from '@shared/ui/OfflineNavigator';
import { QueryProvider } from './QueryProvider';

/**
 * Helper component: ProviderBreadcrumb — logs provider mount/render for debugging.
 *
 * This wrapper component logs when each provider renders and mounts. During
 * startup, the logs look like:
 *   [Startup] QueryProvider rendering
 *   [Startup] QueryProvider mounted
 *   [Startup] ThemeProvider rendering
 *   [Startup] ThemeProvider mounted
 *   ... etc
 *
 * This helps debug:
 *   - Initialization order issues
 *   - Hangs during startup (which provider is stuck?)
 *   - Effects timing (which providers mounted before others?)
 *
 * The useEffect dependency array includes `name` so the effect re-runs if the
 * name changes (though in this use case, it won't). This is a common pattern
 * to ensure React executes the effect at the right time.
 */
function ProviderBreadcrumb({ name, children }: { name: string; children: React.ReactNode }) {
  if (__DEV__) console.log(`[Startup] ${name} rendering`);
  useEffect(() => {
    if (__DEV__) console.log(`[Startup] ${name} mounted`);
  }, [name]);
  return <>{children}</>;
}

/**
 * AppProviders component — composes all root-level context providers.
 *
 * This component should wrap the entire app (called from index.tsx or App.tsx).
 * All providers are nested with careful attention to dependency order:
 * providers are listed outside-in, which means inner providers (lower in the tree)
 * can safely call hooks from outer providers.
 *
 * @param children - The app content (likely a navigation component like RootNavigator)
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  if (__DEV__) console.log('[Startup] AppProviders rendering');
  return (
    <ProviderBreadcrumb name="QueryProvider">
      <QueryProvider>
        <ProviderBreadcrumb name="ThemeProvider">
          <ThemeProvider>
            <ProviderBreadcrumb name="AuthProvider">
              <AuthProvider>
                <ProviderBreadcrumb name="SubscriptionProvider">
                  <SubscriptionProvider>
                    <ProviderBreadcrumb name="NetworkProvider">
                      <NetworkProvider>
                        <ProviderBreadcrumb name="SleepTimerProvider">
                          <SleepTimerProvider>
                            <ProviderBreadcrumb name="OfflineNavigator">
                              <OfflineNavigator>
                                {children}
                              </OfflineNavigator>
                            </ProviderBreadcrumb>
                          </SleepTimerProvider>
                        </ProviderBreadcrumb>
                      </NetworkProvider>
                    </ProviderBreadcrumb>
                  </SubscriptionProvider>
                </ProviderBreadcrumb>
              </AuthProvider>
            </ProviderBreadcrumb>
          </ThemeProvider>
        </ProviderBreadcrumb>
      </QueryProvider>
    </ProviderBreadcrumb>
  );
}
