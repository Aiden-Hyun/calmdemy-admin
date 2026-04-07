import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firebase Auth functions (must be before imports)
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: {
    credential: vi.fn(),
  },
  GoogleAuthProvider: {
    credential: vi.fn(),
  },
  OAuthProvider: vi.fn(function() {
    return {
      credential: vi.fn(() => ({ provider: 'apple.com' })),
    };
  }),
  linkWithCredential: vi.fn(),
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
    hasPlayServices: vi.fn(),
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

// Mock AppleAuthentication
vi.mock('expo-apple-authentication', () => ({
  signInAsync: vi.fn(),
  AppleAuthenticationScope: {
    FULL_NAME: 'full_name',
    EMAIL: 'email',
  },
}));

// Mock helpers
vi.mock('@core/providers/contexts/auth/helpers', () => ({
  isAppleSignInCancelled: vi.fn(),
  isGoogleSignInCancelled: vi.fn(),
  logAuthDebug: vi.fn(),
}));

import {
  AuthCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  linkWithCredential,
  signInWithCredential,
  User,
} from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { createCredentialActions } from '../credentialActions';
import { CredentialCollisionError } from '@core/providers/contexts/auth/types';
import {
  isAppleSignInCancelled,
  isGoogleSignInCancelled,
} from '@core/providers/contexts/auth/helpers';

