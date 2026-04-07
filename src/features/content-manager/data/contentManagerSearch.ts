/**
 * ARCHITECTURAL ROLE:
 * Client-side search and filter implementation. Implements the Strategy pattern with composable
 * filters (type, access, thumbnail, search). Uses an in-memory ranking algorithm for full-text search
 * that prioritizes exact ID/code matches over substring matches.
 *
 * DESIGN PATTERNS:
 * - **Filter Strategy Pattern**: Each filter dimension (type, access, thumbnail, query) is applied
 *   independently via a chain of filter predicates. Easy to add new dimensions without modifying existing logic.
 * - **Ranking Algorithm**: Multi-tier search ranking (Okapi BM25-lite):
 *   - Tier 0: Exact match on ID or code (highest priority)
 *   - Tier 1: Title starts with query
 *   - Tier 2: Substring in title, ID, or code
 *   - No match: filtered out
 * - **Composition**: filterContentManagerItems() applies all filters in one pass, sorting by rank.
 * - **No Pagination**: All items kept in memory; search/filter is instant but doesn't scale beyond ~10k items.
 *   For larger datasets, move filtering to backend (Firestore query or Algolia).
 *
 * PERFORMANCE:
 * - O(n*m) where n = items, m = avg field length (for string comparisons)
 * - Acceptable for content catalogs with <10k items
 * - Runs on every filter change (debouncing in hook layer, not here)
 *
 * CONSUMERS:
 * - useContentManagerCatalog hook: calls filterContentManagerItems() with current filters
 * - ContentManagerScreen: renders filtered items in FlatList
 */

import {
  ContentManagerCollection,
  ContentManagerFilterState,
  ContentManagerItemSummary,
  isMissingOrWebThumbnail,
} from '../types';

/**
 * Collections without thumbnailUrl field. Used to skip thumbnail filtering for these types
 * since they don't support images (e.g., breathing exercises don't have visual UI).
 */
const NO_THUMBNAIL_COLLECTIONS: Set<ContentManagerCollection> = new Set([
  'background_sounds',
  'breathing_exercises',
  'meditation_programs',
]);

/**
 * Normalizes search query: trim, lowercase, for case-insensitive matching.
 * Empty query (after trim) returns empty string; treated as "no search" by caller.
 *
 * @param value - Raw search input from text field
 * @returns Normalized query string (empty if falsy input)
 */
function normalizeSearchValue(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Secondary sort comparator for search results.
 * When two results have the same rank, sort A-Z by title, then by ID.
 * Provides stable, predictable ordering within rank tiers.
 */
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

/**
 * Ranks search result relevance. Returns a tier number (0 = best, 1 = good, 2 = okay) or null (no match).
 * Used to sort search results: exact ID matches appear first, then title starts-with, then substring matches.
 *
 * RANKING TIERS (ascending = better relevance):
 * - 0: Exact match on ID or code (admin probably knows the ID they're looking for)
 * - 1: Title starts with query (common prefix search, good UX)
 * - 2: Substring in any field (relaxed match, may have false positives)
 * - null: No match (filtered out)
 *
 * SECONDARY SORT:
 * - Within same rank tier, sort alphabetically by title (stable, predictable)
 *
 * @param item - Item to rank
 * @param query - Normalized search query (lowercase, trimmed)
 * @returns Rank number (lower = better) or null if no match
 */
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

/**
 * Applies all filters (type, access, thumbnail, search query) to a list of items.
 *
 * FILTER ORDER:
 * 1. Type filter (collection scope): 'all' or specific collection
 * 2. Access filter (free/premium): 'all' or specific tier
 * 3. Thumbnail filter (quality check): 'all' or 'missing_or_web' (find items needing images)
 * 4. Search query: null query skips search; non-empty query ranks and sorts results
 *
 * NO THUMBNAIL EXCLUSION:
 * - Some collections (breathing_exercises) don't have thumbnailUrl field at all
 * - Thumbnail filter skips these collections entirely (can't have missing URL if field doesn't exist)
 *
 * ALPHABETICAL FALLBACK:
 * - When no search query, results sorted A-Z by title (stable, familiar to admin)
 * - When search query present, results ranked by relevance, then A-Z within rank tier
 *
 * @param items - All content items (from repository)
 * @param filters - Current filter state from UI
 * @returns Filtered and sorted subset of items
 */
export function filterContentManagerItems(
  items: ContentManagerItemSummary[],
  filters: ContentManagerFilterState
): ContentManagerItemSummary[] {
  const query = normalizeSearchValue(filters.query);

  // First pass: apply dimension filters (non-search)
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

  // If no search query, return scoped items sorted alphabetically
  if (!query) {
    return [...scoped].sort(compareAlphabetically);
  }

  // Second pass: rank results by search relevance, sort by rank then alphabetically
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
