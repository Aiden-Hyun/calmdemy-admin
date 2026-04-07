/**
 * @fileoverview Repository for meditation content: guided meditations, breathing exercises,
 * emergency meditations, courses, and course sessions.
 *
 * ARCHITECTURAL ROLE:
 * Core data access layer for meditation feature. Implements Repository Pattern to abstract
 * Firestore operations. Handles multiple content types across 7 collections.
 *
 * FIRESTORE SCHEMA:
 * - guided_meditations: Full meditation recordings with metadata
 * - meditation_programs: Structured multi-week programs
 * - breathing_exercises: Techniques with breathing pattern templates
 * - emergency_meditations: Quick-access meditations for crisis moments
 * - courses: Premium structured learning paths (e.g., "Mindfulness 101")
 * - course_sessions: Individual lessons within courses
 * - subjects: Categories/topics for course organization
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore queries
 * - Normalization Helpers: normalizeX() functions add computed fields (isFree)
 * - Product Denormalization: isFree flag embedded based on business rules:
 *   * Non-course content is free
 *   * Courses are premium-only
 *
 * BUSINESS RULES:
 * - All basic meditation content (guided meditations, breathing exercises) is free
 * - Courses are premium-only (isFree: false)
 * - This is enforced at data load time, not query time
 *
 * COMPOSITION:
 * - Courses are composed of sessions (parent-child relationship)
 * - getCourses() fetches all courses then enriches each with child sessions
 *
 * CONSUMERS:
 * - Browse/Search: User finds meditation or course
 * - Player: Loads content for playback
 * - Profile: Shows user's course progress
 *
 * OPTIMIZATION NOTES:
 * - Course loading is N+1 prone (per-course session queries)
 * - Consider batch query or denormalization for large course catalogs
 * - Emergency meditations loaded separately (quick access emphasis)
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  GuidedMeditation,
  MeditationProgram,
  BreathingExercise,
} from '../../../types';

const meditationsCollection = collection(db, 'guided_meditations');
const programsCollection = collection(db, 'meditation_programs');
const breathingCollection = collection(db, 'breathing_exercises');

const emergencyMeditationsCollection = collection(db, 'emergency_meditations');
const coursesCollection = collection(db, 'courses');
const courseSessionsCollection = collection(db, 'course_sessions');
const subjectsCollection = collection(db, 'subjects');

/**
 * Normalizes guided meditation data from Firestore.
 * Adds computed isFree field based on product rules.
 *
 * BUSINESS RULE:
 * Non-course audio content (guided meditations) is free for all users.
 *
 * @param id - Document ID from Firestore
 * @param data - Raw document data from Firestore
 * @returns Normalized meditation with isFree = true
 */
function normalizeMeditation(
  id: string,
  data: Record<string, unknown>
): GuidedMeditation {
  return {
    id,
    ...(data as Omit<GuidedMeditation, 'id'>),
    // Product rule: non-course audio content is free
    isFree: true,
  };
}

/**
 * Normalizes emergency meditation data from Firestore.
 * Emergency meditations are always free (crisis accessibility).
 *
 * @param id - Document ID from Firestore
 * @param data - Raw document data from Firestore
 * @returns Normalized emergency meditation with isFree = true
 */
function normalizeEmergencyMeditation(
  id: string,
  data: Record<string, unknown>
): FirestoreEmergencyMeditation {
  return {
    id,
    ...(data as Omit<FirestoreEmergencyMeditation, 'id'>),
    isFree: true, // Emergency content always free for accessibility
  };
}

/**
 * Normalizes course session data from Firestore.
 * Course sessions are premium-only (requires course subscription).
 *
 * @param id - Document ID from Firestore
 * @param data - Raw document data from Firestore
 * @returns Normalized session with isFree = false
 */
function normalizeCourseSession(
  id: string,
  data: Record<string, unknown>
): FirestoreCourseSession {
  return {
    id,
    ...(data as Omit<FirestoreCourseSession, 'id'>),
    // Product rule: courses are premium-only
    isFree: false,
  };
}

// ==================== MEDITATIONS ====================

