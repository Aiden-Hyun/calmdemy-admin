/**
 * @fileoverview Repository for user profile data: meditation sessions, user stats, and account deletion.
 *
 * ARCHITECTURAL ROLE:
 * Implements Repository Pattern for user account operations. Handles session tracking,
 * user statistics aggregation, and account lifecycle management.
 *
 * FIRESTORE SCHEMA:
 * - meditation_sessions: User's completed meditation sessions (audit log)
 * - users: User document with computed stats (total_minutes, streaks)
 * - (references other collections for data deletion)
 *
 * CORE RESPONSIBILITIES:
 * 1. Session Management: Record meditation completions
 * 2. Statistics: Compute daily/weekly/monthly/yearly trends
 * 3. Streaks: Track consecutive meditation days
 * 4. Account Deletion: GDPR compliance - delete all user data
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore operations
 * - Audit Log: meditation_sessions is append-only log of events
 * - Denormalization: users document caches computed metrics
 * - Batch Operations: deleteUserAccount coordinates multi-collection cleanup
 *
 * CONSUMERS:
 * - Profile screen: Display user stats and achievements
 * - Settings: Account deletion
 * - Analytics: User engagement trends
 *
 * PERFORMANCE NOTES:
 * - getUserStats() fetches up to 1000 sessions (may be slow for power users)
 * - Consider pagination or caching for large stat aggregations
 * - Streak calculation is O(n) on session count
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { MeditationSession } from '../../../types';

const sessionsCollection = collection(db, 'meditation_sessions');
const usersCollection = collection(db, 'users');
const favoritesCollection = collection(db, 'user_favorites');
const listeningHistoryCollection = collection(db, 'listening_history');
const playbackProgressCollection = collection(db, 'playback_progress');
const completedContentCollection = collection(db, 'completed_content');

// ==================== SESSIONS ====================

/**
 * Records a completed meditation session and updates user stats.
 *
 * SIDE EFFECTS:
 * 1. Appends new document to meditation_sessions collection
 * 2. Calls updateUserStats() to refresh user stats (total minutes, streaks)
 *
 * AUDIT TRAIL:
 * - Each session is immutable after creation
 * - serverTimestamp ensures consistent timing
 * - Enables full history reconstruction for analytics
 *
 * @param session - Session data (without ID, completed_at filled in)
 * @returns Promise<string> - Document ID of created session
 */
export async function createSession(
  session: Omit<MeditationSession, 'id' | 'completed_at'>
): Promise<string> {
  const docRef = await addDoc(sessionsCollection, {
    ...session,
    completed_at: serverTimestamp(),
  });

  // Update cached user stats (total minutes, streaks)
  await updateUserStats(session.user_id);

  return docRef.id;
}

/**
 * Retrieves user's meditation sessions sorted by most recent first.
 *
 * FIRESTORE QUERY:
 * - Composite filter: user_id == userId
 * - OrderBy: completed_at descending (most recent first)
 * - Limit: maxLimit (default 30 for pagination)
 *
 * TIMESTAMP CONVERSION:
 * - Firestore Timestamp converted to ISO string for JSON serialization
 *
 * @param userId - User identifier
 * @param maxLimit - Maximum sessions to return (for pagination)
 * @returns Promise<MeditationSession[]> - Sessions sorted by recency; empty on error
 */
export async function getUserSessions(
  userId: string,
  maxLimit = 30
): Promise<MeditationSession[]> {
  try {
    // Composite query with ordering
    const q = query(
      sessionsCollection,
      where('user_id', '==', userId),
      orderBy('completed_at', 'desc'), // Most recent first
      limit(maxLimit)
    );
    const snapshot = await getDocs(q);

    return snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data();
      return {
        id: docSnapshot.id,
        ...data,
        // Convert server timestamp to ISO string
        completed_at:
          data.completed_at instanceof Timestamp
            ? data.completed_at.toDate().toISOString()
            : new Date().toISOString(),
      } as MeditationSession;
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return [];
  }
}

// ==================== USER STATS ====================

