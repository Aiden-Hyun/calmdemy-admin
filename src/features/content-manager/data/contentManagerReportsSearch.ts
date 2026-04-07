/**
 * ARCHITECTURAL ROLE:
 * Simple filter implementation for content reports (moderation inbox). Applies faceted filters
 * (status, category, type) and basic substring search. Simpler than content item search because
 * reports don't need ranking (date-ordered by default, handled elsewhere).
 *
 * DESIGN PATTERNS:
 * - **Faceted Search**: Each dimension (status, category, type) independently filters.
 * - **Substring Match**: No ranking; just looks for substring in title, ID, description.
 * - **Special Filter**: type === 'unsupported' is a special value (not a content collection).
 *   Filters to reports for content types the admin system doesn't yet support (audio_issue on unknown content).
 *
 * CONSUMERS:
 * - useContentManagerReportsInbox hook: filters all reports by current filter state
 * - ContentManagerReportsScreen: renders filtered reports in FlatList
 */

import {
  ContentManagerReportSummary,
  ContentManagerReportsFilterState,
} from '../types';

/**
 * Simple substring match check across multiple report fields.
 * Joins enriched fields (title, identifier from resolved content) with raw fields (id, description)
 * and performs case-insensitive substring match.
 *
 * QUERY SEMANTICS:
 * - Empty query always matches (no filtering)
 * - Non-empty: must appear as substring in at least one field
 * - No ranking like content search; reports don't need BM25-style prioritization
 *
 * FIELDS SEARCHED:
 * - contentTitle: Admin-facing title of the reported content (e.g., meditation name)
 * - contentIdentifier: Code or ID of the reported content
 * - contentId: Raw Firestore document ID
 * - contentType: Report content type string (backend naming)
 * - description: User-provided report comment
 *
 * @param report - Report to match against
 * @param query - Normalized search query (lowercase, trimmed)
 * @returns true if query found in any searchable field
 */
function matchesQuery(report: ContentManagerReportSummary, query: string): boolean {
  if (!query) return true;

  const haystack = [
    report.contentTitle,
    report.contentIdentifier,
    report.contentId,
    report.contentType,
    report.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

/**
 * Applies all report filters (status, category, type, search query).
 *
 * FILTER DIMENSIONS:
 * - status: 'open', 'resolved', 'all' — state of report
 * - category: 'audio_issue', 'wrong_content', 'inappropriate', 'other', 'all'
 * - type: content collection name, 'unsupported' (for unknown content), or 'all'
 * - query: substring search across title, ID, description, content type
 *
 * SPECIAL HANDLING:
 * - type === 'unsupported': Filters to isSupported=false (reports for unknown/unsupported content)
 * - type === 'all': Includes both supported and unsupported
 * - type === <specific collection>: Filters to that collection only
 *
 * ORDER:
 * - Results maintain input order (not resorted here)
 * - Caller (hook or screen) may sort by date, priority, etc.
 *
 * @param reports - Unfiltered report list (all reports from inbox)
 * @param filters - Current filter state from UI
 * @returns Filtered subset of reports
 */
export function filterContentManagerReports(
  reports: ContentManagerReportSummary[],
  filters: ContentManagerReportsFilterState
): ContentManagerReportSummary[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return reports.filter((report) => {
    if (filters.status !== 'all' && report.status !== filters.status) {
      return false;
    }

    if (filters.category !== 'all' && report.category !== filters.category) {
      return false;
    }

    if (filters.type === 'unsupported' && report.isSupported) {
      return false;
    }

    if (
      filters.type !== 'all' &&
      filters.type !== 'unsupported' &&
      report.contentCollection !== filters.type
    ) {
      return false;
    }

    return matchesQuery(report, normalizedQuery);
  });
}
