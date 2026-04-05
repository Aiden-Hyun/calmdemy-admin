import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { theme } from '@/theme';
import ContentManagerDetailScreen from '../screens/ContentManagerDetailScreen';
import { ContentManagerItemDetail } from '../types';
import { renderToDom } from '@/test-utils/domRender';
import { getContentManagerEditFields } from '../data/contentManagerEditConfig';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockStartEditing = vi.fn();
const mockCancelEditing = vi.fn();
const mockSetFieldValue = vi.fn();
const mockToggleFieldOption = vi.fn();
const mockSetReason = vi.fn();
const mockSaveMetadata = vi.fn();
const mockUpdateReportStatus = vi.fn();
const mockRunRepairAction = vi.fn();
const mockUseContentManagerDetail = vi.fn();

function createReactNativeMock() {
  const React = require('react');

  const makeNode = (tag: string) => {
    return ({ children, testID, ...props }: any) =>
      React.createElement(tag, { 'data-testid': testID, ...props }, children);
  };

  return {
    View: makeNode('div'),
    Text: makeNode('span'),
    ScrollView: makeNode('div'),
    Image: ({ testID, ...props }: any) =>
      React.createElement('img', { 'data-testid': testID, ...props }),
    ActivityIndicator: ({ testID }: any) =>
      React.createElement('div', { 'data-testid': testID || 'activity-indicator' }, 'loading'),
    TextInput: ({ testID, value, onChangeText, ...props }: any) =>
      React.createElement('input', {
        'data-testid': testID,
        value,
        onChange: (event: any) => onChangeText?.(event.target.value),
        ...props,
      }),
    Pressable: ({ children, onPress, testID, disabled }: any) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': testID,
          disabled,
          onClick: () => {
            if (!disabled) {
              onPress?.();
            }
          },
        },
        typeof children === 'function' ? children({ pressed: false }) : children
      ),
    StyleSheet: {
      create: (styles: any) => styles,
    },
    Platform: {
      OS: 'web',
      select: (value: Record<string, any>) => value.web ?? value.default,
    },
  };
}

vi.mock('react-native', () => createReactNativeMock());

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useLocalSearchParams: () => ({
    collection: 'guided_meditations',
    id: 'item-1',
    reportId: undefined,
  }),
}));

vi.mock('@core/providers/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme,
    isDark: false,
  }),
}));

vi.mock('../hooks/useContentManager', () => ({
  useContentManagerDetail: () => mockUseContentManagerDetail(),
}));

function buildDetail(overrides: Partial<ContentManagerItemDetail>): ContentManagerItemDetail {
  return {
    id: 'item-1',
    collection: 'guided_meditations',
    typeLabel: 'Guided Meditation',
    title: 'Calm Breath',
    description: 'A grounding reset.',
    identifier: 'item-1',
    access: 'free',
    previewRoute: { pathname: '/meditation/[id]', params: { id: 'item-1' } },
    metadata: [],
    relations: [],
    editableFields: getContentManagerEditFields('guided_meditations'),
    editableValues: {
      title: 'Calm Breath',
      description: 'A grounding reset.',
      duration_minutes: 10,
      thumbnailUrl: null,
      themes: ['focus'],
      techniques: ['breathing'],
      difficulty_level: 'beginner',
      instructor: 'Ava',
    },
    ...overrides,
  };
}

