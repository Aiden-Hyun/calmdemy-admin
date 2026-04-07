/**
 * @fileoverview Repository for narrator metadata with in-memory caching.
 *
 * ARCHITECTURAL ROLE:
 * Implements Repository Pattern combined with Read-Through Cache strategy for narrator data.
 * Narrators are infrequently-changing content metadata (instructor names, photos), making
 * client-side memory caching appropriate for reducing Firestore reads.
 *
 * FIRESTORE SCHEMA:
 * - Collection: "narrators"
 * - Denormalized data: Each narrator has name, bio, and photoUrl
 * - Read-Only: This module only reads (no write operations)
 *
 * CACHING STRATEGY (Read-Through Cache):
 * - narratorCache: In-memory Map<lowerCaseName, FirestoreNarrator>
 * - getNarrators(): Loads all narrators, populates cache
 * - getNarratorByName(): Checks cache first, queries Firestore on miss
 * - Cache key: name.toLowerCase() for case-insensitive lookups
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Abstracts Firestore queries
 * - Read-Through Cache: Lazy-load from source on cache miss
 * - Lower-case cache keys: Handles case-insensitive narrator lookups
 *
 * PERFORMANCE NOTES:
 * - Cache is not cleared automatically (memory leak risk if narrators change frequently)
 * - Consider adding cache invalidation in app startup or periodic refresh
 * - Cache survives across app reloads (only in-memory within a session)
 *
 * CONSUMERS:
 * - Content cards: Display narrator name and profile photo
 * - Content filters: Search/filter by narrator name
 * - Statistics: Aggregate stats by narrator
 */

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";

export interface FirestoreNarrator {
  id: string;
  name: string;
  bio?: string;
  photoUrl: string;
}

// In-memory cache: name.toLowerCase() -> narrator object
// Populated by getNarrators() or getNarratorByName() cache hit
const narratorCache: Map<string, FirestoreNarrator> = new Map();

/**
 * Fetches all narrators from Firestore and populates in-memory cache.
 *
 * FIRESTORE OPERATION:
 * - Full collection scan: getDocs(collection) with no filters
 * - Efficient for small collections (narrators are typically 5-20 documents)
 * - Called once on app startup or when narrator list needs refresh
 *
 * CACHING SIDE EFFECT:
 * - Populates narratorCache with all narrators indexed by lowercase name
 * - Enables fast lookups in getNarratorByName() after this call
 *
 * RETURN TYPE:
 * - Ordered by Firestore document order (not guaranteed, but stable within session)
 * - Consider sorting if UI requires specific order
 *
 * @returns Promise<FirestoreNarrator[]> - Array of all narrators; empty array on error
 */
export async function getNarrators(): Promise<FirestoreNarrator[]> {
  try {
    // Fetch all narrator documents (no filter needed - small collection)
    const snapshot = await getDocs(collection(db, "narrators"));
    const narrators = snapshot.docs.map(
      (docSnapshot) =>
        ({ id: docSnapshot.id, ...docSnapshot.data() } as FirestoreNarrator)
    );
    // Populate read-through cache with all narrators for fast lookups
    narrators.forEach((n) => narratorCache.set(n.name.toLowerCase(), n));
    return narrators;
  } catch (error) {
    console.error("Error fetching narrators:", error);
    return [];
  }
}

/**
 * Retrieves a single narrator by name (case-insensitive) with cache fallback.
 *
 * LOOKUP STRATEGY (Read-Through Cache):
 * 1. Check in-memory cache first (O(1) map lookup)
 * 2. If miss, query Firestore (O(n) collection scan)
 * 3. Cache the result for future calls
 *
 * CACHE KEY:
 * - Uses name.toLowerCase() for case-insensitive matching
 * - Allows "Morgan Freeman" and "morgan freeman" to hit same cache entry
 *
 * FIRESTORE QUERY:
 * - Equality filter on "name" field (expects exact match in Firestore)
 * - Note: Query is case-sensitive on Firestore side, but cached results are not
 *
 * RETURN VALUE:
 * - null if narrator not found in cache or Firestore
 * - FirestoreNarrator object with id, name, bio, photoUrl
 *
 * @param name - Narrator name (case-insensitive due to caching)
 * @returns Promise<FirestoreNarrator | null> - Narrator object or null
 */
export async function getNarratorByName(
  name: string
): Promise<FirestoreNarrator | null> {
  // Cache hit: return immediately without Firestore query
  const cached = narratorCache.get(name.toLowerCase());
  if (cached) return cached;

  try {
    // Cache miss: query Firestore
    const q = query(collection(db, "narrators"), where("name", "==", name));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const narrator = {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data(),
    } as FirestoreNarrator;

    // Store in cache for next lookup
    narratorCache.set(name.toLowerCase(), narrator);
    return narrator;
  } catch (error) {
    console.error("Error fetching narrator by name:", error);
    return null;
  }
}

/**
 * Synchronous cache lookup for narrator profile photo URL.
 *
 * SYNCHRONOUS NOTE:
 * - This is a synchronous function (no async/await) - pure cache lookup
 * - Assumes cache was already populated by getNarrators() or getNarratorByName()
 * - Returns null if narrator not in cache (call getNarratorByName first to populate)
 *
 * USE CASE:
 * - Quick access to photo URLs in render loops
 * - Avoids async/await overhead for simple lookups
 * - Fails gracefully with null if data not cached
 *
 * @param name - Narrator name (case-insensitive)
 * @returns string | null - Photo URL or null if not cached
 */
export function getNarratorProfileUrl(name: string): string | null {
  // Direct cache lookup without async overhead
  const cached = narratorCache.get(name.toLowerCase());
  return cached?.photoUrl || null;
}
