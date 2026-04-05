import {
  ContentManagerCollection,
  ContentManagerFilterState,
  ContentManagerItemSummary,
  isMissingOrWebThumbnail,
} from '../types';

/** Collections that don't have a thumbnailUrl field — exclude from thumbnail filter. */
const NO_THUMBNAIL_COLLECTIONS: Set<ContentManagerCollection> = new Set([
  'background_sounds',
  'breathing_exercises',
  'meditation_programs',
]);

function normalizeSearchValue(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function compareAlphabetically(
  left: ContentManagerItemSummary,
  right: ContentManagerItemSummary
): number {
  const leftTitle = left.title || '';
  const rightTitle = right.title || '';
  const titleCompare = leftTitle.localeCompare(rightTitle, undefined, {
    sensitivity: 'base',
  });
  if (titleCompare !== 0) return titleCompare;
  return left.id.localeCompare(right.id, undefined, {
    sensitivity: 'base',
  });
}

function getSearchRank(item: ContentManagerItemSummary, query: string): number | null {
  const normalizedTitle = normalizeSearchValue(item.title);
  const normalizedId = normalizeSearchValue(item.id);
  const normalizedCode = normalizeSearchValue(item.code);

  if (normalizedId === query || normalizedCode === query) {
    return 0;
  }

  if (normalizedTitle.startsWith(query)) {
    return 1;
  }

  if (
    normalizedTitle.includes(query) ||
    normalizedId.includes(query) ||
    normalizedCode.includes(query)
  ) {
    return 2;
  }

  return null;
}

export function filterContentManagerItems(
  items: ContentManagerItemSummary[],
  filters: ContentManagerFilterState
): ContentManagerItemSummary[] {
  const query = normalizeSearchValue(filters.query);

  const scoped = items.filter((item) => {
    if (filters.type !== 'all' && item.collection !== filters.type) {
      return false;
    }
    if (filters.access !== 'all' && item.access !== filters.access) {
      return false;
    }
    if (filters.thumbnail === 'missing_or_web') {
      if (NO_THUMBNAIL_COLLECTIONS.has(item.collection)) {
        return false;
      }
      if (!isMissingOrWebThumbnail(item.thumbnailUrl)) {
        return false;
      }
    }
    return true;
  });

  if (!query) {
    return [...scoped].sort(compareAlphabetically);
  }

  return scoped
    .map((item) => ({
      item,
      rank: getSearchRank(item, query),
    }))
    .filter((entry): entry is { item: ContentManagerItemSummary; rank: number } => {
      return entry.rank !== null;
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      return compareAlphabetically(left.item, right.item);
    })
    .map((entry) => entry.item);
}
