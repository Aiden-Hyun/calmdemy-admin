/**
 * Player Behavior Hook - Content Interaction Orchestration
 *
 * ARCHITECTURAL ROLE:
 * Mid-level ViewModel hook that coordinates user interactions with content during playback:
 * favorites, ratings, listening history, and reporting. Implements optimistic updates,
 * anonymous user handling, and session tracking. Composes multiple repositories and
 * user context providers (Auth, Subscription).
 *
 * DESIGN PATTERNS:
 * - Optimistic Updates: Update UI immediately, revert if server rejects
 * - Anonymous User Gating: Prompt sign-in before allowing user-personalized actions
 * - Session Completion Tracking: Fire analytics when user listens 80% of content
 * - Ref-Based Tracking: Use hasTrackedPlay/hasTrackedSession refs to prevent duplicate tracking
 *
 * KEY RESPONSIBILITIES:
 * 1. Load user favorites and ratings on mount
 * 2. Handle play/pause with listening history tracking (first play only)
 * 3. Toggle favorites with optimistic updates
 * 4. Rate content with toggle behavior (click same rating = unrate)
 * 5. Track session when 80% of content consumed
 * 6. Report inappropriate content
 * 7. Prompt anonymous users to sign in before saving preferences
 *
 * CONSUMERS:
 * - Meditation/music detail screens: Player UI components
 * - Session tracking: Analytics and stats accumulation
 * - Personalization: Ratings and history drive recommendations
 *
 * DEPENDENCIES:
 * - useAuth: User identity and anonymous state
 * - useSubscription: Premium/free content filtering
 * - homeRepository: Favorite toggle and history tracking
 * - profileRepository: Session persistence
 * - content service: Rating and reporting
 * - useAudioPlayer: Playback state (progress, duration, isPlaying)
 *
 * IMPORTANT NOTES:
 * - Refs prevent duplicate history/session entries if effect re-runs
 * - Optimistic updates revert if server call fails (network resilience)
 * - Anonymous users can use player but can't save preferences
 */

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

