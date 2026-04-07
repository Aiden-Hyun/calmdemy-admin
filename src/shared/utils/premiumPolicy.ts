/**
 * @fileoverview Premium access policy enforcement for course content.
 *
 * ARCHITECTURAL ROLE:
 * This module encapsulates the business logic for determining whether a user
 * can access specific course content based on their subscription status.
 * It's the single source of truth for premium gating rules.
 *
 * PRODUCT RULE:
 * - Only course sessions are premium-gated (standalone meditations are free)
 * - A session marked as isFree=true overrides premium gating (accessible to all)
 * - Users with active subscription always have access
 *
 * DESIGN PATTERN:
 * - Policy Object Pattern: Encapsulates access control business logic
 * - Used by feature screens (CourseDetailScreen, etc.) and hooks
 *
 * CONSUMERS:
 * - Feature screens: Check if content should show "Subscribe to unlock"
 * - usePlayerBehavior hook: Prevent playback of locked content
 * - Content card components: Display lock badge on locked sessions
 */

export interface CourseSessionAccessInput {
  isFree?: boolean | null;
}

/**
 * Determines if a course session is locked behind premium subscription.
 *
 * BUSINESS LOGIC:
 * 1. If user has subscription -> always accessible (return false = not locked)
 * 2. If session marked isFree=true -> accessible to everyone
 * 3. Otherwise -> locked for free users
 *
 * PRODUCT EXAMPLE:
 * - Free session: { isFree: true } + no subscription = unlocked
 * - Premium session: { isFree: false } + no subscription = LOCKED
 * - Premium session: { isFree: false } + active subscription = unlocked
 *
 * @param session - Course session with optional isFree flag from Firestore
 * @param hasSubscription - Whether user has active premium subscription
 * @returns boolean - true if content is locked, false if accessible
 */
export function isCourseSessionLocked(
  session: CourseSessionAccessInput | null | undefined,
  hasSubscription: boolean
): boolean {
  if (hasSubscription) return false;
  return session?.isFree !== true;
}

