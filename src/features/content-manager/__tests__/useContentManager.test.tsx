import React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToDom } from '@/test-utils/domRender';
import { getContentManagerEditFields } from '../data/contentManagerEditConfig';

const repoMocks = vi.hoisted(() => ({
  getContentManagerItems: vi.fn(),
  getContentManagerItemDetail: vi.fn(),
  getContentManagerAuditEntries: vi.fn(),
  updateContentMetadata: vi.fn(),
  updateContentReportStatus: vi.fn(),
  getContentManagerReports: vi.fn(),
  getContentManagerReportsForItem: vi.fn(),
  getOpenContentReportsCount: vi.fn(),
  getContentManagerRepairActionAvailability: vi.fn(),
  regenerateCourseSessions: vi.fn(),
  requestCourseThumbnailGeneration: vi.fn(),
}));

const focusEffectState = vi.hoisted(() => ({
  callbacks: [] as Array<() => void>,
}));

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    focusEffectState.callbacks.push(callback);
  },
}));

vi.mock('../data/contentManagerRepository', () => ({
  getContentManagerItems: repoMocks.getContentManagerItems,
  getContentManagerItemDetail: repoMocks.getContentManagerItemDetail,
}));

vi.mock('../data/contentManagerAdminRepository', () => ({
  getContentManagerAuditEntries: repoMocks.getContentManagerAuditEntries,
  updateContentMetadata: repoMocks.updateContentMetadata,
  updateContentReportStatus: repoMocks.updateContentReportStatus,
}));

vi.mock('../data/contentManagerReportsRepository', () => ({
  getContentManagerReports: repoMocks.getContentManagerReports,
  getContentManagerReportsForItem: repoMocks.getContentManagerReportsForItem,
  getOpenContentReportsCount: repoMocks.getOpenContentReportsCount,
  getContentManagerRepairActionAvailability: repoMocks.getContentManagerRepairActionAvailability,
}));

vi.mock('@features/admin/data/adminRepository', () => ({
  regenerateCourseSessions: repoMocks.regenerateCourseSessions,
  requestCourseThumbnailGeneration: repoMocks.requestCourseThumbnailGeneration,
}));

import {
  useContentManagerCatalog,
  useContentManagerDetail,
  useContentManagerReportsInbox,
} from '../hooks/useContentManager';

function buildDetail(title = 'Calm Breath') {
  return {
    id: 'item-1',
    collection: 'guided_meditations' as const,
    typeLabel: 'Guided Meditation',
    title,
    description: 'A grounding reset.',
    identifier: 'item-1',
    access: 'free' as const,
    previewRoute: { pathname: '/meditation/[id]' as const, params: { id: 'item-1' } },
    metadata: [{ label: 'Themes', value: 'focus' }],
    relations: [],
    editableFields: getContentManagerEditFields('guided_meditations'),
    editableValues: {
      title,
      description: 'A grounding reset.',
      duration_minutes: 10,
      thumbnailUrl: null,
      themes: ['focus'],
      techniques: ['breathing'],
      difficulty_level: 'beginner',
      instructor: 'Ava',
    },
  };
}

function CatalogHarness() {
  const { filteredItems } = useContentManagerCatalog();

  return <div data-testid="catalog-titles">{filteredItems.map((item) => item.title).join('|')}</div>;
}

