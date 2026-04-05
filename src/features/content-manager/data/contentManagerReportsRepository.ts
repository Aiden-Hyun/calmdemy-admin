import {
  Timestamp,
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  getLatestCompletedCourseJobForCourseId,
  getLatestCompletedCourseJobForCourseSessionId,
  getLatestCompletedJobForContentId,
} from '@features/admin/data/adminRepository';
import { db } from '@/firebase';
import {
  ContentReportStatus,
  ReportCategory,
} from '@/types';
import { getContentManagerItemDetail } from './contentManagerRepository';
import {
  CONTENT_MANAGER_COLLECTION_LABELS,
  ContentManagerCollection,
  ContentManagerItemDetail,
  ContentManagerRepairActionAvailability,
  ContentManagerReportSummary,
} from '../types';

const REPORT_COLLECTION_BY_CONTENT_TYPE: Record<string, ContentManagerCollection> = {
  guided_meditation: 'guided_meditations',
  sleep_meditation: 'sleep_meditations',
  bedtime_story: 'bedtime_stories',
  emergency: 'emergency_meditations',
  course_session: 'course_sessions',
};

function asTimestamp(value: unknown): Timestamp | undefined {
  return value instanceof Timestamp ? value : undefined;
}

function normalizeReportStatus(value: unknown): ContentReportStatus {
  return String(value || '').trim() === 'resolved' ? 'resolved' : 'open';
}

function normalizeReportCategory(value: unknown): ReportCategory {
  const category = String(value || '').trim();
  switch (category) {
    case 'audio_issue':
    case 'wrong_content':
    case 'inappropriate':
    case 'other':
      return category;
    default:
      return 'other';
  }
}

function getCollectionForContentType(contentType: string): ContentManagerCollection | null {
  return REPORT_COLLECTION_BY_CONTENT_TYPE[contentType] || null;
}

export function getReportContentTypeForCollection(
  collectionName: ContentManagerCollection
): string | null {
  switch (collectionName) {
    case 'guided_meditations':
      return 'guided_meditation';
    case 'sleep_meditations':
      return 'sleep_meditation';
    case 'bedtime_stories':
      return 'bedtime_story';
    case 'emergency_meditations':
      return 'emergency';
    case 'course_sessions':
      return 'course_session';
    default:
      return null;
  }
}

async function enrichSupportedReports(
  reports: ContentManagerReportSummary[]
): Promise<ContentManagerReportSummary[]> {
  const detailCache = new Map<string, ContentManagerItemDetail | null>();

  return Promise.all(
    reports.map(async (report) => {
      if (!report.contentCollection) {
        return report;
      }

      const cacheKey = `${report.contentCollection}:${report.contentId}`;
      if (!detailCache.has(cacheKey)) {
        detailCache.set(
          cacheKey,
          await getContentManagerItemDetail(report.contentCollection, report.contentId)
        );
      }

      const detail = detailCache.get(cacheKey);
      if (!detail) {
        return report;
      }

      return {
        ...report,
        contentTitle: detail.title,
        contentIdentifier: detail.identifier,
        contentTypeLabel: detail.typeLabel,
        thumbnailUrl: detail.thumbnailUrl,
      };
    })
  );
}

function normalizeReport(
  id: string,
  data: Record<string, unknown>
): ContentManagerReportSummary {
  const contentType = String(data.content_type || '').trim();
  const collectionName = getCollectionForContentType(contentType);
  const contentId = String(data.content_id || '').trim();

  return {
    id,
    contentId,
    contentType,
    category: normalizeReportCategory(data.category),
    description: data.description ? String(data.description) : undefined,
    status: normalizeReportStatus(data.status),
    reportedAt: asTimestamp(data.reported_at),
    resolutionNote: data.resolution_note ? String(data.resolution_note) : undefined,
    resolvedAt: asTimestamp(data.resolved_at),
    resolvedByUid: data.resolved_by_uid ? String(data.resolved_by_uid) : undefined,
    resolvedByEmail: data.resolved_by_email ? String(data.resolved_by_email) : undefined,
    isSupported: Boolean(collectionName),
    supportedLink: collectionName
      ? {
          collection: collectionName,
          contentId,
          reportId: id,
        }
      : undefined,
    contentCollection: collectionName || undefined,
    contentTypeLabel: collectionName
      ? CONTENT_MANAGER_COLLECTION_LABELS[collectionName]
      : undefined,
  };
}

