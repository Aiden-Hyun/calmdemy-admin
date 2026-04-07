/**
 * @fileoverview Repository for home screen feature data: daily quotes, favorites, and listening history.
 *
 * ARCHITECTURAL ROLE:
 * Implements Repository Pattern for home screen content. Coordinates multiple sub-repositories
 * to provide aggregated data (favorites with metadata, listening history, daily quotes).
 * Acts as a facade that simplifies complex cross-feature data fetching.
 *
 * FIRESTORE SCHEMA:
 * - Collections:
 *   - daily_quotes: Inspirational quotes keyed by date (or random fallback)
 *   - user_favorites: Links between users and favorited content (denormalized type)
 *   - listening_history: Audit log of played content with timestamps
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore operations for home screen
 * - Facade Pattern: Simplifies complex cross-repository calls (getFavoritesWithDetails)
 * - Composition: Imports other repositories to enrich favorite/history items with metadata
 * - Denormalization: Stores content_type in favorites/history for easy filtering without joins
 *
 * CROSS-REPOSITORY DEPENDENCIES:
 * - Imports from meditateRepository: getEmergencyMeditationById, getCourses
 * - Imports from sleepRepository: getSeries, getSleepMeditationById
 * - Imports from musicRepository: getAlbums
 * - These enable content resolver to look up full details from favorites/history
 *
 * CONSUMERS:
 * - Home screen: Displays daily quote, favorites, listening history
 * - Search/Browse: Uses listening history for recent content
 * - Content cards: Links to favorite status via toggleFavorite
 *
 * NOTE:
 * - Some Firestore operations require composite indexes (see inline comments)
 * - Timestamp handling: Converts Firestore Timestamp to ISO string for client
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  DailyQuote,
  ListeningHistoryItem,
  UserFavorite,
} from '../../../types';
import { getEmergencyMeditationById, getCourses } from '../../meditate/data/meditateRepository';
import { getSeries, getSleepMeditationById } from '../../sleep/data/sleepRepository';
import { getAlbums } from '../../music/data/musicRepository';

const quotesCollection = collection(db, 'daily_quotes');
const favoritesCollection = collection(db, 'user_favorites');
const listeningHistoryCollection = collection(db, 'listening_history');

// ==================== DAILY QUOTES ====================

/**
 * Retrieves today's inspirational quote with fallback to random quote.
 *
 * FIRESTORE QUERY:
 * - First attempt: Query quotes by today's date (YYYY-MM-DD format)
 * - Fallback: If no quote for today, fetch all quotes and select random one
 * - This pattern allows scheduling quotes while providing graceful degradation
 *
 * FALLBACK STRATEGY:
 * - Enables "quote of the day" feature even if admin hasn't populated today's quote
 * - Random selection happens client-side (simple, no extra query)
 * - All quotes collection is fetched for fallback (acceptable for small collections)
 *
 * TIMESTAMP FORMAT:
 * - Uses ISO date format (YYYY-MM-DD) for easy comparison
 * - Stores in Firestore as string field 'date'
 *
 * @returns Promise<DailyQuote | null> - Today's quote or random quote, null if no quotes exist
 */
export async function getTodayQuote(): Promise<DailyQuote | null> {
  try {
    // Extract today's date in YYYY-MM-DD format for Firestore query
    const today = new Date().toISOString().split('T')[0];

    // Try to find quote scheduled for today
    const q = query(quotesCollection, where('date', '==', today), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      // No scheduled quote for today - fetch all and select random
      const allQuotesSnapshot = await getDocs(quotesCollection);
      if (allQuotesSnapshot.empty) return null;

      const randomIndex = Math.floor(
        Math.random() * allQuotesSnapshot.docs.length
      );
      const docSnapshot = allQuotesSnapshot.docs[randomIndex];
      return { id: docSnapshot.id, ...docSnapshot.data() } as DailyQuote;
    }

    // Return scheduled quote for today
    const docSnapshot = snapshot.docs[0];
    return { id: docSnapshot.id, ...docSnapshot.data() } as DailyQuote;
  } catch (error) {
    console.error('Error fetching daily quote:', error);
    return null;
  }
}

// ==================== FAVORITES ====================

