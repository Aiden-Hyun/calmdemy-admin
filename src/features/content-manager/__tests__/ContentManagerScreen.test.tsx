import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '@/theme';
import ContentManagerScreen from '../screens/ContentManagerScreen';
import { renderToDom } from '@/test-utils/domRender';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockUseContentManagerCatalog = vi.fn();
const mockUseContentManagerReportsSummary = vi.fn();

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
    Image: ({ testID, ...props }: any) => React.createElement('img', { 'data-testid': testID, ...props }),
    ActivityIndicator: ({ testID }: any) =>
      React.createElement('div', { 'data-testid': testID || 'activity-indicator' }, 'loading'),
    TextInput: ({ testID, value, onChangeText, ...props }: any) =>
      React.createElement('input', {
        'data-testid': testID,
        value,
        onChange: (event: any) => onChangeText?.(event.target.value),
        ...props,
      }),
    FlatList: ({
      data = [],
      renderItem,
      ListHeaderComponent,
      ListEmptyComponent,
      ListFooterComponent,
      testID,
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
                renderItem({ item, index })
              )
            ),
        ListFooterComponent
      ),
    Pressable: ({ children, onPress, testID }: any) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': testID,
          onClick: () => onPress?.(),
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
  useContentManagerCatalog: () => mockUseContentManagerCatalog(),
  useContentManagerReportsSummary: () => mockUseContentManagerReportsSummary(),
}));

describe('ContentManagerScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseContentManagerCatalog.mockReturnValue({
      filteredItems: [],
      filters: {
        query: '',
        type: 'all',
        access: 'all',
      },
      isLoading: false,
      isRefreshing: false,
      error: null,
      refresh: mockRefresh,
      setAccess: vi.fn(),
      setQuery: vi.fn(),
      setType: vi.fn(),
    });
    mockUseContentManagerReportsSummary.mockReturnValue({
      openCount: 0,
      isLoading: false,
      refresh: vi.fn(),
    });
  });

  it('shows a loading state', () => {
    mockUseContentManagerCatalog.mockReturnValue({
      ...mockUseContentManagerCatalog(),
      isLoading: true,
    });

    const { getByText } = renderToDom(<ContentManagerScreen />);
    expect(getByText('Loading content')).toBeTruthy();
  });

  it('shows an empty state when no results match', () => {
    mockUseContentManagerCatalog.mockReturnValue({
      ...mockUseContentManagerCatalog(),
      filters: {
        query: 'missing',
        type: 'all',
        access: 'all',
      },
    });

    const { getByText } = renderToDom(<ContentManagerScreen />);
    expect(getByText('No matching content')).toBeTruthy();
  });

  it('renders results and navigates to detail on press', () => {
    mockUseContentManagerCatalog.mockReturnValue({
      ...mockUseContentManagerCatalog(),
      filteredItems: [
        {
          id: 'med-1',
          collection: 'guided_meditations',
          typeLabel: 'Guided Meditation',
          title: 'Calm Breath',
          identifier: 'med-1',
          access: 'free',
          previewRoute: { pathname: '/meditation/[id]', params: { id: 'med-1' } },
        },
      ],
    });

    const { getByText, getByTestId, click } = renderToDom(<ContentManagerScreen />);

    expect(getByText('Calm Breath')).toBeTruthy();
    click(getByTestId('content-manager-item-guided_meditations-med-1'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/admin/content/[collection]/[id]',
      params: {
        collection: 'guided_meditations',
        id: 'med-1',
      },
    });
  });

  it('refreshes when the refresh button is pressed', () => {
    const { getByTestId, click } = renderToDom(<ContentManagerScreen />);
    click(getByTestId('content-manager-refresh'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('opens the reports inbox from the hero action', () => {
    mockUseContentManagerReportsSummary.mockReturnValue({
      openCount: 3,
      isLoading: false,
      refresh: vi.fn(),
    });

    const { getByTestId, click, getByText } = renderToDom(<ContentManagerScreen />);

    expect(getByText('3 open reports')).toBeTruthy();
    click(getByTestId('content-manager-open-reports'));

    expect(mockPush).toHaveBeenCalledWith('/admin/content/reports');
  });
});
