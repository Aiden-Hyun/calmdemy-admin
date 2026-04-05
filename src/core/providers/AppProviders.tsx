import React, { useEffect } from 'react';
import { AuthProvider } from '@core/providers/contexts/AuthContext';
import { ThemeProvider } from '@core/providers/contexts/ThemeContext';
import { NetworkProvider } from '@core/providers/contexts/NetworkContext';
import { SleepTimerProvider } from '@core/providers/contexts/SleepTimerContext';
import { SubscriptionProvider } from '@core/providers/contexts/SubscriptionContext';
import { OfflineNavigator } from '@shared/ui/OfflineNavigator';
import { QueryProvider } from './QueryProvider';

// Lightweight wrapper that logs when a provider successfully mounts
function ProviderBreadcrumb({ name, children }: { name: string; children: React.ReactNode }) {
  console.log(`[Startup] ${name} rendering`);
  useEffect(() => {
    console.log(`[Startup] ${name} mounted`);
  }, [name]);
  return <>{children}</>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  console.log('[Startup] AppProviders rendering');
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
