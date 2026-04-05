import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

const repoMocks = vi.hoisted(() => ({
  mockCollection: vi.fn((_db, name) => `collection:${name}`),
  mockGetDocs: vi.fn(),
  mockOrderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
  mockQuery: vi.fn((ref, ...constraints) => ({ ref, constraints })),
  mockWhere: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
  getContentManagerItemDetail: vi.fn(),
  getLatestCompletedCourseJobForCourseId: vi.fn(),
  getLatestCompletedCourseJobForCourseSessionId: vi.fn(),
}));

vi.mock('@/firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    collection: (...args: unknown[]) => repoMocks.mockCollection(...args),
    getDocs: (...args: unknown[]) => repoMocks.mockGetDocs(...args),
    orderBy: (...args: unknown[]) => repoMocks.mockOrderBy(...args),
    query: (...args: unknown[]) => repoMocks.mockQuery(...args),
    where: (...args: unknown[]) => repoMocks.mockWhere(...args),
  };
});

vi.mock('../data/contentManagerRepository', () => ({
  getContentManagerItemDetail: repoMocks.getContentManagerItemDetail,
}));

vi.mock('@features/admin/data/adminRepository', () => ({
  getLatestCompletedCourseJobForCourseId: repoMocks.getLatestCompletedCourseJobForCourseId,
  getLatestCompletedCourseJobForCourseSessionId:
    repoMocks.getLatestCompletedCourseJobForCourseSessionId,
}));

import {
  getContentManagerRepairActionAvailability,
  getContentManagerReports,
  getContentManagerReportsForItem,
} from '../data/contentManagerReportsRepository';

describe('contentManagerReportsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats legacy reports without status as open and enriches supported reports', async () => {
    repoMocks.mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'report-1',
          data: () => ({
            content_id: 'item-1',
            content_type: 'guided_meditation',
            category: 'audio_issue',
            description: 'Audio pops at 1:10.',
            reported_at: Timestamp.fromDate(new Date('2026-03-28T09:00:00Z')),
          }),
        },
        {
          id: 'report-2',
          data: () => ({
            content_id: 'sound-1',
            content_type: 'sound',
            category: 'other',
            reported_at: Timestamp.fromDate(new Date('2026-03-27T09:00:00Z')),
          }),
        },
      ],
    });
    repoMocks.getContentManagerItemDetail.mockResolvedValueOnce({
      id: 'item-1',
      collection: 'guided_meditations',
      typeLabel: 'Guided Meditation',
      title: 'Calm Breath',
      identifier: 'item-1',
      access: 'free',
      previewRoute: { pathname: '/meditation/[id]', params: { id: 'item-1' } },
      metadata: [],
      relations: [],
      editableFields: [],
      editableValues: {},
    });

    const result = await getContentManagerReports();

    expect(result[0]).toMatchObject({
      id: 'report-1',
      status: 'open',
      isSupported: true,
      contentTitle: 'Calm Breath',
      contentIdentifier: 'item-1',
      supportedLink: {
        collection: 'guided_meditations',
        contentId: 'item-1',
        reportId: 'report-1',
      },
    });
    expect(result[1]).toMatchObject({
      id: 'report-2',
      status: 'open',
      isSupported: false,
      supportedLink: undefined,
    });
  });

  it('filters reports for a single supported content item by content type', async () => {
    repoMocks.mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'report-1',
          data: () => ({
            content_id: 'item-1',
            content_type: 'guided_meditation',
            category: 'audio_issue',
            status: 'resolved',
            reported_at: Timestamp.fromDate(new Date('2026-03-28T10:00:00Z')),
          }),
        },
        {
          id: 'report-2',
          data: () => ({
            content_id: 'item-1',
            content_type: 'sleep_meditation',
            category: 'other',
            status: 'open',
            reported_at: Timestamp.fromDate(new Date('2026-03-27T10:00:00Z')),
          }),
        },
      ],
    });
    repoMocks.getContentManagerItemDetail.mockResolvedValueOnce({
      id: 'item-1',
      collection: 'guided_meditations',
      typeLabel: 'Guided Meditation',
      title: 'Calm Breath',
      identifier: 'item-1',
      access: 'free',
      previewRoute: { pathname: '/meditation/[id]', params: { id: 'item-1' } },
      metadata: [],
      relations: [],
      editableFields: [],
      editableValues: {},
    });

    const result = await getContentManagerReportsForItem('guided_meditations', 'item-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'report-1',
      contentType: 'guided_meditation',
      status: 'resolved',
      contentTitle: 'Calm Breath',
    });
    expect(repoMocks.mockWhere).toHaveBeenCalledWith('content_id', '==', 'item-1');
  });

  it('resolves course-session repair availability from the latest completed course job', async () => {
    repoMocks.getLatestCompletedCourseJobForCourseSessionId.mockResolvedValueOnce({
      id: 'job-1',
      status: 'completed',
      contentType: 'course',
    });

    const result = await getContentManagerRepairActionAvailability({
      id: 'session-1',
      collection: 'course_sessions',
      typeLabel: 'Course Session',
      title: 'Lesson 1',
      identifier: 'CBT101M1L',
      code: 'CBT101M1L',
      access: 'premium',
      previewRoute: { pathname: '/course/session/[id]', params: { id: 'session-1' } },
      metadata: [],
      relations: [
        {
          label: 'Course',
          collection: 'courses',
          id: 'course-1',
          title: 'CBT Foundations',
          code: 'CBT101',
        },
      ],
      editableFields: [],
      editableValues: {},
    });

    expect(result).toMatchObject({
      canOpenFactoryJob: true,
      canRegenerateAudioOnly: true,
      canRegenerateScriptAndAudio: true,
      sessionCode: 'CBT101M1L',
      job: {
        id: 'job-1',
      },
    });
    expect(repoMocks.getLatestCompletedCourseJobForCourseSessionId).toHaveBeenCalledWith(
      'session-1',
      'course-1'
    );
  });
});
