/**
 * Utility functions for parsing course and session codes
 * 
 * Course codes: e.g., "CBT101", "ACT201"
 * Session codes: e.g., "CBT101INT", "CBT101M1L", "CBT101M1P"
 * 
 * Suffix Types:
 * - INT = Course Intro (no module number)
 * - L = Lesson
 * - P = Practice
 */

type SessionType = 'L' | 'P';

const SESSION_TYPE_MAP: Record<SessionType, string> = {
  L: 'Lesson',
  P: 'Practice',
};

/**
 * Parse a session code to extract human-readable module info
 * 
 * @param sessionCode - The session code (e.g., "CBT101M1P")
 * @param courseCode - The course code (e.g., "CBT101")
 * @returns Human-readable string (e.g., "Module 1 Practice")
 * 
 * @example
 * parseSessionCode("CBT101INT", "CBT101") // "Course Intro"
 * parseSessionCode("CBT101M1L", "CBT101") // "Module 1 Lesson"
 * parseSessionCode("CBT101M1P", "CBT101") // "Module 1 Practice"
 * parseSessionCode("ACT201M3P", "ACT201") // "Module 3 Practice"
 */
export function parseSessionCode(sessionCode: string, courseCode: string): string {
  if (!sessionCode || !courseCode) {
    return '';
  }

  // Extract the suffix after the course code
  const suffix = sessionCode.replace(courseCode, '');
  
  if (!suffix) {
    return '';
  }

  // Handle Course Intro
  if (suffix === 'INT') {
    return 'Course Intro';
  }

  // Parse module pattern: M1L, M2P, M10L, etc.
  const moduleMatch = suffix.match(/M(\d+)([LP])?$/);
  
  if (!moduleMatch) {
    // Unknown pattern - return empty or raw suffix
    return '';
  }

  const moduleNumber = moduleMatch[1];
  const typeChar = moduleMatch[2] as SessionType | undefined;

  const modulePart = `Module ${moduleNumber}`;
  const typePart = typeChar ? SESSION_TYPE_MAP[typeChar] : '';

  return [modulePart, typePart].filter(Boolean).join(' ');
}

/**
 * Format a course code for display (adds space before numbers)
 * 
 * @param courseCode - The course code (e.g., "CBT101")
 * @returns Formatted display string (e.g., "CBT 101")
 * 
 * @example
 * formatCourseCode("CBT101") // "CBT 101"
 * formatCourseCode("ACT201") // "ACT 201"
 */
export function formatCourseCode(courseCode: string): string {
  if (!courseCode) {
    return '';
  }
  
  // Insert space before the first digit
  return courseCode.replace(/(\D+)(\d+)/, '$1 $2');
}

/**
 * Build the complete meta info string for a session
 * 
 * @param sessionCode - The session code (e.g., "CBT101M1P")
 * @param courseCode - The course code (e.g., "CBT101")
 * @returns Complete meta string (e.g., "CBT 101 · Module 1 Practice")
 */
export function buildSessionMetaInfo(sessionCode: string, courseCode: string): string {
  if (!sessionCode || !courseCode) {
    return '';
  }

  const formattedCourseCode = formatCourseCode(courseCode);
  const parsedSessionInfo = parseSessionCode(sessionCode, courseCode);

  if (!parsedSessionInfo) {
    return formattedCourseCode;
  }

  return `${formattedCourseCode} · ${parsedSessionInfo}`;
}
