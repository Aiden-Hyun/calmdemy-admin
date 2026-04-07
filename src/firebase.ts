/**
 * Firebase Service Initialization - React Native/Expo Platform
 *
 * ARCHITECTURAL ROLE:
 * Central module for initializing Firebase services across the Calmdemy app. Acts as a Facade
 * pattern that abstracts Firebase SDK complexity and provides a unified interface for Auth,
 * Firestore, Cloud Functions, and Storage initialization.
 *
 * DESIGN PATTERNS:
 * - Facade: Simplifies Firebase SDK configuration by exporting pre-initialized service instances
 * - Singleton: Each Firebase service (auth, db, functions, storage) is initialized once and reused
 * - Module-level initialization: Uses IIFE (Immediately Invoked Function Expression) for Auth
 *   to handle edge case of re-initialization attempts
 *
 * KEY DEPENDENCIES:
 * - Firebase SDK (firebase/app, firebase/auth, firebase/firestore, firebase/functions, firebase/storage)
 * - Environment configuration (env.ts) for credentials
 *
 * CONSUMERS:
 * - firestoreService.ts: Uses 'db' for Firestore queries and mutations
 * - audioService.ts: Indirectly through service layer
 * - Download/notification services: May use storage or functions
 * - Authentication flow: Uses 'auth' for user session management
 *
 * PLATFORM NOTE:
 * This is the React Native/Expo version. See firebase.web.ts for web platform variant.
 * Key difference: Uses initializeAuth() instead of getAuth() for React Native compatibility.
 */

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

/**
 * Initializes Firebase Authentication with fallback strategy.
 * IIFE pattern handles case where auth was already initialized (prevents double-init errors).
 * React Native platforms require initializeAuth(); getAuth() is fallback if already initialized.
 */
export const auth = (() => {
  try {
    return initializeAuth(app);
  } catch {
    // Firebase may throw if auth already initialized; fallback to getAuth
    return getAuth(app);
  }
})();

/**
 * Firestore database instance. Initialized once and shared across all data access layers.
 * Used by firestoreService for all Firestore operations (queries, mutations, real-time listeners).
 */
export const db = getFirestore(app);

/**
 * Cloud Functions instance. Points to 'northamerica-northeast1' region for low latency.
 * Used for server-side operations (payment processing, complex validations, etc).
 */
export const functions = getFunctions(app, 'northamerica-northeast1');

/**
 * Firebase Storage instance. Used for storing user-generated content, media files.
 * Alternative to CDN for dynamic content; provides access control via Firestore rules.
 */
export const storage = getStorage(app);

/**
 * Retrieves the current authenticated user's ID.
 * Returns null if no user is logged in (handles optional chaining gracefully).
 * Used by feature-specific repositories and service layers to scope queries by user.
 *
 * @returns User ID (UID) if authenticated, null otherwise
 */
export const getCurrentUserId = (): string | null => {
  return auth.currentUser?.uid ?? null;
};

/**
 * Synchronous check for authentication state.
 * Useful for conditional navigation, feature flags, and permission guards.
 * NOTE: Does not guarantee token validity; check auth.currentUser.getIdTokenResult() for fresh claims.
 *
 * @returns true if user session exists, false otherwise
 */
export const isAuthenticated = (): boolean => {
  return auth.currentUser !== null;
};
