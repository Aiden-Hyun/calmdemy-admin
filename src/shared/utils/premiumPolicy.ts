export interface CourseSessionAccessInput {
  isFree?: boolean | null;
}

/**
 * Product rule: only course sessions are premium-gated.
 * If the session is explicitly free, it remains accessible to everyone.
 */
export function isCourseSessionLocked(
  session: CourseSessionAccessInput | null | undefined,
  hasSubscription: boolean
): boolean {
  if (hasSubscription) return false;
  return session?.isFree !== true;
}

