import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '@/theme';
import AdminLayout from '../_layout';
import { renderToDom } from '@/test-utils/domRender';

const mockUseAdminAuth = vi.fn();

function createReactNativeMock() {
  const React = require('react');

  const makeNode = (tag: string) => {
    return ({ children, testID, ...props }: any) =>
      React.createElement(tag, { 'data-testid': testID, ...props }, children);
  };

  return {
    View: makeNode('div'),
    Text: makeNode('span'),
    ActivityIndicator: ({ testID }: any) =>
      React.createElement('div', { 'data-testid': testID || 'activity-indicator' }, 'loading'),
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
  };
}

vi.mock('react-native', () => createReactNativeMock());

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,
}));

function StackMock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

StackMock.Screen = ({ name }: { name: string }) => (
  <div data-testid={`screen-${name}`}>{name}</div>
);

vi.mock('expo-router', () => ({
  Stack: StackMock,
  Redirect: ({ href }: { href: string }) => <div>{`redirect:${href}`}</div>,
  useRouter: () => ({
    back: vi.fn(),
  }),
}));

vi.mock('@core/providers/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme,
    isDark: false,
  }),
}));

vi.mock('@features/admin/hooks/useAdminAuth', () => ({
  useAdminAuth: () => mockUseAdminAuth(),
}));

describe('AdminLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state while admin access is being checked', () => {
    mockUseAdminAuth.mockReturnValue({
      isAdmin: false,
      isLoading: true,
    });

    const { getByText } = renderToDom(<AdminLayout />);
    expect(getByText('Checking access...')).toBeTruthy();
  });

  it('redirects non-admin users', () => {
    mockUseAdminAuth.mockReturnValue({
      isAdmin: false,
      isLoading: false,
    });

    const { getByText } = renderToDom(<AdminLayout />);
    expect(getByText('redirect:/')).toBeTruthy();
  });

  it('registers content manager and reports routes for admins', () => {
    mockUseAdminAuth.mockReturnValue({
      isAdmin: true,
      isLoading: false,
    });

    const { getByTestId } = renderToDom(<AdminLayout />);
    expect(getByTestId('screen-index')).toBeTruthy();
    expect(getByTestId('screen-content/index')).toBeTruthy();
    expect(getByTestId('screen-content/reports')).toBeTruthy();
    expect(getByTestId('screen-content/[collection]/[id]')).toBeTruthy();
  });
});
