/**
 * @fileoverview Barrel export file for shared content data repositories.
 *
 * This module serves as a public API gateway for the content data access layer, following
 * the Repository Pattern (a Data Access Object abstraction). Each exported module encapsulates
 * Firestore operations for a specific domain within the meditation app's content management.
 *
 * ARCHITECTURAL ROLE:
 * - Re-exports all content-related repository modules to simplify imports across the app
 * - Provides a single entry point for content data operations
 * - Decouples UI components from underlying Firestore implementation details
 *
 * REPOSITORIES:
 * - narratorsRepository: Manages narrator metadata with in-memory caching strategy
 * - playbackProgressRepository: Persists audio playback state (position/duration)
 * - completedContentRepository: Tracks user session completions
 * - contentRatingsRepository: Stores user ratings with toggle semantics (click = add or remove)
 * - contentReportsRepository: Records content moderation reports from users
 *
 * DESIGN PATTERN:
 * - Barrel Export Pattern: Centralizes module exports for cleaner namespace management
 * - Repository Pattern: Abstract Firestore operations through typed function interfaces
 */

export * from "./narratorsRepository";
export * from "./playbackProgressRepository";
export * from "./completedContentRepository";
export * from "./contentRatingsRepository";
export * from "./contentReportsRepository";