describe('credentialActions', () => {
  let credentialActions: any;
  const mockRequireAuthenticatedUser = vi.fn();
  const mockRequireAnonymousUser = vi.fn();

  const mockUser = {
    uid: 'test-uid',
    email: 'test@example.com',
    isAnonymous: false,
    providerData: [{ providerId: 'password' }],
  } as unknown as User;

  const mockAnonymousUser = {
    uid: 'anon-uid',
    email: null,
    isAnonymous: true,
    providerData: [],
  } as unknown as User;

  const mockGoogleCredential = { provider: 'google.com' } as unknown as AuthCredential;
  const mockAppleCredential = { provider: 'apple.com' } as unknown as AuthCredential;
  const mockEmailCredential = { provider: 'password' } as unknown as AuthCredential;

  beforeEach(() => {
    vi.clearAllMocks();
    credentialActions = createCredentialActions({
      isAppleSignInAvailable: true,
      requireAuthenticatedUser: mockRequireAuthenticatedUser,
      requireAnonymousUser: mockRequireAnonymousUser,
    });
  });

  describe('getGoogleCredential', () => {
    it('should return Google credential on successful sign-in', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: 'google-id-token' },
      } as any);
      vi.mocked(GoogleAuthProvider.credential).mockReturnValue(mockGoogleCredential);

      const credential = await credentialActions.getGoogleCredential();

      expect(GoogleSignin.hasPlayServices).toHaveBeenCalled();
      expect(GoogleSignin.signIn).toHaveBeenCalled();
      expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('google-id-token');
      expect(credential).toBe(mockGoogleCredential);
    });

    it('should return null when user cancels Google sign-in', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      const cancelError = new Error('User cancelled');
      (cancelError as any).code = 'SIGN_IN_CANCELLED';
      vi.mocked(GoogleSignin.signIn).mockRejectedValue(cancelError);
      vi.mocked(isGoogleSignInCancelled).mockReturnValue(true);

      const credential = await credentialActions.getGoogleCredential();

      expect(credential).toBeNull();
    });

    it('should return null when idToken is missing from response', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: null },
      } as any);

      const credential = await credentialActions.getGoogleCredential();

      expect(credential).toBeNull();
    });

    it('should propagate non-cancellation errors', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      const networkError = new Error('Network error');
      (networkError as any).code = 'NETWORK_ERROR';
      vi.mocked(GoogleSignin.signIn).mockRejectedValue(networkError);
      vi.mocked(isGoogleSignInCancelled).mockReturnValue(false);

      await expect(credentialActions.getGoogleCredential()).rejects.toThrow(networkError);
    });
  });

  describe('getAppleCredential', () => {
    it('should return Apple credential on successful sign-in', async () => {
      const appleResponse = {
        identityToken: 'apple-id-token',
        email: 'user@apple.com',
      };
      vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue(appleResponse as any);

      const credential = await credentialActions.getAppleCredential();

      expect(AppleAuthentication.signInAsync).toHaveBeenCalled();
      expect(credential).toBeDefined();
    });

    it('should return null when user cancels Apple sign-in', async () => {
      const cancelError = new Error('User cancelled');
      (cancelError as any).code = 'ERR_CANCELED';
      vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue(cancelError);
      vi.mocked(isAppleSignInCancelled).mockReturnValue(true);

      const credential = await credentialActions.getAppleCredential();

      expect(credential).toBeNull();
    });

    it('should return null when identityToken is missing from response', async () => {
      vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
        identityToken: null,
      } as any);

      const credential = await credentialActions.getAppleCredential();

      expect(credential).toBeNull();
    });

    it('should throw error when Apple Sign-In is not available', async () => {
      credentialActions = createCredentialActions({
        isAppleSignInAvailable: false,
        requireAuthenticatedUser: mockRequireAuthenticatedUser,
        requireAnonymousUser: mockRequireAnonymousUser,
      });

      await expect(credentialActions.getAppleCredential()).rejects.toThrow(
        'Apple Sign In is not available on this device'
      );
    });

    it('should propagate non-cancellation errors', async () => {
      const error = new Error('Authentication failed');
      (error as any).code = 'ERR_REQUEST_UNKNOWN';
      vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue(error);
      vi.mocked(isAppleSignInCancelled).mockReturnValue(false);

      await expect(credentialActions.getAppleCredential()).rejects.toThrow(error);
    });
  });

  describe('linkAnonymousAccount', () => {
    it('should link credential to anonymous user', async () => {
      mockRequireAnonymousUser.mockReturnValue(mockAnonymousUser);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);

      await credentialActions.linkAnonymousAccount(mockGoogleCredential);

      expect(mockRequireAnonymousUser).toHaveBeenCalled();
      expect(linkWithCredential).toHaveBeenCalledWith(mockAnonymousUser, mockGoogleCredential);
    });

    it('should require anonymous user', async () => {
      mockRequireAnonymousUser.mockImplementation(() => {
        throw new Error('User is not anonymous');
      });

      await expect(
        credentialActions.linkAnonymousAccount(mockGoogleCredential)
      ).rejects.toThrow('User is not anonymous');
    });

    it('should propagate linkWithCredential errors', async () => {
      mockRequireAnonymousUser.mockReturnValue(mockAnonymousUser);
      const error = new Error('Link failed');
      vi.mocked(linkWithCredential).mockRejectedValue(error);

      await expect(
        credentialActions.linkAnonymousAccount(mockGoogleCredential)
      ).rejects.toThrow(error);
    });
  });

  describe('upgradeAnonymousWithGoogle', () => {
    beforeEach(() => {
      mockRequireAnonymousUser.mockReturnValue(mockAnonymousUser);
    });

    it('should upgrade anonymous user with Google credential', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: 'google-id-token' },
      } as any);
      vi.mocked(GoogleAuthProvider.credential).mockReturnValue(mockGoogleCredential);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);

      await credentialActions.upgradeAnonymousWithGoogle();

      expect(GoogleSignin.signIn).toHaveBeenCalled();
      expect(linkWithCredential).toHaveBeenCalledWith(mockAnonymousUser, mockGoogleCredential);
    });

    it('should throw error when user cancels Google sign-in', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      const cancelError = new Error('User cancelled');
      (cancelError as any).code = 'SIGN_IN_CANCELLED';
      vi.mocked(GoogleSignin.signIn).mockRejectedValue(cancelError);
      vi.mocked(isGoogleSignInCancelled).mockReturnValue(true);

      await expect(credentialActions.upgradeAnonymousWithGoogle()).rejects.toThrow(
        'User cancelled'
      );
    });

    it('should handle credential collision (account-exists-with-different-credential)', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: 'google-id-token' },
      } as any);
      vi.mocked(GoogleAuthProvider.credential).mockReturnValue(mockGoogleCredential);

      const collisionError = new Error('Credential already in use');
      (collisionError as any).code = 'auth/credential-already-in-use';
      vi.mocked(linkWithCredential).mockRejectedValue(collisionError);

      vi.mocked(GoogleSignin.getCurrentUser).mockResolvedValue({
        user: { email: 'existing@example.com' },
      } as any);

      await expect(credentialActions.upgradeAnonymousWithGoogle()).rejects.toBeInstanceOf(
        CredentialCollisionError
      );
    });

    it('should propagate non-collision errors during link', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: 'google-id-token' },
      } as any);
      vi.mocked(GoogleAuthProvider.credential).mockReturnValue(mockGoogleCredential);

      const linkError = new Error('Network error during link');
      (linkError as any).code = 'NETWORK_ERROR';
      vi.mocked(linkWithCredential).mockRejectedValue(linkError);

      await expect(credentialActions.upgradeAnonymousWithGoogle()).rejects.toThrow(linkError);
    });

    it('should require anonymous user', async () => {
      mockRequireAnonymousUser.mockImplementation(() => {
        throw new Error('User is not anonymous');
      });

      await expect(credentialActions.upgradeAnonymousWithGoogle()).rejects.toThrow(
        'User is not anonymous'
      );
    });
  });

  describe('upgradeAnonymousWithApple', () => {
    beforeEach(() => {
      mockRequireAnonymousUser.mockReturnValue(mockAnonymousUser);
    });

    it('should upgrade anonymous user with Apple credential', async () => {
      const appleResponse = {
        identityToken: 'apple-id-token',
        email: 'user@apple.com',
      };
      vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue(appleResponse as any);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);

      await credentialActions.upgradeAnonymousWithApple();

      expect(AppleAuthentication.signInAsync).toHaveBeenCalled();
      expect(linkWithCredential).toHaveBeenCalled();
    });

    it('should throw error when user cancels Apple sign-in', async () => {
      const cancelError = new Error('User cancelled');
      (cancelError as any).code = 'ERR_CANCELED';
      vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue(cancelError);
      vi.mocked(isAppleSignInCancelled).mockReturnValue(true);

      await expect(credentialActions.upgradeAnonymousWithApple()).rejects.toThrow(
        'User cancelled'
      );
    });

    it('should handle credential collision', async () => {
      const appleResponse = {
        identityToken: 'apple-id-token',
        email: 'user@apple.com',
      };
      vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue(appleResponse as any);

      const collisionError = new Error('Credential already in use');
      (collisionError as any).code = 'auth/credential-already-in-use';
      vi.mocked(linkWithCredential).mockRejectedValue(collisionError);

      await expect(credentialActions.upgradeAnonymousWithApple()).rejects.toBeInstanceOf(
        CredentialCollisionError
      );
    });

    it('should throw error when Apple Sign-In is not available', async () => {
      credentialActions = createCredentialActions({
        isAppleSignInAvailable: false,
        requireAuthenticatedUser: mockRequireAuthenticatedUser,
        requireAnonymousUser: mockRequireAnonymousUser,
      });

      await expect(credentialActions.upgradeAnonymousWithApple()).rejects.toThrow(
        'Apple Sign In is not available on this device'
      );
    });
  });

  describe('upgradeAnonymousWithEmail', () => {
    beforeEach(() => {
      mockRequireAnonymousUser.mockReturnValue(mockAnonymousUser);
    });

    it('should upgrade anonymous user with email/password', async () => {
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockEmailCredential);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);

      await credentialActions.upgradeAnonymousWithEmail('test@example.com', 'password123');

      expect(EmailAuthProvider.credential).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(linkWithCredential).toHaveBeenCalledWith(mockAnonymousUser, mockEmailCredential);
    });

    it('should handle email collision', async () => {
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockEmailCredential);

      const collisionError = new Error('Email already in use');
      (collisionError as any).code = 'auth/email-already-in-use';
      vi.mocked(linkWithCredential).mockRejectedValue(collisionError);

      await expect(
        credentialActions.upgradeAnonymousWithEmail('existing@example.com', 'password123')
      ).rejects.toBeInstanceOf(CredentialCollisionError);
    });

    it('should require anonymous user', async () => {
      mockRequireAnonymousUser.mockImplementation(() => {
        throw new Error('User is not anonymous');
      });

      await expect(
        credentialActions.upgradeAnonymousWithEmail('test@example.com', 'password123')
      ).rejects.toThrow('User is not anonymous');
    });
  });

  describe('signInWithPendingCredential', () => {
    it('should sign in with stored pending credential', async () => {
      vi.mocked(signInWithCredential).mockResolvedValue({} as any);

      await credentialActions.signInWithPendingCredential(mockGoogleCredential);

      expect(signInWithCredential).toHaveBeenCalledWith(expect.any(Object), mockGoogleCredential);
    });

    it('should propagate sign-in errors', async () => {
      const error = new Error('Sign-in failed');
      vi.mocked(signInWithCredential).mockRejectedValue(error);

      await expect(credentialActions.signInWithPendingCredential(mockGoogleCredential)).rejects.toThrow(
        error
      );
    });
  });

  describe('linkProvider', () => {
    beforeEach(() => {
      mockRequireAuthenticatedUser.mockReturnValue(mockUser);
    });

    it('should link Google provider to authenticated user', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: 'google-id-token' },
      } as any);
      vi.mocked(GoogleAuthProvider.credential).mockReturnValue(mockGoogleCredential);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);
      vi.mocked(GoogleSignin.getCurrentUser).mockResolvedValue({
        user: { email: 'user@google.com' },
      } as any);

      await credentialActions.linkProvider('google.com');

      expect(GoogleSignin.signIn).toHaveBeenCalled();
      expect(linkWithCredential).toHaveBeenCalledWith(mockUser, mockGoogleCredential);
    });

    it('should link Apple provider to authenticated user', async () => {
      const appleResponse = {
        identityToken: 'apple-id-token',
        email: 'user@apple.com',
      };
      vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue(appleResponse as any);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);

      await credentialActions.linkProvider('apple.com');

      expect(AppleAuthentication.signInAsync).toHaveBeenCalled();
      expect(linkWithCredential).toHaveBeenCalled();
    });

    it('should link email/password provider to authenticated user', async () => {
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockEmailCredential);
      vi.mocked(linkWithCredential).mockResolvedValue({} as any);

      await credentialActions.linkProvider('password', {
        email: 'newemail@example.com',
        password: 'password123',
      });

      expect(EmailAuthProvider.credential).toHaveBeenCalledWith(
        'newemail@example.com',
        'password123'
      );
      expect(linkWithCredential).toHaveBeenCalledWith(mockUser, mockEmailCredential);
    });

    it('should return early when credential is not acquired', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: null },
      } as any);

      await credentialActions.linkProvider('google.com');

      expect(linkWithCredential).not.toHaveBeenCalled();
    });

    it('should handle credential collision', async () => {
      vi.mocked(GoogleSignin.hasPlayServices).mockResolvedValue(true as any);
      vi.mocked(GoogleSignin.signIn).mockResolvedValue({
        data: { idToken: 'google-id-token' },
      } as any);
      vi.mocked(GoogleAuthProvider.credential).mockReturnValue(mockGoogleCredential);

      const collisionError = new Error('Credential already in use');
      (collisionError as any).code = 'auth/credential-already-in-use';
      vi.mocked(linkWithCredential).mockRejectedValue(collisionError);

      vi.mocked(GoogleSignin.getCurrentUser).mockResolvedValue({
        user: { email: 'existing@example.com' },
      } as any);

      await expect(credentialActions.linkProvider('google.com')).rejects.toBeInstanceOf(
        CredentialCollisionError
      );
    });

    it('should require authenticated user', async () => {
      mockRequireAuthenticatedUser.mockImplementation(() => {
        throw new Error('Not authenticated');
      });

      await expect(credentialActions.linkProvider('google.com')).rejects.toThrow(
        'Not authenticated'
      );
    });
  });
});
