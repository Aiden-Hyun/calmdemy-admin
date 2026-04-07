import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firebase Auth functions (must be before imports)
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: {
    credential: vi.fn(),
  },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  unlink: vi.fn(),
  updateEmail: vi.fn(),
  getAuth: vi.fn(() => ({})),
}));

// Mock Firebase
vi.mock('@/firebase', () => ({
  auth: {},
}));

// Mock AsyncStorage
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: vi.fn(),
    multiRemove: vi.fn(),
  },
}));

// Mock GoogleSignin
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    signOut: vi.fn(),
  },
}));

// Mock profile repository
vi.mock('@features/profile/data/profileRepository', () => ({
  deleteUserAccount: vi.fn(),
}));

// Mock download service
vi.mock('@/services/downloadService', () => ({
  deleteAllDownloads: vi.fn(),
}));

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  unlink,
  updateEmail,
  User,
  AuthCredential,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { createAccountActions } from '../accountActions';
import { deleteUserAccount } from '@features/profile/data/profileRepository';
import { deleteAllDownloads } from '@/services/downloadService';

describe('accountActions', () => {
  let accountActions: any;
  const mockGetCurrentUser = vi.fn();
  const mockRequireAuthenticatedUser = vi.fn();
  const mockGetGoogleCredential = vi.fn();
  const mockGetAppleCredential = vi.fn();

  const mockUser = {
    uid: 'test-uid',
    email: 'test@example.com',
    isAnonymous: false,
    providerData: [
      { providerId: 'password' },
      { providerId: 'google.com' },
    ],
    delete: vi.fn(),
  } as unknown as User;

  const mockAnonymousUser = {
    uid: 'anon-uid',
    email: null,
    isAnonymous: true,
    providerData: [],
    delete: vi.fn(),
  } as unknown as User;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockReturnValue(mockUser);
    mockRequireAuthenticatedUser.mockReturnValue(mockUser);
    accountActions = createAccountActions({
      getCurrentUser: mockGetCurrentUser,
      requireAuthenticatedUser: mockRequireAuthenticatedUser,
      getGoogleCredential: mockGetGoogleCredential,
      getAppleCredential: mockGetAppleCredential,
    });
  });

  describe('unlinkProvider', () => {
    it('should unlink a provider from the user account', async () => {
      vi.mocked(unlink).mockResolvedValue({} as any);
      const userWithMultipleProviders = {
        ...mockUser,
        providerData: [
          { providerId: 'password' },
          { providerId: 'google.com' },
        ],
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithMultipleProviders as any);

      await accountActions.unlinkProvider('google.com');

      expect(unlink).toHaveBeenCalledWith(userWithMultipleProviders, 'google.com');
    });

    it('should throw error when trying to unlink the only provider', async () => {
      const userWithSingleProvider = {
        ...mockUser,
        providerData: [{ providerId: 'password' }],
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithSingleProvider as any);

      await expect(accountActions.unlinkProvider('password')).rejects.toThrow(
        'Cannot remove the last sign-in method'
      );

      expect(unlink).not.toHaveBeenCalled();
    });

    it('should require an authenticated user', async () => {
      mockRequireAuthenticatedUser.mockImplementation(() => {
        throw new Error('Not authenticated');
      });

      await expect(accountActions.unlinkProvider('google.com')).rejects.toThrow(
        'Not authenticated'
      );
    });
  });

  describe('changeEmail', () => {
    it('should change email after reauthentication', async () => {
      const mockCredential = { provider: 'password' } as unknown as AuthCredential;
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);
      vi.mocked(updateEmail).mockResolvedValue({} as any);

      await accountActions.changeEmail('newemail@example.com', 'password123');

      expect(EmailAuthProvider.credential).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockUser, mockCredential);
      expect(updateEmail).toHaveBeenCalledWith(mockUser, 'newemail@example.com');
    });

    it('should throw error when reauthentication fails', async () => {
      const mockCredential = { provider: 'password' } as unknown as AuthCredential;
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockCredential);
      const error = new Error('Wrong password');
      (error as any).code = 'auth/wrong-password';
      vi.mocked(reauthenticateWithCredential).mockRejectedValue(error);

      await expect(accountActions.changeEmail('newemail@example.com', 'wrongpassword')).rejects.toThrow(error);
      expect(updateEmail).not.toHaveBeenCalled();
    });

    it('should require an authenticated user', async () => {
      mockRequireAuthenticatedUser.mockImplementation(() => {
        throw new Error('Not authenticated');
      });

      await expect(
        accountActions.changeEmail('newemail@example.com', 'password123')
      ).rejects.toThrow('Not authenticated');
    });

    it('should throw error when user has no email', async () => {
      const userWithoutEmail = {
        ...mockUser,
        email: null,
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithoutEmail as any);

      await expect(
        accountActions.changeEmail('newemail@example.com', 'password123')
      ).rejects.toThrow('No user with email is currently signed in');
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email', async () => {
      vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);

      await accountActions.sendPasswordReset('test@example.com');

      expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.any(Object), 'test@example.com');
    });

    it('should propagate Firebase errors', async () => {
      const error = new Error('User not found');
      (error as any).code = 'auth/user-not-found';
      vi.mocked(sendPasswordResetEmail).mockRejectedValue(error);

      await expect(accountActions.sendPasswordReset('nonexistent@example.com')).rejects.toThrow(error);
    });
  });

  describe('getLinkedProviders', () => {
    it('should return list of linked provider IDs', () => {
      const providers = accountActions.getLinkedProviders();

      expect(providers).toEqual(['password', 'google.com']);
    });

    it('should return empty array when user is not authenticated', () => {
      mockGetCurrentUser.mockReturnValue(null);

      const providers = accountActions.getLinkedProviders();

      expect(providers).toEqual([]);
    });

    it('should return only the available providers for a user', () => {
      const userWithApple = {
        ...mockUser,
        providerData: [
          { providerId: 'apple.com' },
          { providerId: 'password' },
        ],
      };
      mockGetCurrentUser.mockReturnValue(userWithApple as any);

      const providers = accountActions.getLinkedProviders();

      expect(providers).toEqual(['apple.com', 'password']);
    });
  });

  describe('deleteAccount', () => {
    beforeEach(() => {
      vi.mocked(deleteUserAccount).mockResolvedValue(undefined);
      vi.mocked(deleteAllDownloads).mockResolvedValue(undefined);
      vi.mocked(GoogleSignin.signOut).mockResolvedValue(undefined);
      vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue(['@theme_mode', '@cache', '@token']);
      vi.mocked(AsyncStorage.multiRemove).mockResolvedValue(undefined);
    });

    it('should delete account with email provider reauthentication', async () => {
      const mockCredential = { provider: 'password' } as unknown as AuthCredential;
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);

      await accountActions.deleteAccount('password123');

      expect(EmailAuthProvider.credential).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(reauthenticateWithCredential).toHaveBeenCalled();
      expect(deleteUserAccount).toHaveBeenCalledWith('test-uid');
      expect(deleteAllDownloads).toHaveBeenCalled();
      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['@cache', '@token']);
      expect(GoogleSignin.signOut).toHaveBeenCalled();
      expect(mockUser.delete).toHaveBeenCalled();
    });

    it('should delete account with Google provider reauthentication', async () => {
      const userWithGoogleOnly = {
        ...mockUser,
        email: null,
        providerData: [{ providerId: 'google.com' }],
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithGoogleOnly as any);

      const mockGoogleCredential = { provider: 'google.com' } as unknown as AuthCredential;
      mockGetGoogleCredential.mockResolvedValue(mockGoogleCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);

      await accountActions.deleteAccount();

      expect(mockGetGoogleCredential).toHaveBeenCalled();
      expect(reauthenticateWithCredential).toHaveBeenCalled();
      expect(deleteUserAccount).toHaveBeenCalled();
    });

    it('should delete account with Apple provider reauthentication', async () => {
      const userWithAppleOnly = {
        ...mockUser,
        email: null,
        providerData: [{ providerId: 'apple.com' }],
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithAppleOnly as any);

      const mockAppleCredential = { provider: 'apple.com' } as unknown as AuthCredential;
      mockGetAppleCredential.mockResolvedValue(mockAppleCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);

      await accountActions.deleteAccount();

      expect(mockGetAppleCredential).toHaveBeenCalled();
      expect(reauthenticateWithCredential).toHaveBeenCalled();
      expect(deleteUserAccount).toHaveBeenCalled();
    });

    it('should preserve @theme_mode in AsyncStorage during deletion', async () => {
      const mockCredential = { provider: 'password' } as unknown as AuthCredential;
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);
      vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue(['@theme_mode', '@cache', '@token']);

      await accountActions.deleteAccount('password123');

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['@cache', '@token']);
      expect(AsyncStorage.multiRemove).not.toHaveBeenCalledWith(
        expect.arrayContaining(['@theme_mode'])
      );
    });

    it('should handle reauthentication failure with requires-recent-login', async () => {
      const error = new Error('Please sign out and sign back in');
      (error as any).code = 'auth/requires-recent-login';
      vi.mocked(EmailAuthProvider.credential).mockReturnValue({} as any);
      vi.mocked(reauthenticateWithCredential).mockRejectedValue(error);

      await expect(accountActions.deleteAccount('password123')).rejects.toThrow(
        'Please sign out and sign back in, then try again.'
      );
    });

    it('should handle reauthentication failure with wrong-password', async () => {
      const error = new Error('Wrong password');
      (error as any).code = 'auth/wrong-password';
      vi.mocked(EmailAuthProvider.credential).mockReturnValue({} as any);
      vi.mocked(reauthenticateWithCredential).mockRejectedValue(error);

      await expect(accountActions.deleteAccount('wrongpassword')).rejects.toThrow(
        'Incorrect password. Please try again.'
      );
    });

    it('should handle missing Google credential during deletion', async () => {
      const userWithGoogleOnly = {
        ...mockUser,
        email: null,
        providerData: [{ providerId: 'google.com' }],
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithGoogleOnly as any);
      mockGetGoogleCredential.mockResolvedValue(null);

      await expect(accountActions.deleteAccount()).rejects.toThrow(
        'Failed to get Google token for re-authentication'
      );
    });

    it('should handle missing Apple credential during deletion', async () => {
      const userWithAppleOnly = {
        ...mockUser,
        email: null,
        providerData: [{ providerId: 'apple.com' }],
      };
      mockRequireAuthenticatedUser.mockReturnValue(userWithAppleOnly as any);
      mockGetAppleCredential.mockResolvedValue(null);

      await expect(accountActions.deleteAccount()).rejects.toThrow(
        'Failed to get Apple token for re-authentication'
      );
    });

    it('should handle Google sign-out failure gracefully', async () => {
      const mockCredential = { provider: 'password' } as unknown as AuthCredential;
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);
      vi.mocked(GoogleSignin.signOut).mockRejectedValue(new Error('Not signed in'));

      await accountActions.deleteAccount('password123');

      // Should not throw, but should still delete user
      expect(deleteUserAccount).toHaveBeenCalled();
      expect(mockUser.delete).toHaveBeenCalled();
    });

    it('should require authenticated user for deletion', async () => {
      mockRequireAuthenticatedUser.mockImplementation(() => {
        throw new Error('Not authenticated');
      });

      await expect(accountActions.deleteAccount('password123')).rejects.toThrow('Not authenticated');
    });

    it('should handle AsyncStorage failure during cleanup', async () => {
      const mockCredential = { provider: 'password' } as unknown as AuthCredential;
      vi.mocked(EmailAuthProvider.credential).mockReturnValue(mockCredential);
      vi.mocked(reauthenticateWithCredential).mockResolvedValue({} as any);
      const storageError = new Error('Storage error');
      vi.mocked(AsyncStorage.multiRemove).mockRejectedValue(storageError);

      await expect(accountActions.deleteAccount('password123')).rejects.toThrow(storageError);

      // Should have attempted other cleanup steps
      expect(deleteUserAccount).toHaveBeenCalled();
      expect(deleteAllDownloads).toHaveBeenCalled();
    });
  });
});
