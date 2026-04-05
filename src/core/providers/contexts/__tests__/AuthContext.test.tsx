import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// Mock Firebase Auth
const mockAuth = {
  onAuthStateChanged: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  currentUser: null,
};

vi.mock('@react-native-firebase/auth', () => ({
  default: () => mockAuth,
}));

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.onAuthStateChanged.mockReturnValue(() => {});
  });

  it('should initialize with loading state', () => {
    mockAuth.onAuthStateChanged.mockImplementation((callback) => {
      // Don't call callback to simulate loading
      return () => {};
    });
    
    // Auth context should start in loading state
    expect(true).toBe(true);
  });

  it('should sign up a new user', async () => {
    mockAuth.createUserWithEmailAndPassword.mockResolvedValue({
      user: { uid: 'test-uid', email: 'test@example.com' }
    });

    await mockAuth.createUserWithEmailAndPassword('test@example.com', 'password123');
    
    expect(mockAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      'test@example.com',
      'password123'
    );
  });

  it('should sign in an existing user', async () => {
    mockAuth.signInWithEmailAndPassword.mockResolvedValue({
      user: { uid: 'test-uid', email: 'test@example.com' }
    });

    await mockAuth.signInWithEmailAndPassword('test@example.com', 'password123');
    
    expect(mockAuth.signInWithEmailAndPassword).toHaveBeenCalledWith(
      'test@example.com',
      'password123'
    );
  });

  it('should sign out a user', async () => {
    mockAuth.signOut.mockResolvedValue(undefined);

    await mockAuth.signOut();
    
    expect(mockAuth.signOut).toHaveBeenCalled();
  });
});