/**
 * usePlayerBehavior Hook
 *
 * Orchestrate content interactions (favorite, rate, track listening, report) during playback.
 *
 * @param props Content metadata and audio player instance
 * @returns Object with favorites/rating state and handler functions
 *
 * USAGE EXAMPLE:
 *   const behavior = usePlayerBehavior({ contentId: '123', contentType: 'meditation', audioPlayer });
 *   // In header:
 *   <TouchableOpacity onPress={behavior.onToggleFavorite}>
 *     <Icon name={behavior.isFavorited ? 'heart' : 'heart-outline'} />
 *   </TouchableOpacity>
 */
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

  /**
   * FAVORITES AND RATING STATE
   * isFavoritedState: Whether current content is in user's favorites
   * userRating: User's rating for content (1-5 stars, null = unrated)
   * isLoadingUserData: True while fetching initial favorites/ratings from DB
   */
  const [isFavoritedState, setIsFavoritedState] = useState(false);
  const [userRating, setUserRating] = useState<RatingType | null>(null);
  const [isLoadingUserData, setIsLoadingUserData] = useState(true);

  /**
   * TRACKING REFS - Prevent duplicate events
   * hasTrackedPlay: Set to true when user first plays content (track once only)
   * hasTrackedSession: Set to true when user reaches 80% (track once only)
   *
   * WHY REFS? These effects fire on every audioPlayer.progress/duration change.
   * Without refs, we'd track listening history 100+ times per session (bad for DB).
   * With refs, we check: "have I already done this?" before firing API call.
   *
   * Reset both when contentId changes (new content, can track again).
   */
  const hasTrackedPlay = useRef(false);
  const hasTrackedSession = useRef(false);

  /**
   * RESET TRACKING REFS (useEffect)
   * When user navigates to different content, reset tracking refs so we track again.
   * Example: Listen to meditation A, then select meditation B. Ref reset allows B
   * to be tracked as separate listening event.
   *
   * DEPENDENCY: [contentId]
   * Fire whenever contentId changes (content selection).
   */
  useEffect(() => {
    hasTrackedPlay.current = false;
    hasTrackedSession.current = false;
  }, [contentId]);

  /**
   * LOAD USER DATA (useEffect)
   * On mount, fetch whether user favorited this content and what rating they gave it.
   * Run in parallel using Promise.all for efficiency.
   *
   * CONDITION:
   * Only runs if user exists and contentId available. For anonymous users, skips.
   *
   * DEPENDENCY: [user, contentId]
   * Re-run when user logs in/out or navigates to different content.
   *
   * ERROR HANDLING:
   * If fetch fails, show loading=false anyway (prevent infinite loading state).
   * Log error but don't crash (graceful degradation).
   */
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

  /**
   * TRACK SESSION (useEffect)
   * When user reaches 80% of content, save meditation session to database for stats.
   * This counts toward user's meditation statistics (total time, sessions completed, etc).
   *
   * CONDITION CHECKS:
   * 1. !hasTrackedSession.current - Haven't tracked this content yet
   * 2. user && contentId && durationMinutes - Required data available
   * 3. audioPlayer.progress >= 0.8 - User reached 80% through content
   * 4. audioPlayer.duration > 0 - Valid duration (not loading/errored)
   *
   * SET REF TO PREVENT RE-RUNS:
   * hasTrackedSession = true prevents firing on every render after 80%
   * Without this, we'd create multiple duplicate session records.
   *
   * DEPENDENCY: [audioPlayer.progress, audioPlayer.duration, user, contentId, contentType, durationMinutes]
   * Fires every time progress changes. Ref guard prevents duplicate tracking.
   */
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

  /**
   * TOGGLE FAVORITE ACTION (useCallback)
   * User tapped heart icon. Toggle favorite status with optimistic UI update.
   *
   * ANONYMOUS USER HANDLING:
   * If user is anonymous, prompt to sign in or link account before saving.
   * Alert shows different copy depending on Premium status:
   * - Premium user: "Link Account" (upgrade flow)
   * - Free user: "Sign In" (create account or login)
   *
   * OPTIMISTIC UPDATE PATTERN:
   * 1. Immediately reverse favorite state in UI (good UX, feels instant)
   * 2. Async call to server
   * 3. If server disagrees, sync UI to server response
   * 4. If error, revert to previous state
   *
   * NON-OBVIOUS LOGIC:
   * If newFavorited !== !previousState, we revert. This handles case where
   * concurrent requests conflict (two devices toggling simultaneously).
   *
   * DEPENDENCY: [user, contentId, contentType, isAnonymous, isPremium, isFavoritedState, router]
   * Recreate when state/user changes.
   */
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

  /**
   * PLAY/PAUSE ACTION (useCallback)
   * Handle play/pause button tap. Track listening history on first play only.
   *
   * FIRST PLAY TRACKING:
   * When user presses play for first time (!hasTrackedPlay), add to listening history.
   * This records which content user engaged with (used for recommendations).
   * Ref guard prevents tracking 100+ times during playback.
   *
   * ANONYMOUS SKIP:
   * Skip tracking if user is anonymous (no account to associate history with).
   *
   * DEPENDENCY: [audioPlayer, user, contentId, contentType, title, durationMinutes, thumbnailUrl, isAnonymous]
   * Recreate when any change (pause/resume listening affects this).
   */
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

  /**
   * RATE CONTENT ACTION (useCallback)
   * User tapped a star rating. Toggle behavior: same rating = unrate, different = rate.
   *
   * TOGGLE SEMANTICS:
   * - User has no rating, selects 4 stars -> rating becomes 4
   * - User has 4-star rating, selects 4 stars again -> rating becomes null (unrate)
   * - User has 4-star rating, selects 3 stars -> rating becomes 3
   * This mirrors like button behavior (click same = unlike).
   *
   * OPTIMISTIC UPDATE:
   * Calculate optimisticRating before server call, update UI immediately.
   * If server disagrees, sync to server response (other devices updated it).
   * If error, revert to previous rating.
   *
   * RETURN VALUE:
   * Returns new rating from server (or null if unrated). Used for UI state sync.
   *
   * DEPENDENCY: [user, contentId, contentType, userRating]
   * Recreate when rating changes (user rate action).
   */
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

  /**
   * REPORT CONTENT ACTION (useCallback)
   * User flagged content as inappropriate. Fire-and-forget to moderation system.
   *
   * CATEGORY EXAMPLES: 'offensive', 'copyrighted', 'spam', 'other'
   * DESCRIPTION: Optional user explanation of the issue.
   *
   * NO FEEDBACK:
   * Report doesn't show confirmation dialog (fire-and-forget). Server handles queuing
   * to moderation queue. If we showed alert on every report, UX becomes annoying.
   *
   * DEPENDENCY: [user, contentId, contentType]
   * Recreate when content changes.
   */
  const onReport = useCallback(async (category: ReportCategory, description?: string): Promise<boolean> => {
    if (!user || !contentId) return false;
    return await reportContent(user.uid, contentId, contentType, category, description);
  }, [user, contentId, contentType]);

  /**
   * RETURN VALUE - Interface for player screens
   *
   * STATE:
   * - isFavorited: Content in user's favorites (heart filled/outline)
   * - userRating: User's star rating (or null if unrated)
   * - isLoadingUserData: True while fetching favorites/ratings from DB
   *
   * ACTIONS:
   * - onToggleFavorite(): Toggle favorite status with server sync
   * - onPlayPause(): Play/pause audio with listening history tracking
   * - onRate(rating): Rate content with toggle semantics
   * - onReport(category, description): Report content to moderation queue
   */
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
