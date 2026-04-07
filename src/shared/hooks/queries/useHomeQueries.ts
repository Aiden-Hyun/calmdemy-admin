/**
 * Home Screen Query Hooks
 *
 * ARCHITECTURAL ROLE:
 * ViewModel layer for home screen data queries. Implements the MVVM pattern where hooks encapsulate
 * asynchronous data fetching logic and state management. These hooks are consumers of React Query's
 * cache management and should be called by home screen components that need fresh data.
 *
 * DESIGN PATTERNS:
 * - React Query Wrapper: Wraps React Query's useQuery hook to provide a consistent interface
 * - Stale-While-Revalidate (SWR): Configures staleTime to define when cached data becomes stale
 * - Conditional Query Execution: Uses 'enabled' property to prevent queries when dependencies aren't ready
 * - Cache Key Design: Uses array-based keys with user context to enable proper invalidation
 *
 * KEY DEPENDENCIES:
 * - React Query (@tanstack/react-query): Handles server state management, caching, and synchronization
 * - AuthContext: Provides user authentication state to gate queries behind user existence
 * - homeRepository: Data access layer that handles Firebase calls and API integration
 * - downloadService: Manages local file downloads for offline content access
 *
 * CONSUMERS:
 * - Home screen component: Uses these hooks to populate UI with quotes, history, and favorites
 * - Cache invalidation triggers: Mutations that fetch fresh data when user actions occur
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@core/providers/contexts/AuthContext';
import {
  getTodayQuote,
  getListeningHistory,
  getFavoritesWithDetails,
} from '@features/home/data/homeRepository';
import { getDownloadedContent } from '@/services/downloadService';

/**
 * Fetches daily motivational quote for home screen
 *
 * @returns Query object with quote data, loading state, and refresh function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook that manages quote data. Runs independently of user state to allow
 * anonymous users to see daily quotes. Implements Stale-While-Revalidate pattern
 * with aggressive caching (24 hour staleTime) to minimize API calls for static content.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 24 hours (86400000ms) - After 24 hours, cached data becomes stale and
 *   will refetch in background on next query execution (SWR behavior)
 * - No cacheTime specified - uses React Query default (5 minutes) for garbage collection
 * - No 'enabled' gate - query runs regardless of user state
 *
 * PERFORMANCE NOTE:
 * Aggressive 24-hour cache assumes quote content rarely changes. If dynamic quotes are
 * needed per session, reduce staleTime or use useQueryClient().invalidateQueries() after
 * user login to fetch personalized quotes.
 */
export function useTodayQuote() {
  return useQuery({
    queryKey: ['todayQuote'],
    queryFn: getTodayQuote,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours - aggressive cache for static daily content
  });
}

/**
 * Fetches user's recent listening history with configurable limit
 *
 * @param limit Number of recent sessions to fetch (default: 10)
 * @returns Query object with history array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook that provides recent meditation/listening sessions for display on home screen.
 * Demonstrates conditional query execution pattern - query only runs when user is authenticated.
 *
 * CACHE KEY DESIGN:
 * ['listeningHistory', user?.uid, limit] - Includes user ID and limit to properly cache
 * different result sets. This allows home screen to display 10 items while history page
 * displays 50 items without cache collision.
 *
 * REACT QUERY CONFIGURATION:
 * - enabled: !!user?.uid - Query gate ensures firebase call doesn't occur before auth state
 *   is ready. This prevents failed queries and wasted network requests. Query will automatically
 *   retry when user becomes available (Observer pattern - React Query watches enabled dependency).
 * - staleTime: NOT SET (uses 0ms default) - Enables immediate refetch when component remounts,
 *   ensuring users see latest sessions after completing new content
 *
 * AUTHENTICATION DEPENDENCY:
 * The user?.uid check in enabled gate acts as an Observer of AuthContext state. When user
 * logs in/out, React Query automatically triggers enabled evaluation and refetch if needed.
 *
 * NON-OBVIOUS LOGIC:
 * The user! non-null assertion in queryFn is safe because queryFn only runs when
 * enabled=true, which guarantees user exists. This is a common React Query pattern.
 */
export function useListeningHistory(limit = 10) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['listeningHistory', user?.uid, limit],
    queryFn: () => getListeningHistory(user!.uid, limit),
    enabled: !!user?.uid, // Query gate: prevent execution until user is authenticated (Observer pattern)
  });
}

/**
 * Fetches user's favorited content with full metadata
 *
 * @returns Query object with favorites array (content objects), loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook that provides list of user-favorited meditation/music sessions. Requires
 * authenticated user and uses conditional query execution. Primary consumer is Favorites
 * screen tab and content detail pages that show "Add to Favorites" button state.
 *
 * CACHE KEY DESIGN:
 * ['favorites', user?.uid] - Scoped to user to prevent cross-user cache contamination.
 * This is critical for multi-user scenarios or account switching.
 *
 * REACT QUERY CONFIGURATION:
 * - enabled: !!user?.uid - Query gate prevents firebase calls for anonymous users
 * - staleTime: NOT SET (uses 0ms default) - Favorites list is user-mutated state.
 *   Without staleTime, every navigation back to favorites screen triggers refetch,
 *   ensuring UI reflects fresh favorite status from other sessions/tabs
 *
 * CACHE INVALIDATION:
 * This query should be invalidated when:
 * 1. User toggles favorite on any content (handled by useMutation in usePlayerBehavior)
 * 2. User logs in/out (AuthContext state change triggers enabled re-evaluation)
 * 3. Explicit refetch via onSettle callbacks in mutation hooks
 *
 * PERFORMANCE OPTIMIZATION:
 * Consider increasing staleTime to 5 minutes if favorites list is large (100+ items)
 * and user doesn't toggle favorites frequently. Use useQueryClient().invalidateQueries()
 * in toggle favorite mutation instead.
 */
export function useFavorites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['favorites', user?.uid],
    queryFn: () => getFavoritesWithDetails(user!.uid),
    enabled: !!user?.uid, // Query gate: user-dependent data
  });
}

/**
 * Fetches list of content downloaded for offline playback
 *
 * @returns Query object with downloaded items array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook that provides offline-available content list. User-independent query
 * since downloads are stored locally on device. Enables offline-first experience by
 * allowing UI to filter/show only downloaded content when network unavailable.
 *
 * REACT QUERY CONFIGURATION:
 * - No enabled gate - query runs immediately on mount to check what's available offline
 * - staleTime: NOT SET (uses 0ms default) - Downloads are filesystem state that can change
 *   outside React (manual file deletion, app cache clearing). Always refetch on remount.
 *
 * CACHE INVALIDATION:
 * Should be invalidated when:
 * 1. Content download completes (handled by download manager mutation)
 * 2. Content deletion requested (handled by delete mutation)
 * 3. User navigates back to offline screen (explicit refetch via useQueryClient)
 *
 * LOCAL STATE CONSIDERATION:
 * Unlike cloud queries (favorites, history), this queries filesystem state via downloadService.
 * Requires careful coordination with download service events to maintain cache freshness.
 * Consider using downloadService event listeners instead of polling via staleTime.
 */
export function useDownloadedContent() {
  return useQuery({
    queryKey: ['downloadedContent'],
    queryFn: getDownloadedContent,
  });
}