export async function getContentManagerReports(): Promise<ContentManagerReportSummary[]> {
  const snapshot = await getDocs(
    query(collection(db, 'content_reports'), orderBy('reported_at', 'desc'))
  );

  const reports = snapshot.docs.map((docSnapshot) =>
    normalizeReport(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
  );

  return await enrichSupportedReports(reports);
}

export async function getContentManagerReportsForItem(
  collectionName: ContentManagerCollection,
  id: string
): Promise<ContentManagerReportSummary[]> {
  const reportContentType = getReportContentTypeForCollection(collectionName);
  if (!reportContentType) {
    return [];
  }

  const snapshot = await getDocs(
    query(
      collection(db, 'content_reports'),
      where('content_id', '==', id)
    )
  );

  const reports = snapshot.docs
    .map((docSnapshot) =>
      normalizeReport(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
    )
    .filter((report) => report.contentType === reportContentType)
    .sort((left, right) => {
      const rightMillis = right.reportedAt?.toMillis?.() || 0;
      const leftMillis = left.reportedAt?.toMillis?.() || 0;
      return rightMillis - leftMillis;
    });

  return await enrichSupportedReports(reports);
}

export async function getOpenContentReportsCount(): Promise<number> {
  const snapshot = await getDocs(
    query(collection(db, 'content_reports'), orderBy('reported_at', 'desc'))
  );

  return snapshot.docs.reduce((count, docSnapshot) => {
    const data = docSnapshot.data() as Record<string, unknown>;
    return normalizeReportStatus(data.status) === 'open' ? count + 1 : count;
  }, 0);
}

export async function getContentManagerRepairActionAvailability(
  item: ContentManagerItemDetail
): Promise<ContentManagerRepairActionAvailability | null> {
  if (item.collection === 'course_sessions') {
    const courseId =
      item.relations.find((relation) => relation.collection === 'courses')?.id || undefined;
    const job = await getLatestCompletedCourseJobForCourseSessionId(item.id, courseId);

    if (!job) {
      return {
        job: null,
        sessionCode: item.code,
        canOpenFactoryJob: false,
        canRegenerateAudioOnly: false,
        canRegenerateScriptAndAudio: false,
        canGenerateThumbnail: false,
        message: 'No supporting course job found for this session.',
      };
    }

    return {
      job,
      sessionCode: item.code,
      canOpenFactoryJob: true,
      canRegenerateAudioOnly: Boolean(item.code),
      canRegenerateScriptAndAudio: Boolean(item.code),
      canGenerateThumbnail: false,
    };
  }

  if (item.collection === 'courses') {
    const job = await getLatestCompletedCourseJobForCourseId(item.id);

    if (!job) {
      return {
        job: null,
        canOpenFactoryJob: false,
        canRegenerateAudioOnly: false,
        canRegenerateScriptAndAudio: false,
        canGenerateThumbnail: false,
        message: 'No supporting course job found for this course.',
      };
    }

    return {
      job,
      canOpenFactoryJob: true,
      canRegenerateAudioOnly: false,
      canRegenerateScriptAndAudio: false,
      canGenerateThumbnail: true,
    };
  }

  // All non-course content types that support thumbnail generation
  const singleContentCollections = [
    'guided_meditations',
    'sleep_meditations',
    'bedtime_stories',
    'emergency_meditations',
    'albums',
    'sleep_sounds',
    'white_noise',
    'music',
    'asmr',
    'series',
  ] as const;

  if (singleContentCollections.includes(item.collection as any)) {
    const job = await getLatestCompletedJobForContentId(item.id);

    if (!job) {
      return {
        job: null,
        canOpenFactoryJob: false,
        canRegenerateAudioOnly: false,
        canRegenerateScriptAndAudio: false,
        canGenerateThumbnail: false,
        message: 'No supporting factory job found for this content.',
      };
    }

    return {
      job,
      canOpenFactoryJob: true,
      canRegenerateAudioOnly: false,
      canRegenerateScriptAndAudio: false,
      canGenerateThumbnail: true,
    };
  }

  return null;
}
