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

// Dynamic import to handle cases where native module isn't available
let NetInfo: typeof import('@react-native-community/netinfo') | null = null;
let networkModuleAvailable = false;

// Try to load NetInfo, but don't crash if it's not available
try {
  NetInfo = require('@react-native-community/netinfo');
  networkModuleAvailable = true;
} catch (error) {
  console.warn('NetInfo native module not available. Network detection disabled.');
  networkModuleAvailable = false;
}

function getConnectivity(state?: Pick<NetInfoState, 'isConnected'> | null): boolean {
  return state?.isConnected ?? true;
}

export function NetworkProvider({ children }: NetworkProviderProps) {
  // Default to connected if we can't check network status
  const [isConnected, setIsConnected] = useState(true);
  const [isLoading, setIsLoading] = useState(networkModuleAvailable);

  // Check network state
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

  useEffect(() => {
    if (!networkModuleAvailable) {
      // Module not available, assume always connected
      setIsConnected(true);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const handleNetworkChange = (state: NetInfoState) => {
      if (!isMounted) {
        return;
      }

      setIsConnected(getConnectivity(state));
      setIsLoading(false);
    };

    const unsubscribe: NetInfoSubscription | undefined = NetInfo?.addEventListener(
      handleNetworkChange
    );

    // Seed state immediately instead of waiting for the first subscription callback.
    checkNetworkState().then((connected) => {
      if (!isMounted) {
        return;
      }

      setIsConnected(connected);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [checkNetworkState]);

  // Manual refresh function that returns the current connection state
  const refresh = useCallback(async (): Promise<boolean> => {
    const connected = await checkNetworkState();
    setIsConnected(connected);
    return connected;
  }, [checkNetworkState]);

  return (
    <NetworkContext.Provider
      value={{
        isConnected,
        isOffline: !isConnected,
        isLoading,
        refresh,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextType {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
