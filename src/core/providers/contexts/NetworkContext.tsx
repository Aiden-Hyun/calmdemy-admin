/**
 * ============================================================
 * NetworkContext.tsx — Network Status Management
 *                      (Observable Adapter + Graceful Degradation)
 * ============================================================
 *
 * Architectural Role:
 *   Detects network connectivity (online/offline) and exposes it to the app.
 *   Used by screens to disable certain operations when offline, or show an
 *   offline indicator to the user.
 *
 * Design Patterns:
 *   - Provider Pattern: exposes network state via useNetwork hook
 *   - Observable Adapter: wraps NetInfo's subscription model into simple state
 *   - Graceful Degradation: assumes "connected" if the native module isn't
 *     available, rather than crashing. This keeps the app working even when
 *     the network module fails.
 *   - Lazy Loading: NetInfo (native module) is loaded at module scope, not
 *     during provider initialization, with a try/catch to handle missing deps
 *
 * Key Dependencies:
 *   - @react-native-community/netinfo (optional native module)
 *
 * Consumed By:
 *   - OfflineNavigator (shows offline UI when isOffline is true)
 *   - Content screens (to disable actions when offline)
 * ============================================================
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type {
  NetInfoState,
  NetInfoSubscription,
} from '@react-native-community/netinfo';

interface NetworkContextType {
  isConnected: boolean;
  isOffline: boolean;
  isLoading: boolean;
  refresh: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

interface NetworkProviderProps {
  children: ReactNode;
}

/**
 * Module-level initialization: Load the NetInfo native module with graceful fallback.
 *
 * This is extracted to module scope (not inside the component) so it runs once.
 * The try/catch means if NetInfo isn't available (e.g., testing, web, or missing
 * native dependency), the app still works — it just assumes the device is always
 * connected. This is the Graceful Degradation pattern: lose functionality, but
 * don't crash.
 */
let NetInfo: typeof import('@react-native-community/netinfo') | null = null;
let networkModuleAvailable = false;

try {
  NetInfo = require('@react-native-community/netinfo');
  networkModuleAvailable = true;
} catch (error) {
  console.warn('NetInfo native module not available. Network detection disabled.');
  networkModuleAvailable = false;
}

/**
 * Helper: extract isConnected from NetInfo state.
 *
 * Simple utility to safely read the isConnected field with a default fallback.
 * The ?? operator means if isConnected is undefined or null, default to true
 * (assume connected). This is defensive programming.
 */
function getConnectivity(state?: Pick<NetInfoState, 'isConnected'> | null): boolean {
  return state?.isConnected ?? true;
}

/**
 * NetworkProvider component — manages network state.
 *
 * This provider tracks whether the device is online or offline by subscribing
 * to NetInfo events. It gracefully handles the case where NetInfo isn't available
 * by assuming the device is always connected.
 */
export function NetworkProvider({ children }: NetworkProviderProps) {
  // Whether the device is currently connected to a network
  const [isConnected, setIsConnected] = useState(true);

  // Whether we're still waiting for the initial network state check
  const [isLoading, setIsLoading] = useState(networkModuleAvailable);

  /**
   * Action: check network state immediately and return the result.
   *
   * This is extracted to a useCallback so it can be used in multiple places
   * (initial check, manual refresh). If NetInfo is unavailable, returns true
   * (assume connected). This is Graceful Degradation — lose the feature but
   * don't break the app.
   */
  const checkNetworkState = useCallback(async (): Promise<boolean> => {
    if (!networkModuleAvailable || !NetInfo) {
      // If module not available, assume connected
      return true;
    }

    try {
      const networkState = await NetInfo.fetch();
      return getConnectivity(networkState);
    } catch (error) {
      // On error, assume connected to not block the user
      console.warn('Error checking network state:', error);
      return true;
    }
  }, []);

  /**
   * Effect: subscribe to network state changes (if module available).
   *
   * Pattern 1: If NetInfo is not available, skip the subscription and assume
   *            the device is always connected.
   * Pattern 2: If NetInfo is available, subscribe to change events via
   *            addEventListener, then immediately seed the state with a
   *            checkNetworkState() call (don't wait for the first event).
   * Pattern 3: Race condition guard: isMounted flag prevents state updates
   *            after unmount.
   */
  useEffect(() => {
    if (!networkModuleAvailable) {
      // Module not available, assume always connected
      setIsConnected(true);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    /**
     * Callback: handle network state changes from NetInfo.
     *
     * Called immediately when the subscription is set up, then whenever
     * the network state changes. We extract the connectivity state and
     * mark isLoading as false (done with initial check).
     */
    const handleNetworkChange = (state: NetInfoState) => {
      if (!isMounted) {
        return;
      }

      setIsConnected(getConnectivity(state));
      setIsLoading(false);
    };

    // Subscribe to network state changes
    const unsubscribe: NetInfoSubscription | undefined = NetInfo?.addEventListener(
      handleNetworkChange
    );

    /**
     * Seed state immediately instead of waiting for the first subscription callback.
     *
     * NetInfo's addEventListener callback fires immediately, but we also call
     * checkNetworkState() proactively to get the current state right away.
     * This is a form of eager initialization — we don't wait for the subscription
     * to fire; we go get the state ourselves. This reduces the initial isLoading time.
     */
    checkNetworkState().then((connected) => {
      if (!isMounted) {
        return;
      }

      setIsConnected(connected);
      setIsLoading(false);
    });

    /**
     * Cleanup function: unsubscribe from NetInfo and mark unmounted.
     *
     * The isMounted flag ensures that if checkNetworkState's promise resolves
     * after unmount, we won't update state (React warning prevention).
     */
    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [checkNetworkState]);

  /**
   * Action: manually refresh the network state.
   *
   * Exposed to the context so screens can call refresh() to re-check
   * connectivity on demand (e.g., a "Try Again" button). Returns a promise
   * that resolves to the current connected state.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    const connected = await checkNetworkState();
    setIsConnected(connected);
    return connected;
  }, [checkNetworkState]);

  return (
    <NetworkContext.Provider
      value={{
        isConnected,
        isOffline: !isConnected,  // Convenience bool: opposite of isConnected
        isLoading,
        refresh,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

/**
 * Custom hook: useNetwork — access network status and refresh function.
 *
 * @throws Error if used outside a NetworkProvider
 * @returns NetworkContextType with isConnected, isOffline, isLoading, and refresh()
 */
export function useNetwork(): NetworkContextType {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
