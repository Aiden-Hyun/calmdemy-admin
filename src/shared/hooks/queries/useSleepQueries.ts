/**
 * Sleep Feature Query Hooks
 *
 * ARCHITECTURAL ROLE:
 * ViewModel layer for sleep-specific content (bedtime stories, sleep meditations, sleep series).
 * These hooks provide curated content designed specifically for sleep initiation and maintenance.
 * No user authentication required - sleep content is available to all user types to encourage
 * healthy sleep habits even for free/anonymous users.
 *
 * DESIGN PATTERNS:
 * - Category Specialization: Separate queries for sleep stories vs meditations vs series
 *   enables independent caching and refresh strategies
 * - Moderate Caching: 1-hour staleTime balances content freshness with API load
 * - Observable Query Dependencies: Can be invalidated together when sleep content updated
 *
 * KEY DEPENDENCIES:
 * - React Query: Manages sleep content cache
 * - sleepRepository: Firestore data access for sleep collections
 * - useSleepSounds (useMusicQueries): Sleep stories often paired with ambient sound
 * - useMeditation hook: Tracks sleep meditation session completion
 *
 * CACHE INVALIDATION STRATEGY:
 * Invalidate all sleep queries together (batch invalidation) when:
 * 1. User completes sleep session (recommendations update)
 * 2. Admin publishes new bedtime story (background sync)
 * 3. Network status changes offline->online
 *
 * Example batch invalidation:
 *   await queryClient.invalidateQueries({ queryKey: ['sleep'] })
 *   This hits all three: bedtimeStories, sleepMeditations, series
 */

import { useQuery } from '@tanstack/react-query';
import { getBedtimeStories, getSleepMeditations, getSeries } from '@features/sleep/data/sleepRepository';

/**
 * Fetches narrated bedtime stories for sleep
 *
 * @returns Query object with stories array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for narrative sleep content. Bedtime stories are longer-form (15-30 min),
 * narrator-led content designed to occupy mind and promote relaxation before sleep.
 * Contrasts with meditation (structured practice) and white noise (ambience).
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Story library updated weekly, not real-time
 * - No enabled gate - available to anonymous and free users
 * - cacheTime: NOT SET (uses 5 min default)
 *
 * CACHE KEY DESIGN:
 * ['bedtimeStories'] - Simple key without user ID. This allows single cache to serve
 * all users. If future requirement adds user-personalized story recommendations,
 * change to ['bedtimeStories', user?.uid] to avoid cross-user contamination.
 *
 * USAGE PATTERN:
 * Primary consumers:
 * 1. Sleep tab - shows featured bedtime stories
 * 2. Story detail screen - displays full story metadata
 * 3. Sleep routine flow - recommends story for wind-down
 *
 * PERFORMANCE NOTE:
 * Stories likely have large metadata (narrator name, description, cover art URL).
 * Repository should minimize field selection on initial list (id, title, duration, thumbnail)
 * and fetch full details only when user clicks story.
 */
export function useBedtimeStories() {
  return useQuery({
    queryKey: ['bedtimeStories'],
    queryFn: getBedtimeStories,
    staleTime: 1000 * 60 * 60, // 1 hour - stable story library
  });
}

/**
 * Fetches meditation sessions optimized for sleep
 *
 * @returns Query object with sleep meditations array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for sleep-focused meditation content. Distinct from useGuidedMeditations()
 * because sleep meditations have different characteristics:
 * - Longer duration (10-30 minutes vs 5-10 min for general meditation)
 * - Slower pacing and voice tone optimized for relaxation
 * - Often used as standalone practice before sleep or paired with sleep sounds
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Sleep meditation library updates on standard content release schedule
 * - No enabled gate - available to all users including anonymous
 *
 * CACHE RELATIONSHIP:
 * Separate from useMeditations() in useMeditateQueries.ts because:
 * 1. Different filtering/curation (sleep-specific meditation)
 * 2. Different usage pattern (bedtime routine vs general meditation)
 * 3. Different cache invalidation timing (sleep sessions complete at night)
 * 4. Allows independent refresh without reloading all meditations
 *
 * USAGE PATTERN:
 * Consumers:
 * 1. Sleep tab - primary source for sleep meditation discovery
 * 2. Sleep routine wizard - recommends sleep meditation based on duration
 * 3. useMeditation hook - takes sleep meditation as session input
 *
 * OPTIMIZATION OPPORTUNITY:
 * Consider adding sort/filter parameters:
 *   useSleepMeditations(sortBy='duration', maxDuration=30)
 * This allows sleep tab to show sorted list without client-side filtering.
 */
export function useSleepMeditations() {
  return useQuery({
    queryKey: ['sleepMeditations'],
    queryFn: getSleepMeditations,
    staleTime: 1000 * 60 * 60, // 1 hour - stable sleep meditation library
  });
}

/**
 * Fetches multi-day sleep improvement series (structured programs)
 *
 * @returns Query object with series array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for progressive sleep education programs. Sleep series are structured,
 * multi-day courses (e.g., "7-Day Sleep Reset", "Insomnia Recovery Program") with
 * daily lessons, meditations, and behavioral guidance. More structured than free-form
 * stories or meditations.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Series curriculum updates less frequently than individual content
 * - No enabled gate - free/premium series available to all user types
 * - Consider higher cacheTime (10+ min) since series are longer experiences
 *
 * CACHE STRUCTURE:
 * ['series'] - Simple key. If series have user progress, might change to:
 *   ['series', user?.uid] - to track per-user enrollment/progress
 * Current structure assumes series metadata only, not user state.
 *
 * USAGE PATTERN:
 * Consumers:
 * 1. Sleep tab - featured series carousel
 * 2. Series detail screen - shows day-by-day curriculum
 * 3. Series enrollment/tracking - records user progress (separate data model)
 *
 * DATA MODEL CONSIDERATION:
 * Series likely contains:
 * - Metadata (title, description, duration, instructor)
 * - Curriculum (list of daily lessons with content references)
 * - Not user-specific progress (tracked in separate 'seriesProgress' model)
 *
 * RELATIONSHIP TO OTHER QUERIES:
 * - Each series day references sleep meditations or bedtime stories
 * - Don't need to fetch full content for all lessons on series load
 * - Lazy-load lesson content when user clicks "Start Day 3"
 */
export function useSeries() {
  return useQuery({
    queryKey: ['series'],
    queryFn: getSeries,
    staleTime: 1000 * 60 * 60, // 1 hour - stable series curriculum
  });
}
