/**
 * @fileoverview Repository for persisting and retrieving audio playback state.
 *
 * ARCHITECTURAL ROLE:
 * Implements Repository Pattern to manage playback progress tracking. When users pause
 * meditation/sleep content, the app saves their position to resume from that point later.
 * This improves UX by avoiding frustrating content re-plays.
 *
 * FIRESTORE SCHEMA:
 * - Collection: "playback_progress"
 * - Document ID: Composite key "${userId}_${contentId}" (one record per user+content)
 * - Fields: user_id, content_id, content_type, position_seconds, duration_seconds, updated_at
 *
 * PERSISTENCE LOGIC:
 * - savePlaybackProgress() filters out trivial progress (< 5 seconds)
 * - Also skips saving when very close to completion (>= 95%)
 * - Optimization: don't store progress for content user will likely finish next play
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore CRUD operations
 * - Composite Key: Ensures one progress record per user+content pair
 * - Denormalization: Stores both position and duration for client-side calculations
 *
 * CONSUMERS:
 * - Player UI: Loads progress on content open, displays resume button
 * - Analytics: Tracks average listening time before pause
 * - User data deletion: Clears progress on account deletion
 *
 * TIMESTAMP TYPE:
 * - Firestore Timestamp type for server-side timestamps
 * - Convert with timestamp.toDate() when sending to client
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/firebase";

export interface PlaybackProgress {
  user_id: string;
  content_id: string;
  content_type: string;
  position_seconds: number;
  duration_seconds: number;
  updated_at: Timestamp;
}

const playbackProgressCollection = collection(db, "playback_progress");

/**
 * Persists audio playback state for resume functionality.
 *
 * SAVE FILTERS:
 * - Skips saves if position < 5 seconds (trivial progress, don't clutter DB)
 * - Skips saves if position >= 95% of duration (content nearly complete)
 * - Both conditions prevent resume prompt for content user should restart/finish
 *
 * FIRESTORE OPERATION:
 * - Composite key: "${userId}_${contentId}" for unique record per pair
 * - setDoc() with no merge option (overwrites entire previous record)
 * - serverTimestamp() for audit trail and sorting
 *
 * IDEMPOTENCY:
 * - Calling multiple times with same position is safe (overwrites)
 * - Good for throttled progress saves during playback
 *
 * USE CASE:
 * - Called on pause event in media player
 * - Called periodically (every 30 seconds?) during playback
 * - Called on app exit to save final position
 *
 * @param userId - User identifier
 * @param contentId - Content identifier (meditation, story, etc)
 * @param contentType - Content category (for filtering in queries)
 * @param positionSeconds - Current playback position in seconds
 * @param durationSeconds - Total duration of content in seconds
 * @returns Promise<void> - Resolves when write completes; errors are logged and suppressed
 */
export async function savePlaybackProgress(
  userId: string,
  contentId: string,
  contentType: string,
  positionSeconds: number,
  durationSeconds: number
): Promise<void> {
  // FILTER 1: Don't save trivial progress (< 5 seconds into content)
  // Optimization: avoid cluttering database with users who briefly skipped content
  if (positionSeconds < 5) return;

  // FILTER 2: Don't save near-completion (>= 95% done)
  // Optimization: user will likely finish next play anyway, avoid unnecessary resume prompt
  // Skip the math if duration is 0 (unknown length)
  if (durationSeconds > 0 && positionSeconds / durationSeconds >= 0.95) return;

  try {
    // Composite key ensures one record per user+content pair
    // setDoc() without merge overwrites the entire doc (idempotent, safe for throttled saves)
    const docId = `${userId}_${contentId}`;
    await setDoc(doc(playbackProgressCollection, docId), {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      position_seconds: positionSeconds,
      duration_seconds: durationSeconds,
      updated_at: serverTimestamp(), // Server time for consistent sorting
    });
  } catch (error) {
    console.error("Error saving playback progress:", error);
    // Silently ignore errors: temporary Firestore unavailability shouldn't stop playback
    // User just won't have resume position saved; not a critical failure
  }
}

/**
 * Retrieves saved playback progress for a user+content pair (O(1) lookup).
 *
 * FIRESTORE OPERATION:
 * - Direct document access via composite key (no query needed)
 * - Much faster than querying (single document fetch vs collection scan)
 * - Returns null if no progress record exists (content never played)
 *
 * RETURN TYPE:
 * - PlaybackProgress with updated_at as Firestore Timestamp type
 * - Client must call timestamp.toDate() to convert to JavaScript Date
 *
 * USE CASE:
 * - Called when user opens a piece of content
 * - UI checks if progress exists and shows "Resume from X seconds?" prompt
 *
 * @param userId - User identifier
 * @param contentId - Content identifier
 * @returns Promise<PlaybackProgress | null> - Saved progress or null if not found
 */
export async function getPlaybackProgress(
  userId: string,
  contentId: string
): Promise<PlaybackProgress | null> {
  try {
    // Direct document lookup using composite key (fast, single doc fetch)
    // Much faster than querying: getDoc (O(1)) vs getDocs (O(n))
    const docId = `${userId}_${contentId}`;
    const docSnap = await getDoc(doc(playbackProgressCollection, docId));

    // Return null if no progress saved for this user+content pair
    if (!docSnap.exists()) return null;

    return docSnap.data() as PlaybackProgress;
  } catch (error) {
    console.error("Error getting playback progress:", error);
    // Return null on error: assume no progress saved, allow playback from start
    return null;
  }
}

/**
 * Deletes the saved playback progress for a user+content pair.
 *
 * FIRESTORE OPERATION:
 * - Direct document deletion via composite key
 * - Idempotent: deleting a non-existent document succeeds silently
 *
 * USE CASES:
 * - User marks content as complete (don't show resume prompt again)
 * - User manually clears resume/history
 * - Account deletion: clears all user progress records
 *
 * @param userId - User identifier
 * @param contentId - Content identifier
 * @returns Promise<void> - Resolves when deletion completes; errors are logged and suppressed
 */
export async function clearPlaybackProgress(
  userId: string,
  contentId: string
): Promise<void> {
  try {
    // Direct document deletion using composite key
    // Idempotent: deleting a non-existent document succeeds silently
    const docId = `${userId}_${contentId}`;
    await deleteDoc(doc(playbackProgressCollection, docId));
  } catch (error) {
    console.error("Error clearing playback progress:", error);
    // Silently ignore errors: clearing progress is best-effort
    // Worst case: user sees resume prompt even though they finished
  }
}
