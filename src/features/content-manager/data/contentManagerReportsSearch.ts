import {
  ContentManagerReportSummary,
  ContentManagerReportsFilterState,
} from '../types';

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
