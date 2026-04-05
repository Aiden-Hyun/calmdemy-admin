import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { env } from './core/config/env';

// Firebase config from environment variables
const firebaseConfig = {
  apiKey: env.firebase.apiKey,
  authDomain: env.firebase.authDomain,
  projectId: env.firebase.projectId,
  storageBucket: env.firebase.storageBucket,
  messagingSenderId: env.firebase.messagingSenderId,
  appId: env.firebase.appId,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth once; fall back to getAuth when already initialized.
export const auth = (() => {
  try {
    return initializeAuth(app);
  } catch {
    return getAuth(app);
  }
})();

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Functions
export const functions = getFunctions(app, 'northamerica-northeast1');

// Initialize Storage
export const storage = getStorage(app);

// Helper to get current user ID
export const getCurrentUserId = (): string | null => {
  return auth.currentUser?.uid ?? null;
};

// Helper to check if user is authenticated
export const isAuthenticated = (): boolean => {
  return auth.currentUser !== null;
};
