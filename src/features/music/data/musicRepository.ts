/**
 * @fileoverview Repository for audio content: albums, sleep sounds, background sounds, music, ASMR, white noise.
 *
 * ARCHITECTURAL ROLE:
 * Implements Repository Pattern for music/sound content across 6 subcategories.
 * Normalizes free vs. premium content based on product rules.
 *
 * FIRESTORE SCHEMA:
 * - albums: Collections of tracks with shared metadata
 * - sleep_sounds: Ambient audio for sleep (rain, ocean, forest, etc.)
 * - background_sounds: Ambient audio for background (coffee shop, office, etc.)
 * - music: General music content
 * - white_noise: White/pink/brown noise for focus/sleep
 * - asmr: ASMR audio for relaxation
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates Firestore queries
 * - Normalization Helpers: Add product metadata (isFree)
 * - Composition: Albums contain nested track arrays
 *
 * CONTENT TYPES:
 * - All music/sound content is FREE (non-course audio)
 * - Enables broad access to wellness tools
 * - Premium differentiation is via courses
 *
 * CONSUMERS:
 * - Music/Browse features: Find sound and music content
 * - Sleep feature: Sleep sounds specifically
 * - Home feature: Background sounds for ambiance
 * - Player: Audio playback
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../firebase';

/**
 * Normalizes album track: adds free product flag.
 *
 * @param track - Raw track from Firestore
 * @returns Track with isFree = true
 */
function normalizeAlbumTrack(track: FirestoreAlbumTrack): FirestoreAlbumTrack {
  return {
    ...track,
    // Product rule: non-course audio content is free
    isFree: true,
  };
}

/**
 * Normalizes album: denormalized album with normalized tracks.
 *
 * @param id - Album document ID
 * @param data - Raw album data from Firestore
 * @returns Album with tracks normalized
 */
function normalizeAlbum(
  id: string,
  data: Record<string, unknown>
): FirestoreAlbum {
  const raw = {
    id,
    ...(data as Omit<FirestoreAlbum, 'id'>),
  } as FirestoreAlbum;

  // Normalize each nested track
  return {
    ...raw,
    tracks: (raw.tracks || []).map(normalizeAlbumTrack),
  };
}

/**
 * Normalizes sleep sound: adds free product flag.
 *
 * @param id - Sound document ID
 * @param data - Raw sound data
 * @returns Sound with isFree = true
 */
function normalizeSleepSound(
  id: string,
  data: Record<string, unknown>
): FirestoreSleepSound {
  return {
    id,
    ...(data as Omit<FirestoreSleepSound, 'id'>),
    isFree: true, // All non-course audio is free
  };
}

/**
 * Normalizes generic music item: adds free product flag.
 *
 * @param id - Item document ID
 * @param data - Raw item data
 * @returns Item with isFree = true
 */
function normalizeMusicItem(
  id: string,
  data: Record<string, unknown>
): FirestoreMusicItem {
  return {
    id,
    ...(data as Omit<FirestoreMusicItem, 'id'>),
    isFree: true,
  };
}

// ==================== ALBUMS ====================

/**
 * Track within an album (nested denormalization).
 *
 * COMPOSITION:
 * - Tracks are nested within album documents
 * - trackNumber enables proper sequencing
 * - Each track has its own audio path for playback
 */
export interface FirestoreAlbumTrack {
  id: string;
  trackNumber: number;
  title: string;
  duration_minutes: number;
  audioPath: string;
  isFree?: boolean;
}

/**
 * Music album: collection of related tracks.
 *
 * DENORMALIZATION:
 * - Includes trackCount and totalDuration for quick display
 * - artist and category for filtering/browsing
 * - tracks array embedded for composition
 *
 * USE CASE:
 * - Music collections (e.g., "Relaxing Piano", "Jazz Standards")
 * - Each track playable independently
 */
