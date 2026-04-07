/**
 * User Statistics Hook - Session & Achievement Tracking
 *
 * ARCHITECTURAL ROLE:
 * Low-level ViewModel hook that fetches aggregated user meditation statistics from database.
 * Used by profile/stats screens to display metrics like total sessions, minutes meditated,
 * current streak, and achievements. Simple data-fetching hook without complex state logic.
 *
 * DESIGN PATTERNS:
 * - Simple Data Fetch: Just loads UserStats object from database
 * - User-Gated Query: Only runs if user authenticated
 * - Error Resilience: Logs errors but doesn't crash
 * - Manual Refresh: Provides refreshStats() for pull-to-refresh pattern
 *
 * KEY RESPONSIBILITIES:
 * 1. Fetch user stats on mount (if user authenticated)
 * 2. Track loading state during fetch
 * 3. Handle and log errors gracefully
 * 4. Provide refresh function for manual data reload
 *
 * CONSUMERS:
 * - Profile screen: Displays total sessions, minutes, streaks
 * - Stats/achievements screen: Shows detailed statistics
 * - Dashboard: Shows summary stats in cards
 *
 * DEPENDENCIES:
 * - profileRepository: Database access (getUserStats)
 * - useAuth: User ID for fetching personalized stats
 *
 * IMPORTANT NOTES:
 * - Stats are computed server-side (not in hook) for accuracy and security
 * - No React Query: Simple direct repository call (could be optimized with React Query later)
 * - refreshStats() allows UI to implement pull-to-refresh gesture
 */

import { useState, useEffect, useCallback } from 'react';
import { getUserStats } from '@features/profile/data/profileRepository';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { UserStats } from '@/types';

/**
 * useStats Hook
 *
 * Fetch user's aggregated meditation statistics from database.
 *
 * @returns Object with stats data, loading state, error, and refresh function
 *
 * USAGE EXAMPLE:
 *   const { stats, loading, error, refreshStats } = useStats();
 *   if (loading) return <Spinner />;
 *   if (error) return <ErrorMessage error={error} />;
 *   return (
 *     <View>
 *       <Text>{stats.total_sessions} sessions</Text>
 *       <Text>{stats.total_minutes} minutes</Text>
 *       <TouchableOpacity onPress={refreshStats}>
 *         <Text>Refresh</Text>
 *       </TouchableOpacity>
 *     </View>
 *   );
 */
export function useStats() {
  const { user } = useAuth();

  /**
   * LOCAL STATE
   * stats: UserStats object from database (aggregated metrics)
   * loading: True while fetching from database
   * error: Error message if fetch fails
   *
   * Initial loading=true to show spinner until first fetch completes.
   */
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * FETCH STATS (useCallback)
   * Retrieve user statistics from database.
   *
   * USER-GATED:
   * If user not authenticated, skip fetch and return empty stats.
   * This prevents wasted network requests and error spam for anonymous users.
   *
   * ERROR HANDLING:
   * Catch and log errors. Still set loading=false so UI stops showing spinner.
   * If stats fetch fails, show error message but don't crash.
   *
   * DEPENDENCY: [user]
   * Recreate when user logs in/out.
   */
  const fetchStats = useCallback(async () => {
    if (!user) {
      setStats(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const userStats = await getUserStats(user.uid);
      setStats(userStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
      console.error('Failed to fetch user stats:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  /**
   * MOUNT EFFECT (useEffect)
   * Fetch stats when component mounts or user changes (login/logout).
   *
   * DEPENDENCY: [fetchStats]
   * Fetches whenever fetchStats changes (which depends on user).
   */
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  /**
   * REFRESH ACTION (useCallback)
   * Manually refetch stats. Used for pull-to-refresh pattern in UI.
   *
   * PATTERN:
   * User swipes down on profile screen to refresh stats.
   * Component calls refreshStats() which re-runs fetchStats.
   *
   * DEPENDENCY: [fetchStats]
   */
  const refreshStats = useCallback(async () => {
    await fetchStats();
  }, [fetchStats]);

  /**
   * RETURN VALUE - Clean interface for stats screens
   *
   * STATE:
   * - stats: UserStats object with aggregated metrics (or null while loading)
   * - loading: True while fetching
   * - error: Error message if fetch failed
   *
   * ACTIONS:
   * - refreshStats(): Manually refetch stats (pull-to-refresh)
   */
  return {
    stats,
    loading,
    error,
    refreshStats,
  };
}
