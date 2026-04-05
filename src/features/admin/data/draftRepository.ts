import AsyncStorage from '@react-native-async-storage/async-storage';
import { ContentDraft } from '../types';

const CONTENT_FACTORY_DRAFTS_KEY = 'content_factory_drafts';

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

async function writeDrafts(drafts: ContentDraft[]): Promise<void> {
  await AsyncStorage.setItem(CONTENT_FACTORY_DRAFTS_KEY, JSON.stringify(drafts));
}

export async function getDrafts(): Promise<ContentDraft[]> {
  const drafts = await readDrafts();
  return drafts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getDraft(id: string): Promise<ContentDraft | null> {
  const drafts = await readDrafts();
  return drafts.find((draft) => draft.id === id) || null;
}

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

export async function deleteDraft(id: string): Promise<void> {
  const drafts = await readDrafts();
  const filtered = drafts.filter((draft) => draft.id !== id);
  await writeDrafts(filtered);
}