/**
 * Retrieves all favorited content for a user, sorted by most recent.
 *
 * FIRESTORE QUERY:
 * - Single equality filter: user_id == userId
 * - Collection scan on user_id field (requires Firestore index if large collection)
 *
 * SORTING:
 * - Client-side sort by favorited_at descending (most recent first)
 * - Could be optimized with Firestore orderBy, but collection is typically small
 *
 * TIMESTAMP CONVERSION:
 * - favorited_at comes from Firestore as Timestamp type
 * - Converts to ISO string for JSON serialization and client usage
 * - Fallback to current time if missing (edge case)
 *
 * RETURN TYPE:
 * - Array of UserFavorite objects with denormalized content_type
 * - Use getContentById() separately to fetch full content metadata
 *
 * @param userId - User identifier
 * @returns Promise<UserFavorite[]> - Array of favorites sorted by recency; empty on error
 */
export async function getUserFavorites(userId: string): Promise<UserFavorite[]> {
  try {
    // Query all favorites for this user
    const q = query(favoritesCollection, where('user_id', '==', userId));
    const snapshot = await getDocs(q);

    const items = snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data();
      return {
        id: docSnapshot.id,
        ...data,
        // Convert Firestore Timestamp to ISO string for client
        favorited_at:
          data.favorited_at instanceof Timestamp
            ? data.favorited_at.toDate().toISOString()
            : new Date().toISOString(),
      } as UserFavorite;
    });

    // Sort by most recent favorite first
    return items.sort(
      (a, b) =>
        new Date(b.favorited_at).getTime() -
        new Date(a.favorited_at).getTime()
    );
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return [];
  }
}

/**
 * Adds or removes a piece of content from user's favorites (toggle semantics).
 *
 * BEHAVIOR:
 * - If not favorited: creates new favorite record -> returns true
 * - If already favorited: deletes all matching favorite records -> returns false
 *
 * FIRESTORE OPERATIONS:
 * - Query: Composite filter on user_id and content_id
 * - Delete: May match multiple docs (edge case), deletes all
 * - Create: addDoc() generates new document ID
 *
 * EDGE CASE:
 * - Multiple favorite records for same user+content should not occur
 * - Code defensively deletes all matches with Promise.all
 *
 * RETURN VALUE SEMANTICS:
 * - Returns boolean matching new favorited state
 * - true = now favorited, false = now unfavorited
 * - Allows UI to update button state without re-querying
 *
 * ATOMIC SEMANTICS:
 * - Not fully atomic: query + delete + create is not transactional
 * - In practice, safe because parallel requests unlikely
 * - Consider using Firestore transaction for higher guarantees
 *
 * @param userId - User identifier
 * @param contentId - Content identifier
 * @param contentType - Content category
 * @returns Promise<boolean> - true if now favorited, false if unfavorited
 */
export async function toggleFavorite(
  userId: string,
  contentId: string,
  contentType:
    | 'meditation'
    | 'nature_sound'
    | 'bedtime_story'
    | 'breathing_exercise'
    | 'series_chapter'
    | 'album_track'
    | 'emergency'
    | 'course_session'
    | 'sleep_meditation'
): Promise<boolean> {
  try {
    // Check if user has already favorited this content
    const q = query(
      favoritesCollection,
      where('user_id', '==', userId),
      where('content_id', '==', contentId)
    );
    const existing = await getDocs(q);

    if (!existing.empty) {
      // Content is already favorited - remove all matching records (defensive)
      const deletePromises = existing.docs.map((docSnapshot) =>
        deleteDoc(docSnapshot.ref)
      );
      await Promise.all(deletePromises);
      return false; // Now unfavorited
    }

    // Content not yet favorited - add to favorites
    await addDoc(favoritesCollection, {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      favorited_at: serverTimestamp(),
    });
    return true; // Now favorited
  } catch (error) {
    console.error('Error toggling favorite:', error);
    return false;
  }
}

/**
 * Checks if user has favorited a specific piece of content.
 *
 * FIRESTORE QUERY:
 * - Composite filter: user_id and content_id
 * - Expected to return 0 or 1 document
 * - Simply checks if any record exists
 *
 * PERFORMANCE NOTE:
 * - Queries favorite collection (might be large)
 * - Alternative: Could use composite key strategy for O(1) lookup
 *   (would require refactoring favorite storage)
 * - Current implementation acceptable for UI "favorite button" state checks
 *
 * CACHING OPPORTUNITY:
 * - This is called frequently in render loops
 * - Consider client-side caching or including in getUserFavorites() result
 *
 * @param userId - User identifier
 * @param contentId - Content identifier
 * @returns Promise<boolean> - true if favorited, false otherwise
 */
