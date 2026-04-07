/**
 * @fileoverview Repository for managing user content completion records.
 *
 * ARCHITECTURAL ROLE:
 * This repository implements the Repository Pattern to abstract Firestore operations
 * for tracking which meditation sessions, courses, and other content a user has completed.
 * It serves as the single source of truth for completion state across the app.
 *
 * FIRESTORE SCHEMA:
 * - Collection: "completed_content"
 * - Document ID Strategy: Composite key as "userId_contentId" to ensure uniqueness
 *   and enable fast lookups without queries (O(1) reads via getDoc)
 * - Fields: user_id, content_id, content_type, completed_at (server timestamp)
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore query logic
 * - Composite Key Pattern: Denormalizes userId+contentId into doc ID for O(1) lookups
 * - Server Timestamp: Uses Firebase server time for clock-skew resilience
 *
 * CONSUMERS:
 * - Home feature: Displays completed content stats
 * - UI components: Show completion badges on content items
 * - Analytics: Tracks completion rates by content type
 *
 * ERROR HANDLING:
 * - All async functions catch and log errors, returning sensible defaults
 * - Prevents exceptions from bubbling to UI layer
 * - Allows app to remain functional even if Firestore is unavailable
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/firebase";

const completedContentCollection = collection(db, "completed_content");

/**
 * Records a user's completion of a content item (e.g., meditation session, course).
 *
 * FIRESTORE OPERATION:
 * - Collection: "completed_content"
 * - Document ID: Composite key "${userId}_${contentId}" for unique enforcement
 * - Write: setDoc() with overwrite semantics (idempotent)
 *
 * DESIGN NOTES:
 * - Uses composite key strategy to ensure only one completion record per user+content pair
 * - setDoc() without merge option overwrites entire doc, simplifying idempotency
 * - serverTimestamp() ensures clock-skew resilient timestamps for sorting/analytics
 *
 * SIDE EFFECTS:
 * - Creates or overwrites completion record in Firestore
 * - Timestamp is set server-side, not client-side
 *
 * @param userId - Unique identifier for the user (from auth)
 * @param contentId - Unique identifier for the content item (meditation/course/etc)
 * @param contentType - Content category (e.g., 'meditation', 'course_session', 'breathing_exercise')
 * @returns Promise<void> - Resolves when write completes; errors are logged and suppressed
 */
export async function markContentCompleted(
  userId: string,
  contentId: string,
  contentType: string
): Promise<void> {
  try {
    // Composite key ensures one completion per user+content pair
    const docId = `${userId}_${contentId}`;
    await setDoc(doc(completedContentCollection, docId), {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      completed_at: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error marking content as completed:", error);
  }
}

/**
 * Retrieves all completed content IDs for a user filtered by type.
 *
 * FIRESTORE QUERY:
 * - Composite filter: user_id == userId AND content_type == contentType
 * - Note: This query requires a composite index in Firestore if there are
 *   more than 1000 documents; Firestore will prompt you to create one
 *
 * RETURN TYPE:
 * - Set<string> for O(1) membership testing in UI components
 * - Preferred over array for render-time existence checks
 *
 * PERFORMANCE CONSIDERATIONS:
 * - This performs a collection scan filtered by user+type
 * - For heavy users, consider pagination or query limits
 * - Cache results at component level to avoid repeated queries
 *
 * @param userId - User identifier to filter completions
 * @param contentType - Content category filter (e.g., 'meditation', 'course_session')
 * @returns Promise<Set<string>> - Set of completed content IDs for fast membership lookup
 */
export async function getCompletedContentIds(
  userId: string,
  contentType: string
): Promise<Set<string>> {
  try {
    // Composite query: two equality filters on user_id and content_type
    // Firestore will use a composite index if collection grows beyond 1000 docs
    const q = query(
      completedContentCollection,
      where("user_id", "==", userId),
      where("content_type", "==", contentType)
    );
    const snapshot = await getDocs(q);

    // Build Set for O(1) membership lookups in UI render loops
    const completedIds = new Set<string>();
    snapshot.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      completedIds.add(data.content_id);
    });
    return completedIds;
  } catch (error) {
    console.error("Error getting completed content:", error);
    // Return empty Set rather than throwing to allow graceful degradation
    // UI will render as if no content completed, avoiding crashes
    return new Set<string>();
  }
}

/**
 * Checks if a user has completed a specific content item (O(1) lookup).
 *
 * FIRESTORE OPERATION:
 * - Direct document read via composite key (no query)
 * - getDoc() is faster than getDocs(query()) for single-item lookups
 * - Returns document metadata without fetching all fields for faster checks
 *
 * OPTIMIZATION:
 * - Uses composite key directly: much faster than query scan
 * - This is the preferred way to check individual completion status
 * - Consider client-side caching if called frequently in loops
 *
 * @param userId - User identifier
 * @param contentId - Content identifier
 * @returns Promise<boolean> - true if completion record exists, false otherwise
 */
export async function isContentCompleted(
  userId: string,
  contentId: string
): Promise<boolean> {
  try {
    // Direct document lookup using composite key: much faster than query
    // getDoc() is single-document read (O(1)), query would scan multiple docs
    const docId = `${userId}_${contentId}`;
    const docSnap = await getDoc(doc(completedContentCollection, docId));
    return docSnap.exists();
  } catch (error) {
    console.error("Error checking content completion:", error);
    // Return false on error: assume content not completed rather than crashing
    return false;
  }
}
