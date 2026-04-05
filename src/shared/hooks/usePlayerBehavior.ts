import { useState, useEffect, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { useSubscription } from '@core/providers/contexts/SubscriptionContext';
import { isFavorite, toggleFavorite, addToListeningHistory } from '@features/home/data/homeRepository';
import { createSession } from '@features/profile/data/profileRepository';
import { getUserRating, setContentRating, reportContent } from '@shared/data/content';
import { RatingType, ReportCategory } from '@/types';
import { useAudioPlayer } from '@shared/hooks/useAudioPlayer';

export interface UsePlayerBehaviorProps {
  contentId: string | undefined;
  contentType: string;
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  title?: string;
  durationMinutes?: number;
  thumbnailUrl?: string;
}

export interface UsePlayerBehaviorReturn {
  // State
  isFavorited: boolean;
  userRating: RatingType | null;
  isLoadingUserData: boolean;

  // Handlers
  onToggleFavorite: () => Promise<void>;
  onPlayPause: () => Promise<void>;
  onRate: (rating: RatingType) => Promise<RatingType | null>;
  onReport: (category: ReportCategory, description?: string) => Promise<boolean>;
}

export function usePlayerBehavior({
  contentId,
  contentType,
  audioPlayer,
  title,
  durationMinutes,
  thumbnailUrl,
}: UsePlayerBehaviorProps): UsePlayerBehaviorReturn {
  const router = useRouter();
  const { user, isAnonymous } = useAuth();
  const { isPremium } = useSubscription();

  // State
  const [isFavoritedState, setIsFavoritedState] = useState(false);
  const [userRating, setUserRating] = useState<RatingType | null>(null);
  const [isLoadingUserData, setIsLoadingUserData] = useState(true);

  // Refs for tracking (to avoid re-triggering)
  const hasTrackedPlay = useRef(false);
  const hasTrackedSession = useRef(false);

  // Reset tracking when content changes
  useEffect(() => {
    hasTrackedPlay.current = false;
    hasTrackedSession.current = false;
  }, [contentId]);

  // Load user data (favorite + rating) on mount
  useEffect(() => {
    async function loadUserData() {
      if (!user || !contentId) {
        setIsLoadingUserData(false);
        return;
      }

      setIsLoadingUserData(true);
      try {
        const [favorited, rating] = await Promise.all([
          isFavorite(user.uid, contentId),
          getUserRating(user.uid, contentId),
        ]);
        setIsFavoritedState(favorited);
        setUserRating(rating);
      } catch (error) {
        console.error('Failed to load user data:', error);
      } finally {
        setIsLoadingUserData(false);
      }
    }

    loadUserData();
  }, [user, contentId]);

  // Track session for stats when user completes 80% of audio
  useEffect(() => {
    async function trackSession() {
      if (
        !hasTrackedSession.current &&
        user &&
        contentId &&
        durationMinutes &&
        audioPlayer.progress >= 0.8 &&
        audioPlayer.duration > 0
      ) {
        hasTrackedSession.current = true;
        try {
          await createSession({
            user_id: user.uid,
            duration_minutes: durationMinutes,
            session_type: contentType as any,
          });
        } catch (error) {
          console.error('Failed to track session:', error);
        }
      }
    }

    trackSession();
  }, [audioPlayer.progress, audioPlayer.duration, user, contentId, contentType, durationMinutes]);

  // Toggle favorite with optimistic update and anonymous user check
  const onToggleFavorite = useCallback(async () => {
    if (!user || !contentId) return;

    // Prompt anonymous users to sign in or link account
    if (isAnonymous) {
      const isLinkMode = isPremium;
      Alert.alert(
        isLinkMode ? 'Link Account Required' : 'Sign In Required',
        isLinkMode 
          ? 'Link your account to save favorites and sync across devices.'
          : 'Create an account to save favorites and sync across devices.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: isLinkMode ? 'Link Account' : 'Sign In', 
            onPress: () => router.push(isLinkMode ? '/login?mode=link' : '/login') 
          },
        ]
      );
      return;
    }

    // Optimistic update
    const previousState = isFavoritedState;
    setIsFavoritedState(!previousState);

    try {
      const newFavorited = await toggleFavorite(user.uid, contentId, contentType as any);
      // Sync with server response in case of mismatch
      if (newFavorited !== !previousState) {
        setIsFavoritedState(newFavorited);
      }
    } catch {
      // Revert on error
      setIsFavoritedState(previousState);
    }
  }, [user, contentId, contentType, isAnonymous, isPremium, isFavoritedState, router]);

  // Play/pause with listening history tracking
  const onPlayPause = useCallback(async () => {
    if (audioPlayer.isPlaying) {
      audioPlayer.pause();
    } else {
      audioPlayer.play();

      // Track listening history on first play
      if (!hasTrackedPlay.current && user && contentId && title && !isAnonymous) {
        hasTrackedPlay.current = true;
        await addToListeningHistory(
          user.uid,
          contentId,
          contentType as any,
          title,
          durationMinutes || 0,
          thumbnailUrl
        );
      }
    }
  }, [audioPlayer, user, contentId, contentType, title, durationMinutes, thumbnailUrl, isAnonymous]);

  // Rate content with optimistic update
  const onRate = useCallback(async (rating: RatingType): Promise<RatingType | null> => {
    if (!user || !contentId) return null;

    // Calculate expected new state optimistically
    const previousRating = userRating;
    const optimisticRating = previousRating === rating ? null : rating;
    
    // Optimistic update
    setUserRating(optimisticRating);

    try {
      const serverRating = await setContentRating(user.uid, contentId, contentType, rating);
      // Sync with server response in case of mismatch
      if (serverRating !== optimisticRating) {
        setUserRating(serverRating);
      }
      return serverRating;
    } catch {
      // Revert on error
      setUserRating(previousRating);
      return previousRating;
    }
  }, [user, contentId, contentType, userRating]);

  // Report content
  const onReport = useCallback(async (category: ReportCategory, description?: string): Promise<boolean> => {
    if (!user || !contentId) return false;
    return await reportContent(user.uid, contentId, contentType, category, description);
  }, [user, contentId, contentType]);

  return {
    isFavorited: isFavoritedState,
    userRating,
    isLoadingUserData,
    onToggleFavorite,
    onPlayPause,
    onRate,
    onReport,
  };
}
