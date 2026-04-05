import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react-native';
import { ProtectedRoute } from '../ProtectedRoute';

// Mock expo-router
vi.mock('expo-router', () => ({
  router: {
    replace: vi.fn(),
  },
}));

// Mock AuthContext
const mockUseAuth = vi.fn();
vi.mock('@core/providers/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('ProtectedRoute', () => {
  it('should render children when user is authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', email: 'test@example.com' },
      loading: false,
    });

    const { getByText } = render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(getByText('Protected Content')).toBeTruthy();
  });

  it('should show loading when auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
    });

    const { getByText } = render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(getByText('Loading...')).toBeTruthy();
  });

  it('should redirect to login when user is not authenticated', () => {
    const { router } = require('expo-router');
    
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(router.replace).toHaveBeenCalledWith('/login');
  });
});