export interface FirestoreAlbum {
  id: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  color: string;
  artist: string;
  trackCount: number; // Derived from tracks.length
  totalDuration: number; // Sum of all track durations
  category: string; // Genre/category
  tracks: FirestoreAlbumTrack[]; // Composed child tracks
}

/**
 * Fetches all music albums with nested tracks.
 *
 * FIRESTORE OPERATION: Full collection scan
 * - Loads denormalized album documents
 * - Nested tracks included in response
 *
 * @returns Promise<FirestoreAlbum[]> - All albums; empty on error
 */
export async function getAlbums(): Promise<FirestoreAlbum[]> {
  try {
    const snapshot = await getDocs(collection(db, 'albums'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeAlbum(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching albums:', error);
    return [];
  }
}

/**
 * Fetches a single album by ID with nested tracks.
 *
 * @param id - Album document ID
 * @returns Promise<FirestoreAlbum | null> - Album or null if not found
 */
export async function getAlbumById(id: string): Promise<FirestoreAlbum | null> {
  try {
    const docRef = doc(db, 'albums', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeAlbum(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching album:', error);
    return null;
  }
}

// ==================== SLEEP SOUNDS ====================

/**
 * Ambient audio for sleep (rain, ocean, white noise, etc.).
 *
 * USE CASE:
 * - Background audio to aid sleep
 * - Can be played on loop indefinitely
 * - Minimal interactive controls
 *
 * FIELDS:
 * - category: For filtering (rain, ocean, forest, etc.)
 * - icon, color: Visual branding
 * - audioPath: Direct path to audio file
 */
export interface FirestoreSleepSound {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  audioPath: string;
  color: string;
  thumbnailUrl?: string;
  isFree?: boolean;
}

/**
 * Fetches all sleep sounds.
 *
 * FIRESTORE OPERATION: Full collection scan
 *
 * @returns Promise<FirestoreSleepSound[]> - All sleep sounds; empty on error
 */
export async function getSleepSounds(): Promise<FirestoreSleepSound[]> {
  try {
    const snapshot = await getDocs(collection(db, 'sleep_sounds'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeSleepSound(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching sleep sounds:', error);
    return [];
  }
}

/**
 * Fetches sleep sounds filtered by category.
 *
 * FIRESTORE QUERY:
 * - Equality filter: category == category
 * - Special case: 'all' returns all sleep sounds (no filter)
 *
 * @param category - Category filter (e.g., 'rain', 'ocean') or 'all'
 * @returns Promise<FirestoreSleepSound[]> - Sounds matching category; empty on error
 */
export async function getSleepSoundsByCategory(
  category: string
): Promise<FirestoreSleepSound[]> {
  try {
    // Special case: 'all' returns all sounds without filtering
    if (category === 'all') return getSleepSounds();
    const q = query(collection(db, 'sleep_sounds'), where('category', '==', category));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (docSnapshot) => normalizeSleepSound(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching sleep sounds by category:', error);
    return [];
  }
}

/**
 * Fetches a single sleep sound by ID (O(1) lookup).
 *
 * @param id - Sleep sound document ID
 * @returns Promise<FirestoreSleepSound | null> - Sound or null if not found
 */
export async function getSleepSoundById(
  id: string
): Promise<FirestoreSleepSound | null> {
  try {
    const docRef = doc(db, 'sleep_sounds', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return normalizeSleepSound(docSnap.id, docSnap.data());
  } catch (error) {
    console.error('Error fetching sleep sound by id:', error);
    return null;
  }
}

// ==================== BACKGROUND SOUNDS ====================

/**
 * Ambient background sounds for focus or meditation (coffee shop, office, etc.).
 *
 * USE CASE:
 * - Background audio during work/study
 * - Loopable ambient sounds
 * - Fewer fields than sleep sounds (more utilitarian)
 */
export interface FirestoreBackgroundSound {
  id: string;
  title: string;
  icon: string;
  category: string;
  audioPath: string;
  color: string;
}

/**
 * Fetches all background sounds.
 *
 * FIRESTORE OPERATION: Full collection scan
 *
 * @returns Promise<FirestoreBackgroundSound[]> - All background sounds; empty on error
 */
export async function getBackgroundSounds(): Promise<FirestoreBackgroundSound[]> {
  try {
    const snapshot = await getDocs(collection(db, 'background_sounds'));
    return snapshot.docs.map(
      (docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as FirestoreBackgroundSound)
    );
  } catch (error) {
    console.error('Error fetching background sounds:', error);
    return [];
  }
}

/**
 * Fetches background sounds filtered by category.
 *
 * FIRESTORE QUERY:
 * - Equality filter: category == category
 *
 * @param category - Category filter (e.g., 'office', 'coffee_shop')
 * @returns Promise<FirestoreBackgroundSound[]> - Sounds matching category; empty on error
 */
export async function getBackgroundSoundsByCategory(
  category: string
): Promise<FirestoreBackgroundSound[]> {
  try {
    const q = query(collection(db, 'background_sounds'), where('category', '==', category));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as FirestoreBackgroundSound)
    );
  } catch (error) {
    console.error('Error fetching background sounds by category:', error);
    return [];
  }
}

/**
 * Fetches a single background sound by ID (O(1) lookup).
 *
 * @param id - Background sound document ID
 * @returns Promise<FirestoreBackgroundSound | null> - Sound or null if not found
 */
export async function getBackgroundSoundById(
  id: string
): Promise<FirestoreBackgroundSound | null> {
  try {
    const docRef = doc(db, 'background_sounds', id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, ...docSnap.data() } as FirestoreBackgroundSound;
  } catch (error) {
    console.error('Error fetching background sound by id:', error);
    return null;
  }
}

// ==================== WHITE NOISE / MUSIC / ASMR ====================

/**
 * Generic audio item: white noise, music, or ASMR content.
 *
 * GENERIC DESIGN:
 * - Used across three separate collections with same schema
 * - Simplifies code reuse (same normalization, same interface)
 *
 * OPTIONAL FIELDS:
 * - duration_minutes: For fixed-length tracks (optional)
 * - thumbnailUrl: For album art (optional)
 */
export interface FirestoreMusicItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  audioPath: string;
  color: string;
  duration_minutes?: number; // Fixed duration or loopable
  thumbnailUrl?: string;
  isFree?: boolean;
}

/**
 * Fetches all white noise content.
 *
 * FIRESTORE OPERATION: Full collection scan on white_noise collection
 *
 * @returns Promise<FirestoreMusicItem[]> - All white noise items; empty on error
 */
export async function getWhiteNoise(): Promise<FirestoreMusicItem[]> {
  try {
    const snapshot = await getDocs(collection(db, 'white_noise'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeMusicItem(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching white noise:', error);
    return [];
  }
}

/**
 * Fetches all music content.
 *
 * FIRESTORE OPERATION: Full collection scan on music collection
 *
 * @returns Promise<FirestoreMusicItem[]> - All music items; empty on error
 */
export async function getMusic(): Promise<FirestoreMusicItem[]> {
  try {
    const snapshot = await getDocs(collection(db, 'music'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeMusicItem(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching music:', error);
    return [];
  }
}

/**
 * Fetches all ASMR content.
 *
 * FIRESTORE OPERATION: Full collection scan on asmr collection
 *
 * @returns Promise<FirestoreMusicItem[]> - All ASMR items; empty on error
 */
export async function getAsmr(): Promise<FirestoreMusicItem[]> {
  try {
    const snapshot = await getDocs(collection(db, 'asmr'));
    return snapshot.docs.map(
      (docSnapshot) => normalizeMusicItem(docSnapshot.id, docSnapshot.data())
    );
  } catch (error) {
    console.error('Error fetching asmr:', error);
    return [];
  }
}