function DetailHarness() {
  const detail = useContentManagerDetail('guided_meditations', 'item-1');

  return (
    <div>
      <div data-testid="detail-title">{detail.item?.title || ''}</div>
      <div data-testid="detail-mode">{detail.isEditing ? 'editing' : 'view'}</div>
      <div data-testid="detail-save-message">{detail.saveMessage || ''}</div>
      <div data-testid="detail-save-error">{detail.saveError || ''}</div>
      <div data-testid="detail-history">
        {detail.history
          .map((entry) => `${entry.actorEmail || entry.actorUid}:${entry.reason}:${entry.changedFields.join(',')}`)
          .join('|')}
      </div>

      <button data-testid="start-edit" type="button" onClick={detail.startEditing}>
        Start
      </button>
      <button data-testid="cancel-edit" type="button" onClick={detail.cancelEditing}>
        Cancel
      </button>
      <button
        data-testid="set-title"
        type="button"
        onClick={() => detail.setFieldValue('title', 'Updated Breath')}
      >
        Set title
      </button>
      <button
        data-testid="set-invalid-duration"
        type="button"
        onClick={() => detail.setFieldValue('duration_minutes', '0')}
      >
        Invalid duration
      </button>
      <button
        data-testid="set-reason"
        type="button"
        onClick={() => detail.setReason('Fixing metadata copy')}
      >
        Set reason
      </button>
      <button
        data-testid="save-edit"
        type="button"
        disabled={!detail.isDirty || !detail.isValid || detail.isSaving}
        onClick={() => detail.saveMetadata()}
      >
        Save
      </button>
    </div>
  );
}

function ReportsInboxHarness() {
  const inbox = useContentManagerReportsInbox();

  return (
    <div>
      <div data-testid="reports-count">{String(inbox.filteredReports.length)}</div>
      <div data-testid="reports-open-count">{String(inbox.openCount)}</div>
      <div data-testid="reports-message">{inbox.message || ''}</div>
      <div data-testid="reports-error">{inbox.error || ''}</div>

      <button
        data-testid="reports-set-query"
        type="button"
        onClick={() => inbox.setQuery('breath')}
      >
        Query
      </button>
      <button
        data-testid="reports-set-status-resolved"
        type="button"
        onClick={() => inbox.setStatus('resolved')}
      >
        Status
      </button>
      <button
        data-testid="reports-resolve"
        type="button"
        onClick={() => inbox.updateStatus('report-1', 'resolved', 'Handled')}
      >
        Resolve
      </button>
    </div>
  );
}

