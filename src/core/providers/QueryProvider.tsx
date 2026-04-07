/**
 * ============================================================
 * QueryProvider.tsx — React Query Configuration
 *                     (Provider Pattern + Configuration)
 * ============================================================
 *
 * Architectural Role:
 *   Wraps the entire app in TanStack Query (React Query) and configures
 *   default caching and retry behavior. This provider is required for any
 *   component that uses the useQuery hook for server-state management.
 *
 *   React Query (now TanStack Query) is a data-fetching library that handles:
 *   - Caching of API responses
 *   - Background refetching
 *   - Automatic retry on failure
 *   - Request deduplication
 *   - Synchronization across multiple tabs/windows
 *
 * Design Patterns:
 *   - Provider Pattern: QueryClientProvider exposes query capabilities to all
 *     descendants via useQuery, useMutation hooks
 *   - Configuration: queryClient is a singleton configured once at module scope
 *   - Default Options: shared across all queries (staleTime, gcTime, retry)
 *
 * Configuration Rationale:
 *   - staleTime: 5 minutes — queries are considered "fresh" for 5 minutes after
 *     fetching. Background refetches won't happen during this window.
 *   - gcTime (garbage collection): 30 minutes — cached data is kept in memory
 *     for 30 minutes even if not in use. This avoids re-fetching if user
 *     navigates back to a previous screen quickly.
 *   - retry: 2 — failed queries are automatically retried twice before giving up.
 *     This handles transient network failures gracefully.
 *
 * Consumed By:
 *   - Every component that calls useQuery or useMutation
 * ============================================================
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Global QueryClient instance — configured once at module scope.
 *
 * This singleton is shared across the entire app. All queries and mutations
 * use these default options unless overridden at the hook level.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * staleTime: How long before a query is considered "stale"?
       * 5 minutes = fresh data is not refetched for 5 min after initial fetch.
       * Prevents unnecessary background refetches during normal usage.
       */
      staleTime: 1000 * 60 * 5,

      /**
       * gcTime (garbage collection time): How long to keep cached data?
       * 30 minutes = unused cached data is kept for 30 min, then cleared.
       * Allows quick re-navigation without re-fetching.
       */
      gcTime: 1000 * 60 * 30,

      /**
       * retry: How many times to retry failed requests?
       * 2 = try, fail, retry, fail, retry, fail, give up.
       * Handles transient network failures (flaky connections, temp server issues).
       */
      retry: 2,
    },
  },
});

/**
 * QueryProvider component — wraps app in TanStack Query.
 *
 * This provider must wrap any component that uses useQuery/useMutation.
 * Typically mounted at the root of the app.
 *
 * @param children - React components that will use TanStack Query
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
