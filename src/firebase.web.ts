/**
 * Firebase Service Initialization - Web Platform
 *
 * ARCHITECTURAL ROLE:
 * Web-specific variant of firebase.ts providing the same Facade interface as the React Native
 * version but optimized for browser environments. Enables code sharing via conditional imports
 * (e.g., import from 'firebase.ts' in web build, 'firebase.web.ts' in React Native).
 *
 * DESIGN PATTERNS:
 * - Strategy Pattern: Provides alternative initialization strategy optimized for web
 * - Facade: Same exported interface as firebase.ts, concealing platform-specific differences
 * - Singleton via getApps() guard: Checks if app already initialized (important in HMR, tests)
 *
 * KEY DIFFERENCES FROM firebase.ts (React Native):
 * - Uses getAuth() instead of initializeAuth() (web-standard approach)
 * - Uses getApps().length check instead of try/catch for initialization guard
 * - No platform-specific initialization logic needed (web SDK handles re-init gracefully)
 *
 * CONSUMERS:
 * - firestoreService: Uses 'db' for Firestore operations
 * - All service layers expecting auth, db, functions, storage exports
 * - Web-build-specific feature implementations
 *
 * PLATFORM NOTE:
 * This file is for web builds only. React Native builds use firebase.ts instead.
 * Both expose identical exports for fungibility at the type level.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

import { env } from './core/config/env';

const firebaseConfig = {
  apiKey: env.firebase.apiKey,
  authDomain: env.firebase.authDomain,
  projectId: env.firebase.projectId,
  storageBucket: env.firebase.storageBucket,
  messagingSenderId: env.firebase.messagingSenderId,
  appId: env.firebase.appId,
};

/**
 * Safe initialization guard: Check if an app instance already exists before initializing.
 * Prevents double-initialization in HMR (hot module replacement) and test environments.
 * Web SDK is more forgiving than React Native SDK about re-initialization.
 */
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Authentication service. In web, getAuth() is preferred over initializeAuth().
 * Handles user login, session management, token refresh automatically.
 */
export const auth = getAuth(app);

/**
 * Firestore database instance. Pre-initialized and ready for document queries, mutations.
 */
export const db = getFirestore(app);

/**
 * Cloud Functions reference pointing to 'northamerica-northeast1' region.
 * Used to invoke server-side cloud functions for complex operations.
 */
export const functions = getFunctions(app, 'northamerica-northeast1');

/**
 * Storage service for file uploads/downloads. Provides alternative to CDN for user content.
 */
export const storage = getStorage(app);

/**
 * Get current authenticated user's ID (UID).
 * Returns null if no user session exists.
 */
export const getCurrentUserId = (): string | null => auth.currentUser?.uid ?? null;

/**
 * Check if a user is currently authenticated.
 * Synchronous operation; does not validate token freshness.
 */
export const isAuthenticated = (): boolean => auth.currentUser !== null;