export async function isFavorite(
  userId: string,
  contentId: string
): Promise<boolean> {
  try {
    // Check if favorite record exists for user+content
    const q = query(
      favoritesCollection,
      where('user_id', '==', userId),
      where('content_id', '==', contentId)
    );
    const snapshot = await getDocs(q);

    return !snapshot.empty;
  } catch (error) {
    console.error('Error checking favorite:', error);
    return false;
  }
}

// ==================== CONTENT RESOLVER ====================

/**
 * Resolved content with full metadata (denormalized for display).
 *
 * This interface represents content that has been "resolved" from favorites or history
 * - fetching full details from the appropriate content repository.
 *
 * DESIGN PATTERN:
 * - API Consistency: Provides uniform interface regardless of content type
 * - Denormalization: Embeds course_code and session_code for easy access
 * - Extensibility: Can add more fields as needed
 */
export interface ResolvedContent {
  id: string;
  title: string;
  thumbnail_url?: string;
  duration_minutes: number;
  content_type:
    | 'meditation'
    | 'nature_sound'
    | 'bedtime_story'
    | 'breathing_exercise'
    | 'series_chapter'
    | 'album_track'
    | 'emergency'
    | 'course_session'
    | 'sleep_meditation';
  course_code?: string;
  session_code?: string;
}

/**
 * Resolves a content item by ID and type, fetching full metadata.
 *
 * ARCHITECTURAL PATTERN: Content Resolver / Facade
 * This function acts as a dispatcher that handles all 9 content types,
 * routing to the appropriate repository or Firestore collection.
 *
 * CONTENT TYPE ROUTING:
 * - emergency: Calls getEmergencyMeditationById(meditateRepository)
 * - series_chapter: Loads all series, searches nested chapters (nested denormalization)
 * - album_track: Loads all albums, searches nested tracks
 * - course_session: Loads all courses, searches nested sessions
 * - sleep_meditation: Calls getSleepMeditationById(sleepRepository)
 * - Others (meditation, bedtime_story, breathing_exercise, nature_sound): Direct Firestore lookup
 *
 * PERFORMANCE CONSIDERATIONS:
 * - Nested types (series_chapter, album_track, course_session) fetch entire parent collections
 * - Better: Could denormalize to separate chapter/track/session collections with parent IDs
 * - Current approach acceptable for moderate collection sizes
 * - Consider caching all series/albums/courses in Redux or React Context
 *
 * TITLE DENORMALIZATION:
 * - For nested types: Creates composite title "${parentTitle}: ${itemTitle}"
 * - Improves UX by showing full context (e.g., "Sleep Series: Chapter 3")
 *
 * FIELD MAPPING:
 * - Handles field naming variations: title vs name, thumbnail_url vs thumbnailUrl
 * - Graceful defaults: title = "Untitled", duration = 0 if missing
 *
 * @param contentId - Content identifier
 * @param contentType - Content category (determines lookup strategy)
 * @returns Promise<ResolvedContent | null> - Full metadata or null if not found
 */
