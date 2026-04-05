import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '@/theme';
import ContentManagerReportsScreen from '../screens/ContentManagerReportsScreen';
import { renderToDom } from '@/test-utils/domRender';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockSetQuery = vi.fn();
const mockSetStatus = vi.fn();
const mockSetType = vi.fn();
const mockSetCategory = vi.fn();
const mockUpdateStatus = vi.fn();
const mockUseContentManagerReportsInbox = vi.fn();

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
    FlatList: ({
      data = [],
      renderItem,
      ListHeaderComponent,
      ListEmptyComponent,
      testID,
      ItemSeparatorComponent,
    }: any) =>
      React.createElement(
        'div',
        { 'data-testid': testID },
        ListHeaderComponent,
        data.length === 0
          ? ListEmptyComponent
          : data.map((item: any, index: number) =>
              React.createElement(
                React.Fragment,
                { key: `${item?.id || index}` },
                renderItem({ item, index }),
                ItemSeparatorComponent ? React.createElement(ItemSeparatorComponent) : null
              )
            )
      ),
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
}));

vi.mock('@core/providers/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme,
    isDark: false,
  }),
}));

vi.mock('../hooks/useContentManager', () => ({
  useContentManagerReportsInbox: () => mockUseContentManagerReportsInbox(),
}));

describe('ContentManagerReportsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContentManagerReportsInbox.mockReturnValue({
      filteredReports: [],
      filters: {
        query: '',
        status: 'open',
        type: 'all',
        category: 'all',
      },
      openCount: 0,
      isLoading: false,
      isRefreshing: false,
      updatingReportId: null,
      error: null,
      message: null,
      refresh: mockRefresh,
      setQuery: mockSetQuery,
      setStatus: mockSetStatus,
      setType: mockSetType,
      setCategory: mockSetCategory,
      updateStatus: mockUpdateStatus,
    });
  });

  it('shows the empty state when there are no matching reports', () => {
    const { getByText } = renderToDom(<ContentManagerReportsScreen />);

    expect(getByText('Reports Inbox')).toBeTruthy();
    expect(getByText('No matching reports')).toBeTruthy();
  });

  it('renders supported and unsupported reports correctly', () => {
    mockUseContentManagerReportsInbox.mockReturnValue({
      ...mockUseContentManagerReportsInbox(),
      filteredReports: [
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
        {
          id: 'report-2',
          contentId: 'sound-1',
          contentType: 'sound',
          category: 'other',
          description: 'Loop clicks every few seconds.',
          status: 'open',
          isSupported: false,
        },
      ],
      openCount: 2,
    });

    const { getByText, getByTestId, queryByTestId, click } = renderToDom(
      <ContentManagerReportsScreen />
    );

    expect(getByText('Calm Breath')).toBeTruthy();
    expect(getByText('Unsupported')).toBeTruthy();
    expect(getByTestId('content-manager-report-open-report-1')).toBeTruthy();
    expect(queryByTestId('content-manager-report-open-report-2')).toBeNull();

    click(getByTestId('content-manager-report-open-report-1'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/content/[collection]/[id]',
      params: {
        collection: 'guided_meditations',
        id: 'item-1',
        reportId: 'report-1',
      },
    });
  });

  it('resolves and reopens reports from the inbox', () => {
    mockUseContentManagerReportsInbox.mockReturnValue({
      ...mockUseContentManagerReportsInbox(),
      filteredReports: [
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
        {
          id: 'report-2',
          contentId: 'sound-1',
          contentType: 'sound',
          category: 'other',
          description: 'Loop clicks every few seconds.',
          status: 'resolved',
          resolutionNote: 'Archived source asset.',
          resolvedByEmail: 'admin@calmdemy.app',
          isSupported: false,
        },
      ],
      openCount: 1,
    });

    const { getByTestId, change, click } = renderToDom(<ContentManagerReportsScreen />);

    change(getByTestId('content-manager-report-note-report-1'), 'Fixed in latest upload.');
    click(getByTestId('content-manager-report-resolve-report-1'));
    click(getByTestId('content-manager-report-reopen-report-2'));

    expect(mockUpdateStatus).toHaveBeenNthCalledWith(
      1,
      'report-1',
      'resolved',
      undefined
    );
    expect(mockUpdateStatus).toHaveBeenNthCalledWith(2, 'report-2', 'open');
  });
});
