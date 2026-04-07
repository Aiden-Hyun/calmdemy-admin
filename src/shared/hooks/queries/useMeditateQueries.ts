/**
 * Meditate Screen Query Hooks
 *
 * ARCHITECTURAL ROLE:
 * ViewModel layer for meditation content discovery. Provides static content lists (courses,
 * meditations, emergency sessions) that rarely change but benefit from React Query's
 * caching and synchronization. These are primarily display queries without user context.
 *
 * DESIGN PATTERNS:
 * - Static Content Caching: Uses moderate staleTime (1 hour) for content that rarely changes
 * - Cache-First with Background Refresh: Serves cached content while optionally refreshing
 * - No User Gating: Meditation content is available to anonymous users to encourage exploration
 *
 * KEY DEPENDENCIES:
 * - React Query: Manages cache, staleTime, and background refetch
 * - meditateRepository: Data access layer connecting to Firestore meditation collection
 *
 * CONSUMERS:
 * - Meditate screen (browse available meditations)
 * - Course detail screen (list meditations within course)
 * - Emergency meditation button (quick-access panic meditation)
 * - Search/filter screens (primary data source)
 */

import { useQuery } from '@tanstack/react-query';
import {
  getEmergencyMeditations,
  getCourses,
  getMeditations,
} from '@features/meditate/data/meditateRepository';

/**
 * Fetches quick-access emergency meditations for panic/anxiety relief
 *
 * @returns Query object with emergency meditation sessions, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for critical mental health content. Emergency meditations are short-form
 * (2-5 min) sessions designed for acute anxiety/panic moments. Should load very quickly
 * and be always available, including offline (caching is critical).
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour (3600000ms) - Content rarely changes; moderate cache balances
 *   freshness with performance. 1 hour chosen because meditation library updates are
 *   typically scheduled, not real-time.
 * - cacheTime: NOT SET (uses 5 min default) - Emergency content stays in memory only
 *   for 5 minutes of inactivity, preventing stale data in long app sessions.
 * - No enabled gate - runs for all users including anonymous
 *
 * CACHE INVALIDATION:
 * Invalidate when:
 * 1. Admin publishes new emergency meditation (via background sync/push notification)
 * 2. User explicitly pulls-to-refresh emergency tab
 * 3. App detected offline->online transition (network state change mutation)
 *
 * PERFORMANCE NOTE:
 * Emergency meditations are high-priority content. Consider higher cacheTime (10+ min)
 * and implement prefetch on app startup via useEffect in root provider.
 */
export function useEmergencyMeditations() {
  return useQuery({
    queryKey: ['emergencyMeditations'],
    queryFn: getEmergencyMeditations,
    staleTime: 1000 * 60 * 60, // 1 hour - infrequently-updated critical content
  });
}

/**
 * Fetches available meditation courses
 *
 * @returns Query object with courses array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for course catalog discovery. Courses are curated learning paths
 * (e.g., "7-Day Anxiety Release", "Sleep Foundation"). Primary consumer is the
 * Browse/Courses screen and course detail view.
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Course metadata (title, description, thumbnail) rarely changes
 * - Background refetch: After 1 hour stale, next query triggers refetch while serving
 *   cached data (Stale-While-Revalidate pattern)
 * - No enabled gate - available to all user types
 *
 * CACHE DEPENDENCY TREE:
 * Related queries:
 * - useGuidedMeditations() - fetches individual meditations within a course
 * - Cache should be invalidated together if course structure changes
 *
 * USAGE PATTERN:
 * Typically used at app startup to populate Browse tab. Can be preloaded before
 * user navigates to avoid loading states:
 *   useQueryClient().prefetchQuery({
 *     queryKey: ['courses'],
 *     queryFn: getCourses,
 *     staleTime: 3600000,
 *   })
 */
export function useCourses() {
  return useQuery({
    queryKey: ['courses'],
    queryFn: getCourses,
    staleTime: 1000 * 60 * 60, // 1 hour - static course catalog
  });
}

/**
 * Fetches all available guided meditation sessions
 *
 * @returns Query object with meditations array, loading state, and refetch function
 *
 * PURPOSE & MVVM ROLE:
 * ViewModel hook for meditation catalog. Returns flattened list of all guided meditation
 * sessions across all courses and categories. Used for:
 * 1. Search functionality (primary data source for filtering)
 * 2. "All Meditations" feed view
 * 3. Recommendation algorithms (data for personalization)
 *
 * REACT QUERY CONFIGURATION:
 * - staleTime: 1 hour - Meditation library content is stable (updated weekly, not real-time)
 * - Likely large dataset - consider pagination or virtual scrolling in consuming components
 * - No enabled gate - preloaded content benefits from caching even for anonymous users
 *
 * DATA SIZE CONSIDERATION:
 * This query likely returns hundreds of meditation objects. Ensure repository implements:
 * 1. Pagination to limit initial load
 * 2. Lazy loading for additional sessions
 * 3. Selection of minimal fields (id, title, duration, thumbnail) vs full details
 *
 * CACHE RELATIONSHIP:
 * - useCourses() returns course structure
 * - useGuidedMeditations() returns individual meditations
 * - Together they enable browse-by-course and browse-by-all UX patterns
 *
 * OPTIMIZATION OPPORTUNITY:
 * Consider splitting into:
 * - useFeaturedMeditations() (5-10 items, more frequent refresh)
 * - useAllMeditations(pageNumber) (paginated, infinite scroll)
 */
export function useGuidedMeditations() {
  return useQuery({
    queryKey: ['guidedMeditations'],
    queryFn: getMeditations,
    staleTime: 1000 * 60 * 60, // 1 hour - large but stable dataset
  });
}