/**
 * Updates user's cached statistics (denormalized in users document).
 *
 * DENORMALIZATION PATTERN:
 * - Computes metrics from session log and stores in users document
 * - Enables O(1) stat display without aggregating sessions each time
 * - Trade-off: slower on write, faster on read
 *
 * STATISTICS COMPUTED:
 * - total_meditation_minutes: Sum of all session durations
 * - meditation_streak: Current consecutive meditation days
 * - longest_streak: Best streak achieved (all-time personal record)
 *
 * STREAK LOGIC:
 * - Resets if user misses a day
 * - Preserved in longest_streak for motivation/achievement tracking
 * - Called after every session to keep fresh
 *
 * MERGE STRATEGY:
 * - Uses { merge: true } to preserve other user fields
 * - Allows users document to have other data (profile, preferences)
 *
 * @param userId - User identifier
 */
async function updateUserStats(userId: string) {
  try {
    // Fetch all sessions (up to 1000) to recalculate stats
    const sessions = await getUserSessions(userId, 1000);

    // Compute total meditation minutes
    const totalMinutes = sessions.reduce(
      (sum, session) => sum + session.duration_minutes,
      0
    );

    // Compute current streak
    const streak = calculateStreak(sessions);

    // Fetch existing user stats to preserve longest_streak
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    const userData = userDoc.exists() ? userDoc.data() : {};
    const currentLongest = userData.longest_streak || 0;

    // Track all-time best streak
    const newLongestStreak = Math.max(streak, currentLongest);

    // Update user document with refreshed stats
    await setDoc(
      userRef,
      {
        total_meditation_minutes: totalMinutes,
        meditation_streak: streak,
        longest_streak: newLongestStreak,
        updated_at: serverTimestamp(),
      },
      { merge: true } // Preserve other user fields
    );
  } catch (error) {
    console.error('Error updating user stats:', error);
  }
}

/**
 * Calculates current meditation streak from session history.
 *
 * STREAK LOGIC:
 * - Consecutive days with at least one meditation session
 * - Breaks if user misses a day (gap > 1 day)
 * - Resets to 0 if last session was > 1 day ago
 *
 * ALGORITHM:
 * 1. Sessions sorted by date descending (most recent first)
 * 2. Check if last session was today or yesterday
 * 3. If not, streak is broken (return 0)
 * 4. If today/yesterday, count consecutive prior days
 * 5. Stop counting when gap found
 *
 * EDGE CASES:
 * - Empty sessions: return 0
 * - Single session today: return 1
 * - Session yesterday, none today: return 1 (still active)
 * - No session in 2+ days: return 0 (broken)
 *
 * TIMEZONE NOTE:
 * - Uses local date boundaries (setHours(0,0,0,0))
 * - Consider UTC for multi-timezone users
 *
 * @param sessions - User's sessions sorted by completed_at descending
 * @returns number - Current streak (0-N)
 */