export async function getContentById(
  contentId: string,
  contentType:
    | 'meditation'
    | 'nature_sound'
    | 'bedtime_story'
    | 'breathing_exercise'
    | 'series_chapter'
    | 'album_track'
    | 'emergency'
    | 'course_session'
    | 'sleep_meditation'
): Promise<ResolvedContent | null> {
  try {
    // EMERGENCY MEDITATIONS - Special collection with unique metadata
    if (contentType === 'emergency') {
      const emergency = await getEmergencyMeditationById(contentId);
      if (emergency) {
        return {
          id: contentId,
          title: emergency.title,
          thumbnail_url: emergency.thumbnailUrl,
          duration_minutes: emergency.duration_minutes,
          content_type: contentType,
        };
      }
      return null;
    }

    // SERIES CHAPTERS - Nested within series documents, requires parent lookup
    if (contentType === 'series_chapter') {
      const allSeries = await getSeries();
      for (const series of allSeries) {
        const chapter = series.chapters?.find((c) => c.id === contentId);
        if (chapter) {
          // Composite title shows context: "Sleep Series: Chapter 3"
          return {
            id: contentId,
            title: `${series.title}: ${chapter.title}`,
            thumbnail_url: series.thumbnailUrl,
            duration_minutes: chapter.duration_minutes,
            content_type: contentType,
          };
        }
      }
      return null;
    }

    // ALBUM TRACKS - Nested within album documents
    if (contentType === 'album_track') {
      const allAlbums = await getAlbums();
      for (const album of allAlbums) {
        const track = album.tracks?.find((t) => t.id === contentId);
        if (track) {
          return {
            id: contentId,
            title: `${album.title}: ${track.title}`,
            thumbnail_url: album.thumbnailUrl,
            duration_minutes: track.duration_minutes,
            content_type: contentType,
          };
        }
      }
      return null;
    }

    // COURSE SESSIONS - Nested within course documents, includes course metadata
    if (contentType === 'course_session') {
      const allCourses = await getCourses();
      for (const course of allCourses) {
        const session = course.sessions?.find((s) => s.id === contentId);
        if (session) {
          return {
            id: contentId,
            title: session.title,
            thumbnail_url: course.thumbnailUrl,
            duration_minutes: session.duration_minutes,
            content_type: contentType,
            course_code: course.code,
            session_code: session.code,
          };
        }
      }
      return null;
    }

    // SLEEP MEDITATIONS - Direct lookup from sleep repository
    if (contentType === 'sleep_meditation') {
      const meditation = await getSleepMeditationById(contentId);
      if (meditation) {
        return {
          id: contentId,
          title: meditation.title,
          thumbnail_url: meditation.thumbnailUrl,
          duration_minutes: meditation.duration_minutes,
          content_type: contentType,
        };
      }
      return null;
    }

    // STANDARD TYPES - Direct Firestore document lookup
    let collectionName: string;
    switch (contentType) {
      case 'meditation':
        collectionName = 'guided_meditations';
        break;
      case 'bedtime_story':
        collectionName = 'bedtime_stories';
        break;
      case 'breathing_exercise':
        collectionName = 'breathing_exercises';
        break;
      case 'nature_sound':
        collectionName = 'sleep_sounds';
        break;
      default:
        return null;
    }

    // Direct document lookup (not a query - fastest)
    const docRef = doc(db, collectionName, contentId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return null;

    const data = docSnap.data();
    return {
      id: docSnap.id,
      title: data.title || data.name || 'Untitled', // Flexible field names
      thumbnail_url: data.thumbnail_url || data.thumbnailUrl,
      duration_minutes: data.duration_minutes || 0,
      content_type: contentType,
    };
  } catch (error) {
    console.error('Error fetching content by id:', error);
    return null;
  }
}

/**
 * Retrieves user's favorites with full content metadata (Facade pattern).
 *
 * FACADE PATTERN:
 * Simplifies complex cross-repository operation:
 * 1. Get user's favorite references (lightweight)
 * 2. Resolve each to full content metadata
 * Hides complexity from UI components
 *
 * PERFORMANCE NOTE:
 * - Sequential resolution: O(n) async calls for n favorites
 * - Better: Use Promise.all() for parallel resolution
 * - Consider caching content at component level
 * - Pagination: Fetch 10 favorites at a time for large lists
 *
 * FILTERING:
 * - Excludes favorites whose content was deleted (getContentById returns null)
 * - Gracefully handles stale favorite references
 *
 * @param userId - User identifier
 * @returns Promise<ResolvedContent[]> - Array of favorites with full details; empty on error
 */
export async function getFavoritesWithDetails(
  userId: string
): Promise<ResolvedContent[]> {
  try {
    // Step 1: Fetch user's favorite references
    const favorites = await getUserFavorites(userId);
    const resolvedContent: ResolvedContent[] = [];

    // Step 2: Resolve each favorite to full content metadata
    for (const fav of favorites) {
      const content = await getContentById(fav.content_id, fav.content_type);
      if (content) {
        resolvedContent.push(content);
      }
    }

    return resolvedContent;
  } catch (error) {
    console.error('Error fetching favorites with details:', error);
    return [];
  }
}

// ==================== LISTENING HISTORY ====================

/**
 * Records that a user played a piece of content.
 *
 * FIRESTORE OPERATION:
 * - Append-only log: Each play creates new document (allows multiple plays of same content)
 * - Auto-generated document ID for event log semantics
 *
 * DENORMALIZED FIELDS:
 * - Stores title, thumbnail at play time to preserve historical state
 * - If content metadata changes later, history shows original state
 * - Reduces need for joins when displaying "recently played"
 *
 * OPTIONAL FIELDS:
 * - courseCode and sessionCode only added for course content
 * - Keeps documents lean for non-course content
 *
 * USE CASE:
 * - Called when user hits play on content (not every second of playback)
 * - Enables "Recently Played" section on home screen
 * - Tracks which content is popular across user base
 *
 * @param userId - User identifier
 * @param contentId - Content identifier
 * @param contentType - Content category
 * @param contentTitle - Title at time of play (for history display)
 * @param durationMinutes - Duration in minutes (for analytics)
 * @param contentThumbnail - Thumbnail URL (optional)
 * @param courseCode - Course code if applicable
 * @param sessionCode - Session code if applicable
 * @returns Promise<string> - Document ID of created history record
 */
export async function addToListeningHistory(
  userId: string,
  contentId: string,
  contentType:
    | 'meditation'
    | 'nature_sound'
    | 'bedtime_story'
    | 'breathing_exercise'
    | 'series_chapter'
    | 'album_track'
    | 'emergency'
    | 'course_session'
    | 'sleep_meditation',
  contentTitle: string,
  durationMinutes: number,
  contentThumbnail?: string,
  courseCode?: string,
  sessionCode?: string
): Promise<string> {
  try {
    // Build document with denormalized content data
    const docData: Record<string, any> = {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      content_title: contentTitle, // Snapshot of title at play time
      content_thumbnail: contentThumbnail || null,
      duration_minutes: durationMinutes,
      played_at: serverTimestamp(),
    };

    // Add course-specific codes if applicable
    if (courseCode) {
      docData.course_code = courseCode;
    }
    if (sessionCode) {
      docData.session_code = sessionCode;
    }

    // Append new history entry to collection
    const docRef = await addDoc(listeningHistoryCollection, docData);
    return docRef.id;
  } catch (error) {
    console.error('Error adding to listening history:', error);
    return '';
  }
}

/**
 * Retrieves user's listening history with deduplication.
 *
 * FIRESTORE QUERY:
 * - Single filter: user_id == userId
 * - Collection scan (may be large - consider pagination)
 *
 * PROCESSING PIPELINE:
 * 1. Convert Timestamp objects to ISO strings
 * 2. Sort by played_at descending (most recent first)
 * 3. Deduplicate: Keep only first (most recent) play of each content
 * 4. Limit to maxLimit items
 *
 * DEDUPLICATION LOGIC:
 * - Problem: User may have played same content multiple times
 * - Solution: Keep only most recent play per content ID
 * - Implementation: Set-based deduplication after sorting
 *
 * RETURN TYPE:
 * - Recent content, each appearing once, sorted by recency
 * - Used for "Recently Played" carousel
 *
 * PERFORMANCE CONSIDERATIONS:
 * - Client-side deduplication: O(n) operation
 * - Alternative: Could handle in Firestore with complex query
 * - Current approach acceptable for typical history sizes
 * - Consider pagination for users with extensive play history
 *
 * @param userId - User identifier
 * @param maxLimit - Maximum items to return (default 10)
 * @returns Promise<ListeningHistoryItem[]> - Recent unique content, sorted by date; empty on error
 */
export async function getListeningHistory(
  userId: string,
  maxLimit = 10
): Promise<ListeningHistoryItem[]> {
  try {
    // Query all history entries for user
    const q = query(listeningHistoryCollection, where('user_id', '==', userId));
    const snapshot = await getDocs(q);

    // Convert Firestore Timestamp to ISO strings
    const items = snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data();
      return {
        id: docSnapshot.id,
        ...data,
        played_at:
          data.played_at instanceof Timestamp
            ? data.played_at.toDate().toISOString()
            : new Date().toISOString(),
      } as ListeningHistoryItem;
    });

    // Sort by most recent play first
    const sorted = items.sort(
      (a, b) =>
        new Date(b.played_at).getTime() -
        new Date(a.played_at).getTime()
    );

    // Deduplicate: keep only most recent play of each content
    const seen = new Set<string>();
    const deduplicated = sorted.filter((item) => {
      if (seen.has(item.content_id)) return false; // Skip duplicate
      seen.add(item.content_id);
      return true;
    });

    // Limit to maxLimit unique items
    return deduplicated.slice(0, maxLimit);
  } catch (error) {
    console.error('Error fetching listening history:', error);
    return [];
  }
}
