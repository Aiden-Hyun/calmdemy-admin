/**
 * @fileoverview Repository for sleep-specific content: bedtime stories, sleep meditations, and series.
 *
 * ARCHITECTURAL ROLE:
 * Implements Repository Pattern for sleep feature content access.
 * Handles three content types with composition support (series contain chapters).
 *
 * FIRESTORE SCHEMA:
 * - bedtime_stories: Narrative audio for sleep
 * - sleep_meditations: Guided meditations focused on sleep
 * - series: Multi-chapter bedtime stories (parent-child composition)
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore operations
 * - Normalization Helpers: Add isFree field based on product rules
 * - Composition: Series contain nested chapter arrays
 *
 * PRODUCT RULES:
 * - All sleep content is FREE (non-premium)
 * - Enables broad access to wellness tools
 *
 * CONSUMERS:
 * - Sleep feature: User finds and plays sleep content
 * - Player: Audio playback
 * - Home feature: Resolves favorites/history items to full metadata
 */

import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { BedtimeStory } from '../../../types';

/**
 * Normalizes bedtime story: adds free product flag.
 *
 * @param id - Story document ID
 * @param data - Raw story data
 * @returns Story with isFree = true
 */
function normalizeBedtimeStory(
  id: string,
  data: Record<string, unknown>
): BedtimeStory {
  return {
    id,
    ...(data as Omit<BedtimeStory, 'id'>),
    // Product rule: non-course audio content is free
    isFree: true,
  };
}

/**
 * Normalizes sleep meditation: adds free product flag.
 *
 * @param id - Meditation document ID
 * @param data - Raw meditation data
 * @returns Meditation with isFree = true
 */
function normalizeSleepMeditation(
  id: string,
  data: Record<string, unknown>
): FirestoreSleepMeditation {
  return {
    id,
    ...(data as Omit<FirestoreSleepMeditation, 'id'>),
    isFree: true,
  };
}

/**
 * Normalizes series chapter: adds free product flag.
 *
 * @param chapter - Raw chapter data
 * @returns Chapter with isFree = true
 */
function normalizeSeriesChapter(
  chapter: FirestoreSeriesChapter
): FirestoreSeriesChapter {
  return {
    ...chapter,
    isFree: true,
  };
}

/**
 * Normalizes series: denormalized series with normalized chapters.
 *
 * @param id - Series document ID
 * @param data - Raw series data
 * @returns Series with chapters normalized
 */
function normalizeSeries(
  id: string,
  data: Record<string, unknown>
): FirestoreSeries {
  const raw = {
    id,
    ...(data as Omit<FirestoreSeries, 'id'>),
  } as FirestoreSeries;

  // Normalize each nested chapter
  return {
    ...raw,
    chapters: (raw.chapters || []).map(normalizeSeriesChapter),
  };
}

// ==================== BEDTIME STORIES ====================

/**
 * Fetches all bedtime stories.
 *
 * FIRESTORE OPERATION: Full collection scan
 *
 * @returns Promise<BedtimeStory[]> - All bedtime stories; empty on error
 */