function calculateStreak(sessions: MeditationSession[]): number {
  if (sessions.length === 0) return 0;

  let streak = 1;
  // Get today's date boundary (midnight)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get last session's date boundary
  const lastSession = new Date(sessions[0].completed_at);
  lastSession.setHours(0, 0, 0, 0);

  // Check if last session was today or yesterday
  const dayDiff = Math.floor(
    (today.getTime() - lastSession.getTime()) / (1000 * 60 * 60 * 24)
  );

  // If last session > 1 day ago, streak is broken
  if (dayDiff > 1) return 0;

  // Count consecutive days backwards through session history
  for (let i = 1; i < sessions.length; i++) {
    const currentDate = new Date(sessions[i - 1].completed_at);
    const previousDate = new Date(sessions[i].completed_at);

    // Normalize to date boundaries
    currentDate.setHours(0, 0, 0, 0);
    previousDate.setHours(0, 0, 0, 0);

    // Calculate day gap
    const diff = Math.floor(
      (currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diff === 1) {
      // Consecutive day found
      streak++;
    } else if (diff > 1) {
      // Gap found - streak ends
      break;
    }
    // If diff === 0, multiple sessions same day, skip
  }

  return streak;
}

/**
 * Retrieves comprehensive user statistics for profile display.
 *
 * AGGREGATIONS COMPUTED:
 * - Time series: weekly (7), monthly (30), yearly (12) minute breakdowns
 * - Favorite time of day: when user meditates most frequently
 * - Streaks: current and all-time best from cached user document
 *
 * TIME SERIES LAYOUT:
 * - weekly_minutes: Index 0 = Monday (if current week), backwards
 * - monthly_minutes: Index 0 = 30 days ago, index 29 = today
 * - yearly_minutes: Index 0 = 12 months ago, index 11 = this month
 * - Allows line charts showing trends
 *
 * DATA SOURCES:
 * - Session list: Fetches up to 1000 sessions (may be slow)
 * - User document: Cached streak data
 * - Computation: All aggregations done client-side (not Firestore queries)
 *
 * PERFORMANCE CONSIDERATIONS:
 * - O(n) complexity on sessions count for aggregations
 * - Consider caching results for 1 hour
 * - Consider Firestore aggregation functions for future optimization
 *
 * RETURN VALUE:
 * - Returns default stats on error (zeros) rather than throwing
 * - Allows profile to display even if stat fetch fails
 *
 * @param userId - User identifier
 * @returns Promise<UserStats> - Comprehensive statistics object
 */
export async function getUserStats(userId: string) {
  try {
    // Fetch user document for cached stats
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    // Fetch session history for aggregations
    const sessions = await getUserSessions(userId, 1000);

    const userData = userDoc.exists() ? userDoc.data() : {};

    // Initialize time series arrays
    const weeklyMinutes = Array(7).fill(0); // Monday-Sunday
    const monthlyMinutes = Array(30).fill(0); // Past 30 days
    const yearlyMinutes = Array(12).fill(0); // Past 12 months

    // Current date references
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Aggregate minutes by time period
    sessions.forEach((session) => {
      const sessionDate = new Date(session.completed_at);
      const daysDiff = Math.floor(
        (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Weekly: if within last 7 days
      if (daysDiff >= 0 && daysDiff < 7) {
        const dayOfWeek = sessionDate.getDay();
        // Convert to Monday-based index (0=Monday, 6=Sunday)
        const mondayBasedIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weeklyMinutes[mondayBasedIndex] += session.duration_minutes;
      }

      // Monthly: if within last 30 days
      if (daysDiff >= 0 && daysDiff < 30) {
        // Index: 0 = 30 days ago, 29 = today
        const monthlyIndex = 29 - daysDiff;
        monthlyMinutes[monthlyIndex] += session.duration_minutes;
      }

      // Yearly: if within last 12 months
      const sessionMonth = sessionDate.getMonth();
      const sessionYear = sessionDate.getFullYear();
      const monthsDiff = (currentYear - sessionYear) * 12 + (currentMonth - sessionMonth);
      if (monthsDiff >= 0 && monthsDiff < 12) {
        // Index: 0 = 12 months ago, 11 = this month
        const yearlyIndex = 11 - monthsDiff;
        yearlyMinutes[yearlyIndex] += session.duration_minutes;
      }
    });

    // Compute favorite time of day
    const timeOfDayCounts: Record<string, number> = {
      Morning: 0, // 5am-12pm
      Afternoon: 0, // 12pm-5pm
      Evening: 0, // 5pm-9pm
      Night: 0, // 9pm-5am
    };

    sessions.forEach((session) => {
      const hour = new Date(session.completed_at).getHours();
      if (hour >= 5 && hour < 12) {
        timeOfDayCounts.Morning++;
      } else if (hour >= 12 && hour < 17) {
        timeOfDayCounts.Afternoon++;
      } else if (hour >= 17 && hour < 21) {
        timeOfDayCounts.Evening++;
      } else {
        timeOfDayCounts.Night++;
      }
    });

    // Find time period with most sessions
    let favoriteTimeOfDay: string | undefined;
    let maxCount = 0;
    for (const [time, count] of Object.entries(timeOfDayCounts)) {
      if (count > maxCount) {
        maxCount = count;
        favoriteTimeOfDay = time;
      }
    }

    // Return comprehensive stats object
    return {
      total_sessions: sessions.length,
      total_minutes: userData.total_meditation_minutes || 0,
      current_streak: userData.meditation_streak || 0,
      longest_streak:
        userData.longest_streak || userData.meditation_streak || 0,
      weekly_minutes: weeklyMinutes,
      monthly_minutes: monthlyMinutes,
      yearly_minutes: yearlyMinutes,
      favorite_time_of_day: sessions.length > 0 ? favoriteTimeOfDay : undefined,
      mood_improvement: 0, // Placeholder for future mood tracking
    };
  } catch (error) {
    console.error('Error fetching user stats:', error);
    // Return safe defaults on error
    return {
      total_sessions: 0,
      total_minutes: 0,
      current_streak: 0,
      longest_streak: 0,
      weekly_minutes: Array(7).fill(0),
      monthly_minutes: Array(30).fill(0),
      yearly_minutes: Array(12).fill(0),
      mood_improvement: 0,
    };
  }
}

// ==================== ACCOUNT DELETION ====================

/**
 * Deletes all user data across all collections (GDPR compliance).
 *
 * GDPR RIGHT TO BE FORGOTTEN:
 * - Removes all personally identifiable information
 * - Deletes user activity records (sessions, history, progress)
 * - Removes user document and associated metadata
 *
 * COLLECTIONS CLEANED:
 * 1. user_favorites: User's favorite content links
 * 2. listening_history: User's playback history
 * 3. meditation_sessions: User's session records
 * 4. playback_progress: User's resume points
 * 5. completed_content: User's completion records
 * 6. users: User document itself
 *
 * BATCH OPERATION PATTERN:
 * - Helper function deleteCollection() queries and deletes all docs with user_id
 * - Uses Promise.all() for parallel deletion
 * - Sequential collection deletion (could parallelize further)
 *
 * LIMITATIONS:
 * - Not transactional: if one collection fails, others may still delete
 * - Consider Firestore transactions for atomic deletion
 * - Does not delete from other systems (analytics, backups)
 *
 * AUDIT TRAIL:
 * - Console logging for deletion progress
 * - Useful for debugging and audit purposes
 * - Consider replacing with structured logging for production
 *
 * ERROR HANDLING:
 * - Throws error if any operation fails (caller must handle)
 * - Allows retry without duplicating deletions
 *
 * @param userId - User identifier to delete
 * @returns Promise<void> - Resolves when all data deleted
 * @throws Error if deletion fails
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  console.log(`Starting account deletion for user: ${userId}`);

  try {
    // Helper: Delete all docs in collection filtered by userId
    const deleteCollection = async (
      collectionRef: ReturnType<typeof collection>,
      fieldName: string
    ) => {
      const q = query(collectionRef, where(fieldName, '==', userId));
      const snapshot = await getDocs(q);
      // Delete all matching documents in parallel
      const deletePromises = snapshot.docs.map((docSnapshot) =>
        deleteDoc(docSnapshot.ref)
      );
      await Promise.all(deletePromises);
      console.log(`Deleted ${snapshot.docs.length} docs from ${collectionRef.path}`);
    };

    // Delete user data from all collections
    await deleteCollection(favoritesCollection, 'user_id');
    await deleteCollection(listeningHistoryCollection, 'user_id');
    await deleteCollection(sessionsCollection, 'user_id');
    await deleteCollection(playbackProgressCollection, 'user_id');
    await deleteCollection(completedContentCollection, 'user_id');

    // Delete user document itself
    const userDocRef = doc(usersCollection, userId);
    const userDoc = await getDoc(userDocRef);
    if (userDoc.exists()) {
      await deleteDoc(userDocRef);
      console.log('Deleted user document');
    }

    console.log('Account deletion complete');
  } catch (error) {
    console.error('Error deleting user account data:', error);
    throw error;
  }
}