describe('ContentManagerDetailScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContentManagerDetail.mockReturnValue({
      item: null,
      history: [],
      reports: [],
      selectedReport: null,
      repairAvailability: null,
      formValues: {},
      reason: '',
      fieldErrors: {},
      reasonError: undefined,
      isEditing: false,
      isLoading: false,
      isRefreshing: false,
      isSaving: false,
      isRepairing: null,
      updatingReportId: null,
      error: null,
      saveError: null,
      saveMessage: null,
      repairError: null,
      repairMessage: null,
      reportError: null,
      reportMessage: null,
      isDirty: false,
      isValid: false,
      refresh: mockRefresh,
      startEditing: mockStartEditing,
      cancelEditing: mockCancelEditing,
      setFieldValue: mockSetFieldValue,
      toggleFieldOption: mockToggleFieldOption,
      setReason: mockSetReason,
      saveMetadata: mockSaveMetadata,
      updateReportStatus: mockUpdateReportStatus,
      runRepairAction: mockRunRepairAction,
    });
  });

  it('shows a loading state', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      isLoading: true,
    });

    const { getByText } = renderToDom(<ContentManagerDetailScreen />);
    expect(getByText('Loading content detail')).toBeTruthy();
  });

  it('shows a not found state', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      error: 'Content not found.',
    });

    const { getByText } = renderToDom(<ContentManagerDetailScreen />);
    expect(getByText('Content unavailable')).toBeTruthy();
  });

  it.each([
    buildDetail({
      collection: 'guided_meditations',
      typeLabel: 'Guided Meditation',
      metadata: [{ label: 'Themes', value: 'focus' }],
    }),
    buildDetail({
      collection: 'sleep_meditations',
      typeLabel: 'Sleep Meditation',
      title: 'Night Reset',
      previewRoute: { pathname: '/sleep/meditation/[id]', params: { id: 'item-1' } },
      metadata: [{ label: 'Instructor', value: 'Ava' }],
      editableFields: getContentManagerEditFields('sleep_meditations'),
      editableValues: {
        title: 'Night Reset',
        description: 'Sleep meditation',
        duration_minutes: 15,
        thumbnailUrl: null,
        instructor: 'Ava',
        icon: 'moon',
        color: '#223344',
      },
    }),
    buildDetail({
      collection: 'bedtime_stories',
      typeLabel: 'Bedtime Story',
      title: 'Quiet Forest',
      previewRoute: { pathname: '/sleep/[id]', params: { id: 'item-1' } },
      metadata: [{ label: 'Narrator', value: 'Lia' }],
      editableFields: getContentManagerEditFields('bedtime_stories'),
      editableValues: {
        title: 'Quiet Forest',
        description: 'A bedtime story',
        duration_minutes: 20,
        thumbnail_url: null,
        narrator: 'Lia',
        category: 'nature',
      },
    }),
    buildDetail({
      collection: 'emergency_meditations',
      typeLabel: 'Emergency Meditation',
      title: 'Panic Reset',
      previewRoute: { pathname: '/emergency/[id]', params: { id: 'item-1' } },
      metadata: [{ label: 'Icon', value: 'flash' }],
      editableFields: getContentManagerEditFields('emergency_meditations'),
      editableValues: {
        title: 'Panic Reset',
        description: 'Emergency support',
        duration_minutes: 5,
        thumbnailUrl: null,
        narrator: null,
        icon: 'flash',
        color: '#ffcc00',
      },
    }),
    buildDetail({
      collection: 'courses',
      typeLabel: 'Course',
      title: 'CBT Foundations',
      code: 'CBT101',
      identifier: 'CBT101',
      previewRoute: { pathname: '/course/[id]', params: { id: 'item-1' } },
      metadata: [{ label: 'Code', value: 'CBT101' }],
      relations: [
        {
          label: 'Session 1',
          collection: 'course_sessions',
          id: 'session-1',
          title: 'Lesson 1',
          code: 'CBT101M1L',
        },
      ],
      editableFields: getContentManagerEditFields('courses'),
      editableValues: {
        title: 'CBT Foundations',
        subtitle: 'Reset your thinking',
        description: 'Course description',
        thumbnailUrl: null,
        instructor: 'Sam',
        icon: 'leaf',
        color: '#112233',
      },
    }),
    buildDetail({
      collection: 'course_sessions',
      typeLabel: 'Course Session',
      title: 'Lesson 1',
      code: 'CBT101M1L',
      identifier: 'CBT101M1L',
      access: 'premium',
      previewRoute: { pathname: '/course/session/[id]', params: { id: 'item-1' } },
      metadata: [{ label: 'Course ID', value: 'course-1' }],
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
        description: 'Course session',
        duration_minutes: 12,
      },
    }),
  ])('renders detail content for $typeLabel', (detail) => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: detail,
    });

    const { getByText } = renderToDom(<ContentManagerDetailScreen />);

    expect(getByText(detail.title)).toBeTruthy();
    expect(getByText(detail.typeLabel)).toBeTruthy();
    if (detail.metadata[0]) {
      expect(getByText(detail.metadata[0].label)).toBeTruthy();
      expect(getByText(detail.metadata[0].value)).toBeTruthy();
    }
  });

  it('renders audit history newest first with actor and changed fields', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({ title: 'Calm Breath' }),
      history: [
        {
          id: 'entry-new',
          actorUid: 'admin-1',
          actorEmail: 'newer@calmdemy.app',
          reason: 'Updated title',
          changedFields: ['title'],
          before: { title: 'Calm Breath' },
          after: { title: 'Updated Breath' },
          createdAt: Timestamp.fromDate(new Date('2026-03-28T10:00:00Z')),
        },
        {
          id: 'entry-old',
          actorUid: 'admin-2',
          actorEmail: 'older@calmdemy.app',
          reason: 'Updated description',
          changedFields: ['description'],
          before: { description: 'Short copy' },
          after: { description: 'Longer copy' },
          createdAt: Timestamp.fromDate(new Date('2026-03-27T10:00:00Z')),
        },
      ],
    });

    const { container, getByText } = renderToDom(<ContentManagerDetailScreen />);

    expect(getByText('newer@calmdemy.app')).toBeTruthy();
    expect(getByText('Updated title')).toBeTruthy();
    expect(getByText('Changed: Title')).toBeTruthy();
    expect(getByText('older@calmdemy.app')).toBeTruthy();

    const historyText = container.textContent || '';
    expect(historyText.indexOf('Updated title')).toBeLessThan(historyText.indexOf('Updated description'));
  });

  it('renders the edit form and keeps save disabled when invalid', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({ title: 'Calm Breath' }),
      isEditing: true,
      isDirty: true,
      isValid: false,
      formValues: {
        title: 'Updated Breath',
        description: 'A grounding reset.',
        duration_minutes: '10',
        thumbnailUrl: '',
        themes: ['focus'],
        techniques: ['breathing'],
        difficulty_level: 'beginner',
        instructor: 'Ava',
      },
      fieldErrors: {},
      reason: '',
      reasonError: 'Change reason is required.',
    });

    const { getByTestId, getByText } = renderToDom(<ContentManagerDetailScreen />);

    expect(getByTestId('content-manager-field-title')).toBeTruthy();
    expect(getByText('Change reason is required.')).toBeTruthy();
    expect((getByTestId('content-manager-save-metadata') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('starts editing when the metadata action is pressed', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({ title: 'Calm Breath' }),
    });

    const { getByTestId, click } = renderToDom(<ContentManagerDetailScreen />);
    click(getByTestId('content-manager-edit-metadata'));

    expect(mockStartEditing).toHaveBeenCalled();
  });

  it('opens the live route and refreshes on action presses', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({
        collection: 'courses',
        typeLabel: 'Course',
        title: 'CBT Foundations',
        code: 'CBT101',
        identifier: 'CBT101',
        previewRoute: { pathname: '/course/[id]', params: { id: 'item-1' } },
        editableFields: getContentManagerEditFields('courses'),
        editableValues: {
          title: 'CBT Foundations',
          subtitle: 'Reset your thinking',
          description: 'Course description',
          thumbnailUrl: null,
          instructor: 'Sam',
          icon: 'leaf',
          color: '#112233',
        },
      }),
    });

    const { getByTestId, click } = renderToDom(<ContentManagerDetailScreen />);

    click(getByTestId('content-manager-open-live-route'));
    click(getByTestId('content-manager-refresh-detail'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/course/[id]',
      params: { id: 'item-1' },
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('navigates through related content entries', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({
        collection: 'course_sessions',
        typeLabel: 'Course Session',
        title: 'Lesson 1',
        code: 'CBT101M1L',
        identifier: 'CBT101M1L',
        access: 'premium',
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
          description: 'Course session',
          duration_minutes: 12,
        },
      }),
    });

    const { getByTestId, click } = renderToDom(<ContentManagerDetailScreen />);
    click(getByTestId('content-manager-relation-courses-course-1'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/content/[collection]/[id]',
      params: {
        collection: 'courses',
        id: 'course-1',
      },
    });
  });

  it('renders reports and resolves the selected report', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({ title: 'Calm Breath' }),
      selectedReport: {
        id: 'report-1',
        contentId: 'item-1',
        contentType: 'guided_meditation',
        category: 'audio_issue',
        description: 'Audio cuts out midway.',
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
      reports: [
        {
          id: 'report-1',
          contentId: 'item-1',
          contentType: 'guided_meditation',
          category: 'audio_issue',
          description: 'Audio cuts out midway.',
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
      ],
    });

    const { getByText, getByTestId, change, click } = renderToDom(<ContentManagerDetailScreen />);

    expect(getByText('Opened from report report-1. The matching report is highlighted below.')).toBeTruthy();
    change(getByTestId('content-manager-report-note-report-1'), 'Fixed the source audio.');
    click(getByTestId('content-manager-report-resolve-report-1'));

    expect(mockUpdateReportStatus).toHaveBeenCalledWith('report-1', 'resolved', undefined);
  });

  it('shows course-session repair actions and starts audio regeneration', () => {
    mockUseContentManagerDetail.mockReturnValue({
      ...mockUseContentManagerDetail(),
      item: buildDetail({
        collection: 'course_sessions',
        typeLabel: 'Course Session',
        title: 'Lesson 1',
        code: 'CBT101M1L',
        identifier: 'CBT101M1L',
        access: 'premium',
        previewRoute: { pathname: '/course/session/[id]', params: { id: 'item-1' } },
        editableFields: getContentManagerEditFields('course_sessions'),
        editableValues: {
          title: 'Lesson 1',
          description: 'Course session',
          duration_minutes: 12,
        },
      }),
      repairAvailability: {
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
      },
    });

    const { getByTestId, click } = renderToDom(<ContentManagerDetailScreen />);

    click(getByTestId('content-manager-open-factory-job'));
    click(getByTestId('content-manager-regenerate-audio-only'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/job/[id]',
      params: {
        id: 'job-1',
      },
    });
    expect(mockRunRepairAction).toHaveBeenCalledWith('audio_only');
  });
});
