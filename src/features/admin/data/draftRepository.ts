/**
 * Local draft persistence layer (AsyncStorage).
 *
 * ARCHITECTURAL ROLE:
 * Manages offline-first draft state for job creation forms.
 * Users can create/edit forms, save drafts locally, then launch jobs when ready.
 *
 * DESIGN PATTERNS:
 * - Repository pattern: Abstracts AsyncStorage behind domain-friendly functions
 * - ACID guarantees: Full drafts list is replaced atomically (no partial saves)
 * - Time-ordered: Drafts sorted by updatedAt for LRU-like UX
 *
 * KEY NOTES:
 * - No sync to Firestore; drafts are local-only working copies
 * - Draft ID generation: timestamp + random suffix prevents collisions
 * - Error handling: Returns empty array or null on read errors (graceful degradation)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ContentDraft } from '../types';

const CONTENT_FACTORY_DRAFTS_KEY = 'content_factory_drafts';

/**
 * Read all drafts from local storage, with defensive error handling.
 * Invalid/corrupt data returns empty array to avoid crashes.
 */
async function readDrafts(): Promise<ContentDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(CONTENT_FACTORY_DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContentDraft[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (error) {
    console.error('Draft read error:', error);
    return [];
  }
}

/** Atomic write of entire drafts list to local storage. */
async function writeDrafts(drafts: ContentDraft[]): Promise<void> {
  await AsyncStorage.setItem(CONTENT_FACTORY_DRAFTS_KEY, JSON.stringify(drafts));
}

/**
 * Retrieve all drafts sorted by most-recently-updated first.
 * Suitable for list views showing draft history.
 */
export async function getDrafts(): Promise<ContentDraft[]> {
  const drafts = await readDrafts();
  return drafts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Retrieve a single draft by ID, or null if not found. */
export async function getDraft(id: string): Promise<ContentDraft | null> {
  const drafts = await readDrafts();
  return drafts.find((draft) => draft.id === id) || null;
}

/**
 * Save a new draft or update an existing one.
 * Auto-generates ID and timestamps if not provided.
 * Moves updated draft to head of list.
 */
export async function saveDraft(
  draft: Omit<ContentDraft, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: number;
  }
): Promise<ContentDraft> {
  const drafts = await readDrafts();
  const now = Date.now();
  const id = draft.id || `draft_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = draft.createdAt || now;
  const next: ContentDraft = {
    ...draft,
    id,
    createdAt,
    updatedAt: now,
  };
  const filtered = drafts.filter((d) => d.id !== id);
  filtered.unshift(next);
  await writeDrafts(filtered);
  return next;
}

/** Delete a draft by ID. No-op if ID not found. */
export async function deleteDraft(id: string): Promise<void> {
  const drafts = await readDrafts();
  const filtered = drafts.filter((draft) => draft.id !== id);
  await writeDrafts(filtered);
}