/**
 * Fetches all guided meditations from Firestore.
 *
 * FIRESTORE OPERATION: Full collection scan
 * - No filters, returns all meditations
 * - Consider pagination if collection grows very large
 *
 * @returns Promise<GuidedMeditation[]> - Array of all meditations; empty on error
 */
export async function getMeditations(): Promise<GuidedMeditation[]> {
  try {
    const snapshot = await getDocs(meditationsCollection);
    return snapshot.docs.map(
      (docSnapshot) => normalizeMeditation(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching meditations:', error);
    return [];
  }
}

/**
 * Fetches meditations filtered by theme using array-contains.
 *
 * FIRESTORE QUERY:
 * - Array-contains operator: meditations with this theme in themes[] array
 * - Requires that meditations document has themes as array field
 * - Example themes: "anxiety", "sleep", "focus", "gratitude"
 *
 * @param theme - Theme name to filter by
 * @returns Promise<GuidedMeditation[]> - Meditations matching theme; empty on error
 */
export async function getMeditationsByTheme(theme: string): Promise<GuidedMeditation[]> {
  try {
    const q = query(meditationsCollection, where('themes', 'array-contains', theme));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (docSnapshot) => normalizeMeditation(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching meditations by theme:', error);
    return [];
  }
}

/**
 * Fetches meditations filtered by technique using array-contains.
 *
 * FIRESTORE QUERY:
 * - Array-contains operator: meditations with this technique in techniques[] array
 * - Example techniques: "body scan", "visualization", "breathing", "mantra"
 *
 * @param technique - Technique name to filter by
 * @returns Promise<GuidedMeditation[]> - Meditations using technique; empty on error
 */
export async function getMeditationsByTechnique(
  technique: string
): Promise<GuidedMeditation[]> {
  try {
    const q = query(
      meditationsCollection,
      where('techniques', 'array-contains', technique)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (docSnapshot) => normalizeMeditation(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching meditations by technique:', error);
    return [];
  }
}

/**
 * Fetches a single meditation by ID (O(1) direct lookup).
 *
 * FIRESTORE OPERATION:
 * - Direct document read via ID
 * - Fastest way to fetch single meditation
 *
 * @param id - Meditation document ID
 * @returns Promise<GuidedMeditation | null> - Meditation or null if not found
 */
export async function getMeditationById(
  id: string
): Promise<GuidedMeditation | null> {
  try {
    const docRef = doc(meditationsCollection, id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeMeditation(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching meditation by id:', error);
    return null;
  }
}

// ==================== PROGRAMS ====================

/**
 * Fetches active meditation programs sorted by newest first.
 *
 * FIRESTORE QUERY:
 * - Composite filter: is_active == true
 * - OrderBy: created_at descending (newest programs first)
 * - Requires composite index: (is_active, created_at)
 *
 * FILTERING:
 * - Only returns active programs (hidden/archived are filtered out)
 * - Allows soft-delete pattern: mark as_active=false instead of deleting
 *
 * @returns Promise<MeditationProgram[]> - Active programs sorted by recency; empty on error
 */
export async function getPrograms(): Promise<MeditationProgram[]> {
  try {
    // Composite query with orderBy (requires index)
    const q = query(
      programsCollection,
      where('is_active', '==', true),
      orderBy('created_at', 'desc')
    );
    const snapshot = await getDocs(q);

    return snapshot.docs.map(
      (docSnapshot) =>
        ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        } as MeditationProgram)
    );
  } catch (error) {
    console.error('Error fetching programs:', error);
    return [];
  }
}

// ==================== BREATHING EXERCISES ====================

/**
 * Fetches all breathing exercises with computed duration.
 *
 * FIRESTORE OPERATION: Full collection scan
 *
 * COMPUTED FIELD: duration_minutes
 * - Calculated from breathing pattern and cycle count
 * - Formula: (inhale + hold + exhale + pause) * cycles / 60
 * - Allows UI to show "4-minute breathing exercise" without storing redundant field
 *
 * DENORMALIZATION:
 * - pattern is nested object with timing parameters
 * - Extracted into BreathingExercise interface for type safety
 *
 * @returns Promise<BreathingExercise[]> - Array of breathing exercises; empty on error
 */
export async function getBreathingExercises(): Promise<BreathingExercise[]> {
  try {
    const snapshot = await getDocs(breathingCollection);
    return snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data();
      // Compute duration from breathing pattern
      const cycleTime =
        data.inhale_duration +
        (data.hold_duration || 0) +
        data.exhale_duration +
        (data.pause_duration || 0);
      const totalSeconds = cycleTime * data.cycles;

      return {
        id: docSnapshot.id,
        name: data.name,
        description: data.description,
        pattern: {
          inhale_duration: data.inhale_duration,
          hold_duration: data.hold_duration,
          exhale_duration: data.exhale_duration,
          pause_duration: data.pause_duration,
          cycles: data.cycles,
        },
        // Derived field: allows UI to display duration without separate query
        duration_minutes: Math.ceil(totalSeconds / 60),
        difficulty_level: data.difficulty_level,
        benefits: data.benefits || [],
      } as BreathingExercise;
    });
  } catch (error) {
    console.error('Error fetching breathing exercises:', error);
    return [];
  }
}

// ==================== EMERGENCY MEDITATIONS ====================

/**
 * Emergency meditation content with accessibility emphasis.
 *
 * USE CASE:
 * Quick-access meditations for anxiety, panic, or crisis moments.
 * Displayed prominently on home screen for immediate access.
 *
 * FIELDS:
 * - icon, color: Visual design for quick identification
 * - isFree: Always true (crisis accessibility)
 * - audioPath: Direct path to audio file in cloud storage
 */
export interface FirestoreEmergencyMeditation {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  icon: string;
  color: string;
  audioPath: string;
  narrator?: string;
  thumbnailUrl?: string;
  isFree?: boolean;
}

/**
 * Fetches all emergency meditations for quick access feature.
 *
 * FIRESTORE OPERATION: Full collection scan
 * - Emergency meditations typically small collection (5-10 items)
 * - Full fetch acceptable; could cache aggressively
 *
 * @returns Promise<FirestoreEmergencyMeditation[]> - All emergency meditations; empty on error
 */
export async function getEmergencyMeditations(): Promise<FirestoreEmergencyMeditation[]> {
  try {
    const snapshot = await getDocs(emergencyMeditationsCollection);
    return snapshot.docs.map(
      (docSnapshot) =>
        normalizeEmergencyMeditation(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching emergency meditations:', error);
    return [];
  }
}

/**
 * Fetches a single emergency meditation by ID (O(1) lookup).
 *
 * @param id - Emergency meditation document ID
 * @returns Promise<FirestoreEmergencyMeditation | null> - Meditation or null if not found
 */
export async function getEmergencyMeditationById(
  id: string
): Promise<FirestoreEmergencyMeditation | null> {
  try {
    const docRef = doc(db, 'emergency_meditations', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeEmergencyMeditation(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching emergency meditation:', error);
    return null;
  }
}

// ==================== COURSES ====================

/**
 * Premium course session (individual lesson).
 *
 * DENORMALIZATION:
 * - courseId stored to enable lookups by parent
 * - order field enables proper sequencing in UI
 * - isFree always false (courses are premium)
 * - dayNumber optional (for sequential release patterns)
 *
 * COMPOSITION:
 * - Sessions are child documents of courses
 * - Loaded separately and combined in parent Course object
 */
export interface FirestoreCourseSession {
  id: string;
  courseId: string; // Back-reference to parent course
  code?: string; // Human-readable code (e.g., "DAY1", "WEEK2")
  dayNumber?: number; // For sequential courses (day 1-30)
  title: string;
  description: string;
  duration_minutes: number;
  audioPath: string;
  order: number; // Sequence order within course
  isFree?: boolean; // Always false for course content
}

/**
 * Premium course with composed sessions.
 *
 * COMPOSITION:
 * - sessions array loaded separately and attached
 * - sessionCount is derived from sessions.length
 *
 * PRODUCT:
 * - Structured learning paths (e.g., "30-Day Anxiety Program")
 * - Premium feature requiring subscription
 * - Ordered delivery (encourages engagement and habit building)
 */
export interface FirestoreCourse {
  id: string;
  code?: string; // Course code (e.g., "MIND101")
  title: string;
  subtitle?: string;
  description: string;
  thumbnailUrl?: string;
  color: string;
  icon?: string;
  subjectId?: string; // Reference to subject/category
  subjectLabel?: string; // Denormalized subject name
  duration_minutes?: number; // May or may not be set
  totalDuration?: number; // Total of all sessions
  difficulty?: string; // Difficulty level
  session_count?: number; // May be legacy field
  sessionCount: number; // Authoritative: length of sessions array
  instructor: string; // Content creator name
  sessions: FirestoreCourseSession[]; // Composed child sessions
}

/**
 * Internal helper: Fetches and sorts sessions for a specific course.
 *
 * FIRESTORE QUERY:
 * - Single filter: courseId == courseId
 * - Collection scan on courseId field
 *
 * SORTING:
 * - Client-side sort by order field (ascending)
 * - Ensures correct sequence in UI (day 1, 2, 3, ...)
 * - Could optimize with Firestore orderBy, but sessions are typically small
 *
 * USAGE:
 * - Called by getCourses() and getCourseById() to load course children
 * - Private function (async internal helper)
 */
async function getCourseSessionsByCourseId(
  courseId: string
): Promise<FirestoreCourseSession[]> {
  try {
    // Query all sessions for this course
    const q = query(courseSessionsCollection, where('courseId', '==', courseId));
    const snapshot = await getDocs(q);
    const sessions = snapshot.docs.map(
      (docSnapshot) => normalizeCourseSession(docSnapshot.id, docSnapshot.data())
    );
    // Sort by order field to ensure proper sequence
    return sessions.sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (error) {
    console.error('Error fetching course sessions:', error);
    return [];
  }
}

/**
 * Fetches a single course session by ID (O(1) lookup).
 *
 * @param id - Course session document ID
 * @returns Promise<FirestoreCourseSession | null> - Session or null if not found
 */
export async function getCourseSessionById(
  id: string
): Promise<FirestoreCourseSession | null> {
  try {
    const docRef = doc(courseSessionsCollection, id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeCourseSession(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching course session by id:', error);
    return null;
  }
}

/**
 * Fetches all course sessions across all courses (admin use case).
 *
 * FIRESTORE OPERATION: Full collection scan
 * - Used for admin dashboards or batch operations
 * - Typically not called for user-facing features
 *
 * SORTING:
 * - Primary: code field (alphabetical)
 * - Secondary: id (document ID) for tiebreaking
 * - Enables predictable listing in admin tools
 *
 * @returns Promise<FirestoreCourseSession[]> - All sessions sorted by code; empty on error
 */
export async function getCourseSessions(): Promise<FirestoreCourseSession[]> {
  try {
    const snapshot = await getDocs(courseSessionsCollection);
    const sessions = snapshot.docs.map(
      (docSnapshot) => normalizeCourseSession(docSnapshot.id, docSnapshot.data())
    );
    // Sort by code (e.g., "DAY1", "DAY2") then by ID for stability
    return sessions.sort((a, b) => {
      const codeCompare = String(a.code || '').localeCompare(String(b.code || ''));
      if (codeCompare !== 0) return codeCompare;
      return String(a.id).localeCompare(String(b.id));
    });
  } catch (error) {
    console.error('Error fetching course sessions:', error);
    return [];
  }
}

/**
 * Fetches all courses with their composed sessions.
 *
 * COMPOSITION PATTERN:
 * 1. Load all course documents
 * 2. For each course: load child sessions via getCourseSessionsByCourseId()
 * 3. Attach sessions array to course object
 * 4. Compute sessionCount from sessions array
 *
 * PERFORMANCE NOTE (N+1 Problem):
 * - This is an N+1 query pattern: 1 query for courses + N queries for sessions
 * - For 30 courses, this is 31 Firestore read operations
 * - Better approaches:
 *   a) Denormalize: embed session count in course document
 *   b) Use Promise.all() for parallel session queries
 *   c) Single query with collection group (if session IDs are unique globally)
 * - Current approach acceptable for moderate catalog sizes
 * - Consider caching at component level (React Context, Redux)
 *
 * @returns Promise<FirestoreCourse[]> - All courses with child sessions; empty on error
 */
export async function getCourses(): Promise<FirestoreCourse[]> {
  try {
    const snapshot = await getDocs(coursesCollection);
    const courses = snapshot.docs.map(
      (docSnapshot) =>
        ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
          sessions: [],
          sessionCount: 0,
        } as FirestoreCourse)
    );

    // Load sessions for each course (N+1 pattern)
    for (const course of courses) {
      course.sessions = await getCourseSessionsByCourseId(course.id);
      course.sessionCount = course.sessions.length;
    }

    return courses;
  } catch (error) {
    console.error('Error fetching courses:', error);
    return [];
  }
}

/**
 * Fetches a single course with its composed sessions (O(1) + O(m) where m = session count).
 *
 * COMPOSITION:
 * 1. Load course document by ID (fast)
 * 2. Load child sessions for that course
 * 3. Attach sessions array and compute sessionCount
 *
 * @param id - Course document ID
 * @returns Promise<FirestoreCourse | null> - Course with sessions or null if not found
 */
export async function getCourseById(id: string): Promise<FirestoreCourse | null> {
  try {
    const docRef = doc(coursesCollection, id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;

    const course = {
      id: docSnap.id,
      ...docSnap.data(),
      sessions: [],
      sessionCount: 0,
    } as FirestoreCourse;

    // Load child sessions and compute count
    course.sessions = await getCourseSessionsByCourseId(id);
    course.sessionCount = course.sessions.length;

    return course;
  } catch (error) {
    console.error('Error fetching course:', error);
    return null;
  }
}

// ==================== SUBJECTS ====================

/**
 * Course category/subject (e.g., "Anxiety", "Sleep", "Productivity").
 *
 * DESIGN:
 * - label: Short identifier (e.g., "anxiety")
 * - fullName: Display name (e.g., "Anxiety Management")
 * - icon, color: Visual branding for category
 *
 * RELATIONSHIP:
 * - Courses reference subject via subjectId
 * - Allows filtering/browsing courses by subject
 */
export interface Subject {
  id: string;
  label: string; // Short key
  fullName: string; // Full display name
  icon: string; // Icon name/ID
  color: string; // Color code
  description?: string; // Category description
}

/**
 * Fetches all course subjects/categories.
 *
 * FIRESTORE OPERATION: Full collection scan
 * - Subjects are typically small collection (5-15 items)
 * - Good candidate for aggressive caching
 *
 * @returns Promise<Subject[]> - All subjects; empty on error
 */
export async function getSubjects(): Promise<Subject[]> {
  try {
    const snapshot = await getDocs(subjectsCollection);
    return snapshot.docs.map(
      (docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Subject)
    );
  } catch (error) {
    console.error('Error fetching subjects:', error);
    return [];
  }
}

/**
 * Creates a new course subject/category (admin operation).
 *
 * FIRESTORE OPERATION:
 * - setDoc() with explicit ID (client-specified document ID)
 * - Allows predefined subject IDs (e.g., "anxiety", "sleep", "focus")
 * - Overwrites if subject already exists
 *
 * @param subject - Subject data with explicit ID
 * @returns Promise<string> - The subject ID
 */
export async function createSubject(subject: Omit<Subject, 'id'> & { id: string }): Promise<string> {
  const docRef = doc(subjectsCollection, subject.id);
  await setDoc(docRef, {
    label: subject.label,
    fullName: subject.fullName,
    icon: subject.icon,
    color: subject.color,
    description: subject.description || '',
  });
  return subject.id;
}

/**
 * Checks if a course code is already in use (for uniqueness validation).
 *
 * FIRESTORE QUERY:
 * - Equality filter: code == code
 * - Validates no duplicate course codes exist
 * - Called during course creation to enforce uniqueness
 *
 * @param code - Course code to check (e.g., "MIND101")
 * @returns Promise<boolean> - true if code already exists, false if available
 */
export async function checkCourseCodeExists(code: string): Promise<boolean> {
  try {
    const q = query(coursesCollection, where('code', '==', code));
    const snapshot = await getDocs(q);
    return !snapshot.empty; // true if code found, false if available
  } catch (error) {
    console.error('Error checking course code:', error);
    return false;
  }
}