function DetailRepairHarness() {
  const detail = useContentManagerDetail('course_sessions', 'session-1');

  return (
    <div>
      <div data-testid="repair-message">{detail.repairMessage || ''}</div>
      <div data-testid="repair-error">{detail.repairError || ''}</div>

      <button
        data-testid="repair-audio"
        type="button"
        onClick={() => detail.runRepairAction('audio_only')}
      >
        Audio
      </button>
      <button
        data-testid="repair-thumbnail"
        type="button"
        onClick={() => detail.runRepairAction('thumbnail')}
      >
        Thumbnail
      </button>
    </div>
  );
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useContentManager hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusEffectState.callbacks = [];
    repoMocks.getContentManagerReports.mockResolvedValue([]);
    repoMocks.getContentManagerReportsForItem.mockResolvedValue([]);
    repoMocks.getOpenContentReportsCount.mockResolvedValue(0);
    repoMocks.getContentManagerRepairActionAvailability.mockResolvedValue(null);
  });

  it('refreshes the catalog when the screen regains focus', async () => {
    repoMocks.getContentManagerItems
      .mockResolvedValueOnce([
        {
          id: 'item-1',
          collection: 'guided_meditations',
          typeLabel: 'Guided Meditation',
          title: 'Calm Breath',
          identifier: 'item-1',
          access: 'free',
          previewRoute: { pathname: '/meditation/[id]', params: { id: 'item-1' } },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'item-2',
          collection: 'bedtime_stories',
          typeLabel: 'Bedtime Story',
          title: 'Quiet Forest',
          identifier: 'item-2',
          access: 'free',
          previewRoute: { pathname: '/sleep/[id]', params: { id: 'item-2' } },
        },
      ]);

    const { getByTestId } = renderToDom(<CatalogHarness />);
    await flushAsyncWork();

    expect(getByTestId('catalog-titles').textContent).toContain('Calm Breath');

    await act(async () => {
      focusEffectState.callbacks.at(-1)?.();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(getByTestId('catalog-titles').textContent).toContain('Quiet Forest');
  });

  it('tracks edit mode and only enables save when the form is dirty and valid', async () => {
    repoMocks.getContentManagerItemDetail.mockResolvedValue(buildDetail());
    repoMocks.getContentManagerAuditEntries.mockResolvedValue([]);

    const { getByTestId, click } = renderToDom(<DetailHarness />);
    await flushAsyncWork();

    expect(getByTestId('detail-mode').textContent).toBe('view');
    expect((getByTestId('save-edit') as HTMLButtonElement).disabled).toBe(true);

    click(getByTestId('start-edit'));
    expect(getByTestId('detail-mode').textContent).toBe('editing');

    click(getByTestId('set-title'));
    expect((getByTestId('save-edit') as HTMLButtonElement).disabled).toBe(true);

    click(getByTestId('set-reason'));
    expect((getByTestId('save-edit') as HTMLButtonElement).disabled).toBe(false);

    click(getByTestId('cancel-edit'));
    expect(getByTestId('detail-mode').textContent).toBe('view');
  });

  it('reloads detail data and audit history after a successful save', async () => {
    repoMocks.getContentManagerItemDetail
      .mockResolvedValueOnce(buildDetail('Calm Breath'))
      .mockResolvedValueOnce(buildDetail('Updated Breath'));
    repoMocks.getContentManagerAuditEntries
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'entry-1',
          actorUid: 'admin-1',
          actorEmail: 'admin@calmdemy.app',
          reason: 'Fixing metadata copy',
          changedFields: ['title'],
          before: { title: 'Calm Breath' },
          after: { title: 'Updated Breath' },
        },
      ]);
    repoMocks.updateContentMetadata.mockResolvedValue({
      changed: true,
      changedFields: ['title'],
    });

    const { getByTestId, click } = renderToDom(<DetailHarness />);
    await flushAsyncWork();

    click(getByTestId('start-edit'));
    click(getByTestId('set-title'));
    click(getByTestId('set-reason'));
    click(getByTestId('save-edit'));
    await flushAsyncWork();
    await flushAsyncWork();

    expect(repoMocks.updateContentMetadata).toHaveBeenCalledWith(
      'guided_meditations',
      'item-1',
      { title: 'Updated Breath' },
      'Fixing metadata copy'
    );
    expect(getByTestId('detail-title').textContent).toBe('Updated Breath');
    expect(getByTestId('detail-mode').textContent).toBe('view');
    expect(getByTestId('detail-history').textContent).toContain(
      'admin@calmdemy.app:Fixing metadata copy:title'
    );
    expect(getByTestId('detail-save-message').textContent).toContain('Saved 1 field');
  });

  it('keeps edit mode open when save fails', async () => {
    repoMocks.getContentManagerItemDetail.mockResolvedValue(buildDetail());
    repoMocks.getContentManagerAuditEntries.mockResolvedValue([]);
    repoMocks.updateContentMetadata.mockRejectedValue(new Error('Network down'));

    const { getByTestId, click } = renderToDom(<DetailHarness />);
    await flushAsyncWork();

    click(getByTestId('start-edit'));
    click(getByTestId('set-title'));
    click(getByTestId('set-reason'));
    click(getByTestId('save-edit'));
    await flushAsyncWork();

    expect(getByTestId('detail-mode').textContent).toBe('editing');
    expect(getByTestId('detail-save-error').textContent).toContain('Network down');
  });

  it('filters reports in the inbox and resolves a report', async () => {
    repoMocks.getContentManagerReports
      .mockResolvedValueOnce([
        {
          id: 'report-1',
          contentId: 'item-1',
          contentType: 'guided_meditation',
          category: 'audio_issue',
          description: 'Breath audio is clipped.',
          status: 'open',
          isSupported: true,
          supportedLink: {
            collection: 'guided_meditations',
            contentId: 'item-1',
            reportId: 'report-1',
          },
          contentCollection: 'guided_meditations',
          contentTitle: 'Calm Breath',
          contentIdentifier: 'item-1',
          contentTypeLabel: 'Guided Meditation',
        },
        {
          id: 'report-2',
          contentId: 'item-2',
          contentType: 'sound',
          category: 'other',
          description: 'Rain track loops poorly.',
          status: 'resolved',
          isSupported: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'report-1',
          contentId: 'item-1',
          contentType: 'guided_meditation',
          category: 'audio_issue',
          description: 'Breath audio is clipped.',
          status: 'resolved',
          isSupported: true,
          supportedLink: {
            collection: 'guided_meditations',
            contentId: 'item-1',
            reportId: 'report-1',
          },
          contentCollection: 'guided_meditations',
          contentTitle: 'Calm Breath',
          contentIdentifier: 'item-1',
          contentTypeLabel: 'Guided Meditation',
        },
      ]);
    repoMocks.updateContentReportStatus.mockResolvedValue({
      ok: true,
      status: 'resolved',
      changed: true,
    });

    const { getByTestId, click } = renderToDom(<ReportsInboxHarness />);
    await flushAsyncWork();

    expect(getByTestId('reports-count').textContent).toBe('1');
    expect(getByTestId('reports-open-count').textContent).toBe('1');

    click(getByTestId('reports-set-status-resolved'));
    expect(getByTestId('reports-count').textContent).toBe('1');

    click(getByTestId('reports-resolve'));
    await flushAsyncWork();

    expect(repoMocks.updateContentReportStatus).toHaveBeenCalledWith(
      'report-1',
      'resolved',
      'Handled'
    );
    expect(getByTestId('reports-message').textContent).toContain('Report resolved.');
  });

  it('starts course-session repair actions without auto-resolving reports', async () => {
    repoMocks.getContentManagerItemDetail.mockResolvedValue({
      id: 'session-1',
      collection: 'course_sessions',
      typeLabel: 'Course Session',
      title: 'Lesson 1',
      description: 'Session description',
      identifier: 'CBT101M1L',
      code: 'CBT101M1L',
      access: 'premium',
      previewRoute: {
        pathname: '/course/session/[id]' as const,
        params: { id: 'session-1' },
      },
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
      editableFields: getContentManagerEditFields('course_sessions'),
      editableValues: {
        title: 'Lesson 1',
        description: 'Session description',
        duration_minutes: 12,
      },
    });
    repoMocks.getContentManagerAuditEntries.mockResolvedValue([]);
    repoMocks.getContentManagerReportsForItem.mockResolvedValue([
      {
        id: 'report-1',
        contentId: 'session-1',
        contentType: 'course_session',
        category: 'wrong_content',
        description: 'Audio mismatches the transcript.',
        status: 'open',
        isSupported: true,
        supportedLink: {
          collection: 'course_sessions',
          contentId: 'session-1',
          reportId: 'report-1',
        },
        contentCollection: 'course_sessions',
        contentTitle: 'Lesson 1',
        contentIdentifier: 'CBT101M1L',
        contentTypeLabel: 'Course Session',
      },
    ]);
    repoMocks.getContentManagerRepairActionAvailability.mockResolvedValue({
      job: {
        id: 'job-1',
        status: 'completed',
        contentType: 'course',
      },
      sessionCode: 'CBT101M1L',
      canOpenFactoryJob: true,
      canRegenerateAudioOnly: true,
      canRegenerateScriptAndAudio: true,
      canGenerateThumbnail: false,
    });

    const { getByTestId, click } = renderToDom(<DetailRepairHarness />);
    await flushAsyncWork();

    click(getByTestId('repair-audio'));
    await flushAsyncWork();

    expect(repoMocks.regenerateCourseSessions).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: 'completed',
        contentType: 'course',
      },
      {
        mode: 'audio_only',
        targetSessionCodes: ['CBT101M1L'],
      }
    );
    expect(repoMocks.updateContentReportStatus).not.toHaveBeenCalled();
    expect(getByTestId('repair-message').textContent).toContain('Audio regeneration requested.');
  });
});
