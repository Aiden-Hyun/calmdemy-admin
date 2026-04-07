/**
 * Firestore Service Barrel Export - Unified Data Access Layer
 *
 * ARCHITECTURAL ROLE:
 * Acts as a Facade barrel export that centralizes all Firestore repository interfaces.
 * Enables a single import point for components/services needing Firestore data access
 * without creating circular dependencies or excessive import paths.
 *
 * DESIGN PATTERNS:
 * - Barrel/Wildcard Export: Re-exports all repositories under one convenient import
 * - Repository Pattern: Each re-exported module implements repository pattern for specific domain
 *   (meditate, sleep, music, etc.), abstracting Firestore query logic
 * - Facade: Simplifies import statements for consumers; they use 'firestoreService' instead
 *   of importing individual repositories
 *
 * CONSUMERS:
 * - Feature-level hooks and components accessing domain data
 * - Service layers orchestrating cross-domain queries
 * - Redux/state management if using async thunks
 *
 * KEY PRINCIPLE:
 * Each exported module (meditateRepository, sleepRepository, etc.) should handle its own
 * Firestore queries and mutations, keeping domain logic separate and testable.
 */

// Compatibility barrel: re-export feature and shared repositories

export * from '../features/meditate/data/meditateRepository';
export * from '../features/sleep/data/sleepRepository';
export * from '../features/music/data/musicRepository';
export * from '../features/home/data/homeRepository';
export * from '../features/profile/data/profileRepository';
export * from '../shared/data/content';
