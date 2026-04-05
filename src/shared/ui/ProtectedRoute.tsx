import React, { useEffect } from 'react';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { useRouter, useRootNavigationState } from 'expo-router';
import { LoadingScreen } from './LoadingScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();

  // Check if navigation is ready before attempting to navigate
  const navigationReady = rootNavigationState?.key != null;

  useEffect(() => {
    // Only navigate when auth is done, no user, AND navigation is ready
    if (!loading && !user && navigationReady) {
      router.replace('/login');
    }
  }, [loading, user, router, navigationReady]);

  if (loading) {
    return <LoadingScreen message="Checking authentication..." />;
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