export async function getBedtimeStories(): Promise<BedtimeStory[]> {
  try {
    const snapshot = await getDocs(collection(db, 'bedtime_stories'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeBedtimeStory(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching bedtime stories:', error);
    return [];
  }
}

/**
 * Fetches a single bedtime story by ID (O(1) lookup).
 *
 * @param id - Bedtime story document ID
 * @returns Promise<BedtimeStory | null> - Story or null if not found
 */
export async function getBedtimeStoryById(
  id: string
): Promise<BedtimeStory | null> {
  try {
    const docRef = doc(db, 'bedtime_stories', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeBedtimeStory(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching bedtime story:', error);
    return null;
  }
}

// Aliases: bedtime stories are also called sleep stories
export const getSleepStories = getBedtimeStories;
export const getSleepStoryById = getBedtimeStoryById;

// ==================== SLEEP MEDITATIONS ====================

/**
 * Guided meditation focused on sleep preparation or sleep improvement.
 *
 * DIFFERENCE FROM REGULAR MEDITATIONS:
 * - Tailored for sleep (breathing patterns, duration, voice tone)
 * - Often longer (20-45 minutes)
 * - Separate collection allows sleep-specific curation
 *
 * FIELDS:
 * - instructor: Content creator name
 * - icon, color: Visual branding
 * - isFree: Always true (sleep content is free)
 */
export interface FirestoreSleepMeditation {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  instructor: string;
  icon: string;
  audioPath: string;
  thumbnailUrl?: string;
  color: string;
  isFree?: boolean;
}

/**
 * Fetches all sleep meditations.
 *
 * FIRESTORE OPERATION: Full collection scan
 *
 * @returns Promise<FirestoreSleepMeditation[]> - All sleep meditations; empty on error
 */
export async function getSleepMeditations(): Promise<FirestoreSleepMeditation[]> {
  try {
    const snapshot = await getDocs(collection(db, 'sleep_meditations'));
    return snapshot.docs.map(
      (docSnapshot) =>
        normalizeSleepMeditation(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching sleep meditations:', error);
    return [];
  }
}

/**
 * Fetches a single sleep meditation by ID (O(1) lookup).
 *
 * @param id - Sleep meditation document ID
 * @returns Promise<FirestoreSleepMeditation | null> - Meditation or null if not found
 */
export async function getSleepMeditationById(
  id: string
): Promise<FirestoreSleepMeditation | null> {
  try {
    const docRef = doc(db, 'sleep_meditations', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeSleepMeditation(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching sleep meditation:', error);
    return null;
  }
}

// ==================== SERIES ====================

/**
 * Chapter within a multi-part bedtime story series (nested denormalization).
 *
 * COMPOSITION:
 * - Chapters are nested within series documents
 * - chapterNumber enables proper sequencing
 * - Each chapter has its own audio path
 *
 * USE CASE:
 * - Multi-night bedtime stories (continue night after night)
 * - Each chapter playable independently
 */
export interface FirestoreSeriesChapter {
  id: string;
  chapterNumber: number;
  title: string;
  description: string;
  duration_minutes: number;
  audioPath: string;
  isFree?: boolean;
}

/**
 * Multi-chapter bedtime story series (e.g., "Sleepy Fairy Tales: 7 Nights").
 *
 * COMPOSITION:
 * - chapters array embedded for full data loading
 * - chapterCount and totalDuration for quick display
 *
 * DENORMALIZATION:
 * - narrator: Story narrator/voice actor
 * - color, category: Visual branding and filtering
 *
 * USE CASE:
 * - Long-form bedtime content delivered over multiple nights
 * - Encourages sustained engagement (return to series each night)
 */
export interface FirestoreSeries {
  id: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  color: string;
  narrator: string;
  chapterCount: number; // Derived from chapters.length
  totalDuration: number; // Sum of chapter durations
  category: string; // Genre or theme
  chapters: FirestoreSeriesChapter[]; // Composed child chapters
}

/**
 * Fetches all bedtime story series with nested chapters.
 *
 * FIRESTORE OPERATION: Full collection scan
 * - Loads denormalized series documents
 * - Nested chapters included in response
 *
 * @returns Promise<FirestoreSeries[]> - All series; empty on error
 */
export async function getSeries(): Promise<FirestoreSeries[]> {
  try {
    const snapshot = await getDocs(collection(db, 'series'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeSeries(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching series:', error);
    return [];
  }
}

/**
 * Fetches a single series by ID with nested chapters.
 *
 * @param id - Series document ID
 * @returns Promise<FirestoreSeries | null> - Series or null if not found
 */
export async function getSeriesById(
  id: string
): Promise<FirestoreSeries | null> {
  try {
    const docRef = doc(db, 'series', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeSeries(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching series:', error);
    return null;
  }
}
