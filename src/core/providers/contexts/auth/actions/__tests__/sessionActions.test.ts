import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firebase Auth functions (must be before imports)
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  signInAnonymously: vi.fn(),
  signInWithCredential: vi.fn(),
  getAuth: vi.fn(() => ({})),
}));

// Mock Firebase
vi.mock('@/firebase', () => ({
  auth: {},
}));

// Mock GoogleSignin
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    signOut: vi.fn(),
  },
}));

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInAnonymously as firebaseSignInAnonymously,
  signInWithCredential,
  AuthCredential,
} from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { createSessionActions } from '../sessionActions';

describe('sessionActions', () => {
  let sessionActions: any;
  const mockGetGoogleCredential = vi.fn();
  const mockGetAppleCredential = vi.fn();
  const mockGoogleCredential = { provider: 'google.com' } as unknown as AuthCredential;
  const mockAppleCredential = { provider: 'apple.com' } as unknown as AuthCredential;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionActions = createSessionActions({
      getGoogleCredential: mockGetGoogleCredential,
      getAppleCredential: mockGetAppleCredential,
    });
  });

  describe('signUp', () => {
    it('should create a new user with email and password', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({} as any);

      await sessionActions.signUp(email, password);

      expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(expect.any(Object), email, password);
    });

    it('should propagate Firebase auth errors (weak password)', async () => {
      const email = 'test@example.com';
      const password = 'weak';
      const error = new Error('Password should be at least 6 characters');
      (error as any).code = 'auth/weak-password';
      vi.mocked(createUserWithEmailAndPassword).mockRejectedValue(error);

      await expect(sessionActions.signUp(email, password)).rejects.toThrow(error);
    });

    it('should propagate Firebase auth errors (email already in use)', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const error = new Error('The email address is already in use');
      (error as any).code = 'auth/email-already-in-use';
      vi.mocked(createUserWithEmailAndPassword).mockRejectedValue(error);

      await expect(sessionActions.signUp(email, password)).rejects.toThrow(error);
    });
  });

  describe('signIn', () => {
    it('should sign in an existing user with email and password', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({} as any);

      await sessionActions.signIn(email, password);

      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.any(Object), email, password);
    });

    it('should propagate invalid credentials error', async () => {
      const email = 'test@example.com';
      const password = 'wrongpassword';
      const error = new Error('Invalid login credentials');
      (error as any).code = 'auth/invalid-login-credentials';
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(error);

      await expect(sessionActions.signIn(email, password)).rejects.toThrow(error);
    });

    it('should propagate user not found error', async () => {
      const email = 'nonexistent@example.com';
      const password = 'password123';
      const error = new Error('There is no user record corresponding to this identifier');
      (error as any).code = 'auth/user-not-found';
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(error);

      await expect(sessionActions.signIn(email, password)).rejects.toThrow(error);
    });
  });

  describe('signInAnonymously', () => {
    it('should create an anonymous Firebase session', async () => {
      vi.mocked(firebaseSignInAnonymously).mockResolvedValue({} as any);

      await sessionActions.signInAnonymously();

      expect(firebaseSignInAnonymously).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should propagate errors from Firebase', async () => {
      const error = new Error('Network error');
      vi.mocked(firebaseSignInAnonymously).mockRejectedValue(error);

      await expect(sessionActions.signInAnonymously()).rejects.toThrow(error);
    });
  });

  describe('signInWithGoogle', () => {
    it('should complete Google sign-in when credential is acquired', async () => {
      mockGetGoogleCredential.mockResolvedValue(mockGoogleCredential);
      vi.mocked(signInWithCredential).mockResolvedValue({} as any);

      await sessionActions.signInWithGoogle();

      expect(mockGetGoogleCredential).toHaveBeenCalled();
      expect(signInWithCredential).toHaveBeenCalledWith(expect.any(Object), mockGoogleCredential);
    });

    it('should return early (no-op) when user cancels Google sign-in', async () => {
      mockGetGoogleCredential.mockResolvedValue(null);

      await sessionActions.signInWithGoogle();

      expect(mockGetGoogleCredential).toHaveBeenCalled();
      expect(signInWithCredential).not.toHaveBeenCalled();
    });

    it('should propagate errors from Google credential acquisition', async () => {
      const error = new Error('Google Play Services error');
      mockGetGoogleCredential.mockRejectedValue(error);

      await expect(sessionActions.signInWithGoogle()).rejects.toThrow(error);
    });

    it('should propagate errors from Firebase sign-in', async () => {
      mockGetGoogleCredential.mockResolvedValue(mockGoogleCredential);
      const error = new Error('Account creation failed');
      vi.mocked(signInWithCredential).mockRejectedValue(error);

      await expect(sessionActions.signInWithGoogle()).rejects.toThrow(error);
    });
  });

  describe('signInWithApple', () => {
    it('should complete Apple sign-in when credential is acquired', async () => {
      mockGetAppleCredential.mockResolvedValue(mockAppleCredential);
      vi.mocked(signInWithCredential).mockResolvedValue({} as any);

      await sessionActions.signInWithApple();

      expect(mockGetAppleCredential).toHaveBeenCalled();
      expect(signInWithCredential).toHaveBeenCalledWith(expect.any(Object), mockAppleCredential);
    });

    it('should return early (no-op) when user cancels Apple sign-in', async () => {
      mockGetAppleCredential.mockResolvedValue(null);

      await sessionActions.signInWithApple();

      expect(mockGetAppleCredential).toHaveBeenCalled();
      expect(signInWithCredential).not.toHaveBeenCalled();
    });

    it('should propagate errors from Apple credential acquisition', async () => {
      const error = new Error('Apple authentication failed');
      mockGetAppleCredential.mockRejectedValue(error);

      await expect(sessionActions.signInWithApple()).rejects.toThrow(error);
    });

    it('should propagate errors from Firebase sign-in', async () => {
      mockGetAppleCredential.mockResolvedValue(mockAppleCredential);
      const error = new Error('Account creation failed');
      vi.mocked(signInWithCredential).mockRejectedValue(error);

      await expect(sessionActions.signInWithApple()).rejects.toThrow(error);
    });
  });

  describe('logout', () => {
    it('should sign out from Google and Firebase', async () => {
      vi.mocked(GoogleSignin.signOut).mockResolvedValue(undefined);
      vi.mocked(signOut).mockResolvedValue(undefined);

      await sessionActions.logout();

      expect(GoogleSignin.signOut).toHaveBeenCalled();
      expect(signOut).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should still sign out from Firebase when Google sign-out fails', async () => {
      const googleError = new Error('Not signed in with Google');
      vi.mocked(GoogleSignin.signOut).mockRejectedValue(googleError);
      vi.mocked(signOut).mockResolvedValue(undefined);

      await sessionActions.logout();

      expect(GoogleSignin.signOut).toHaveBeenCalled();
      expect(signOut).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should handle Firebase sign-out errors', async () => {
      vi.mocked(GoogleSignin.signOut).mockResolvedValue(undefined);
      const firebaseError = new Error('Network error');
      vi.mocked(signOut).mockRejectedValue(firebaseError);

      await expect(sessionActions.logout()).rejects.toThrow(firebaseError);
    });

    it('should handle both Google and Firebase errors gracefully', async () => {
      const googleError = new Error('Google error');
      const firebaseError = new Error('Firebase error');
      vi.mocked(GoogleSignin.signOut).mockRejectedValue(googleError);
      vi.mocked(signOut).mockRejectedValue(firebaseError);

      // Should propagate Firebase error (the critical one)
      await expect(sessionActions.logout()).rejects.toThrow(firebaseError);

      expect(GoogleSignin.signOut).toHaveBeenCalled();
      expect(signOut).toHaveBeenCalled();
    });
  });
});
