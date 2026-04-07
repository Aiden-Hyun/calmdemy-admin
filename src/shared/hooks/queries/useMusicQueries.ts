/**
 * Music & Audio Query Hooks
 *
 * ARCHITECTURAL ROLE:
 * ViewModel layer for ambient audio content discovery. These hooks fetch audio tracks
 * grouped by category (sleep sounds, white noise, music, ASMR, albums). No user context
 * needed - audio library is available to all user types. Heavy usage in background audio
 * players and meditation session accompaniment.
 *
 * DESIGN PATTERNS:
 * - Category-Based Caching: Each category maintains separate cache for independent refresh
 * - Moderate Caching: 1-hour staleTime balances freshness with performance for media library
 * - No Authentication Gates: Encourages exploration for free/premium content
 *
 * KEY DEPENDENCIES:
 * - React Query: Manages audio library cache with SWR behavior
 * - musicRepository: Data access layer for Firestore audio collections
 * - useAudioPlayer, useBackgroundAudio: Primary consumers of these hooks
 *
 * CACHE INVALIDATION:
 * Invalidate when:
 * 1. Admin adds new audio tracks (background sync)
 * 2. User explicitly refreshes music library
 * 3. Network status changes (offline->online)
 *
 * PERFORMANCE NOTE:
 * Audio metadata can be large (titles, descriptions, cover art URLs). Consider:
 * 1. Pagination if category has 100+ items
 * 2. Lazy loading cover art (separate query)
 * 3. Prefetch in root provider on app startup
 */

import { useQuery } from '@tanstack/react-query';
import {
  getSleepSounds,
  getWhiteNoise,
  getMusic,
  getAsmr,
  getAlbums,
} from '@features/music/data/musicRepository';

/**
 * Fetches sleep-focused audio tracks (rain, thunder, ocean waves, etc.)
 *
 * @returns Query object with sleep sounds array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for sleep-specific audio library. Sleep sounds are ambient, non-narrative
 * tracks designed for background playback during meditation or bedtime routines. High usage
 * in sleep meditations and background audio features.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Sleep sound library is stable, infrequent updates
 * - No enabled gate - available to all users including anonymous
 *
 * USAGE PATTERN:
 * Primary consumers:
 * 1. Sleep Meditation screen - pairs meditation with sleep sound
 * 2. Bedtime Routine screen - lists available sleep tracks
 * 3. useBackgroundAudio hook - populates sound selector dropdown
 *
 * CACHE RELATIONSHIP:
 * See useSleepMeditations() in useSleepQueries.ts - often used together in sleep flow.
 * Consider invalidating both when user completes sleep session (for recommendations).
 */
export function useSleepSounds() {
  return useQuery({
    queryKey: ['sleepSounds'],
    queryFn: getSleepSounds,
    staleTime: 1000 * 60 * 60, // 1 hour - stable ambient sound library
  });
}

/**
 * Fetches white noise tracks (brown noise, pink noise, fan, etc.)
 *
 * @returns Query object with white noise array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for noise masking audio. White noise/brown noise is used to mask
 * environmental sounds during meditation or sleep. Often paired with meditation tracks
 * via useBackgroundAudio hook.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Noise library is stable, rarely changes
 * - Separate cache from sleep sounds despite similar use case - allows independent
 *   refresh without refetching sleep track catalog
 */
export function useWhiteNoise() {
  return useQuery({
    queryKey: ['whiteNoise'],
    queryFn: getWhiteNoise,
    staleTime: 1000 * 60 * 60, // 1 hour - stable noise track library
  });
}

/**
 * Fetches music tracks (instrumental, ambient, lo-fi, etc.)
 *
 * @returns Query object with music array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for musical accompaniment content. Music tracks (especially instrumental
 * and ambient) can pair with meditations or be standalone listening content for mindfulness
 * and relaxation.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Music library updates are scheduled, not real-time
 * - High volume expected - largest audio category, consider pagination in repository
 *
 * USAGE PATTERN:
 * Consumers:
 * 1. Music/Relaxation screen - browse musical content
 * 2. useBackgroundAudio - option to play music while meditating
 * 3. Personalization/recommendations - training data for suggestion algorithms
 */
export function useMusic() {
  return useQuery({
    queryKey: ['music'],
    queryFn: getMusic,
    staleTime: 1000 * 60 * 60, // 1 hour - large music library, stable
  });
}

/**
 * Fetches ASMR tracks (whispering, tapping, brushing, etc.)
 *
 * @returns Query object with ASMR array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for ASMR (Autonomous Sensory Meridian Response) audio content.
 * ASMR tracks have dedicated fan base and specific use cases for relaxation/sleep.
 * Separate from other audio categories due to distinct user preferences and discovery patterns.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - ASMR library updates less frequently than music
 * - Niche category - smaller dataset than music or sleep sounds
 */
export function useAsmr() {
  return useQuery({
    queryKey: ['asmr'],
    queryFn: getAsmr,
    staleTime: 1000 * 60 * 60, // 1 hour - niche but stable ASMR content
  });
}

/**
 * Fetches curated audio albums (collections of related tracks)
 *
 * @returns Query object with albums array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for album collections. Albums group related audio content for
 * curated listening experiences (e.g., "Sleep Well Vol. 1", "Meditation Essentials").
 * Enables discovery through curation rather than individual track browsing.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Album metadata and groupings are manually curated
 * - Smaller dataset than individual track queries - albums are collections
 *
 * CACHE RELATIONSHIP:
 * Albums likely reference tracks from useSleepSounds(), useMusic(), etc.
 * Consider whether albums contain full track details or just references (IDs).
 * If references only, users see loading state when clicking album (need track query).
 * If full details, larger cache but faster UX.
 *
 * OPTIMIZATION OPPORTUNITY:
 * Consider paginated albums query if 50+ albums exist, or use infinite scroll with
 * useInfiniteQuery instead of flat array.
 */
export function useAlbums() {
  return useQuery({
    queryKey: ['albums'],
    queryFn: getAlbums,
    staleTime: 1000 * 60 * 60, // 1 hour - curated, stable album collections
  });
}
