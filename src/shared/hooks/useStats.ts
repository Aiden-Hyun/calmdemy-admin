import { useState, useEffect, useCallback } from 'react';
import { getUserStats } from '@features/profile/data/profileRepository';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { UserStats } from '@/types';

export function useStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const refreshStats = useCallback(async () => {
    await fetchStats();
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    refreshStats,
  };
}
