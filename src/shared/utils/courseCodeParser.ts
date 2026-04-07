/**
 * @fileoverview Parsing and formatting utilities for course and session codes.
 *
 * ARCHITECTURAL ROLE:
 * This module decodes structured course identifiers into human-readable display strings.
 * Course content uses hierarchical codes that encode course, module, and session type info.
 *
 * CODE STRUCTURE:
 * Course codes:  "CBT101", "ACT201"
 *   - Letters (2-3): Course category (CBT=Cognitive Behavioral Therapy, ACT=Acceptance & Commitment)
 *   - Numbers (2-3): Course number
 *
 * Session codes: "CBT101INT", "CBT101M1L", "CBT101M1P"
 *   - [Course code] + [suffix]
 *   - INT = Course introduction (no module)
 *   - M[num][type] = Module with type (M1L = Module 1 Lesson, M3P = Module 3 Practice)
 *
 * DESIGN PATTERN:
 * - String Parser: Decodes structured data embedded in identifiers
 * - Pure functions: No side effects, used in renders and analytics
 * - Defensive parsing: Returns empty string on invalid input (fails gracefully)
 *
 * CONSUMERS:
 * - Course detail screens: Display "CBT 101 · Module 2 Practice" breadcrumbs
 * - Course cards: Show session type and module number
 * - Admin JobCard: Format course references in admin UI
 */

/** Session type markers in course codes */
type SessionType = 'L' | 'P';

/** Maps session type markers to human-readable names */
const SESSION_TYPE_MAP: Record<SessionType, string> = {
  L: 'Lesson',
  P: 'Practice',
};

/**
 * Parses a session code to extract module and session type information.
 *
 * PARSING STRATEGY:
 * 1. Strip course code prefix (e.g., "CBT101M1P" -> "M1P")
 * 2. Detect INT suffix for course intro (no module)
 * 3. Regex match module pattern: M[digits][L|P]
 * 4. Return formatted string or empty on parse failure
 *
 * RETURN VALUES:
 * - "Course Intro" for intro sessions
 * - "Module N Lesson" or "Module N Practice" for module sessions
 * - "" (empty string) if code cannot be parsed
 *
 * DEFENSIVE DESIGN:
 * - No exceptions thrown (returns empty string on invalid input)
 * - Handles missing courseCode gracefully
 * - Regex matches only valid patterns (M + 1+ digits + L/P)
 *
 * @param sessionCode - Full session code (e.g., "CBT101M1P", "CBT101INT")
 * @param courseCode - Course code to strip (e.g., "CBT101")
 * @returns string - Human-readable module info, or empty string if unparseable
 *
 * @example
 * parseSessionCode("CBT101INT", "CBT101")   // "Course Intro"
 * parseSessionCode("CBT101M1L", "CBT101")   // "Module 1 Lesson"
 * parseSessionCode("CBT101M1P", "CBT101")   // "Module 1 Practice"
 * parseSessionCode("ACT201M3P", "ACT201")   // "Module 3 Practice"
 * parseSessionCode("INVALID", "CBT101")     // ""
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
 * Formats a course code for display with proper spacing.
 *
 * TRANSFORMATION:
 * - Inserts space before the first digit in the code
 * - Converts "CBT101" to "CBT 101", "ACT201" to "ACT 201"
 *
 * REGEX EXPLANATION:
 * - (\D+)     matches one or more non-digit characters (course abbreviation)
 * - (\d+)     matches one or more digits (course number)
 * - $1 $2     replaces with captured groups separated by space
 *
 * DEFENSIVE DESIGN:
 * - Returns empty string if courseCode is empty or falsy
 * - Returns original if pattern doesn't match (no-op)
 *
 * @param courseCode - Course code to format (e.g., "CBT101")
 * @returns string - Formatted code with space (e.g., "CBT 101"), or empty string
 *
 * @example
 * formatCourseCode("CBT101")  // "CBT 101"
 * formatCourseCode("ACT201")  // "ACT 201"
 * formatCourseCode("")        // ""
 * formatCourseCode("INVALID") // "INVALID" (pattern doesn't match, no change)
 */
export function formatCourseCode(courseCode: string): string {
  if (!courseCode) {
    return '';
  }
  
  // Insert space before the first digit
  return courseCode.replace(/(\D+)(\d+)/, '$1 $2');
}

/**
 * Builds a complete session breadcrumb string combining course and session info.
 *
 * COMPOSITION:
 * - Formatted course code (e.g., "CBT 101")
 * - Session info (e.g., "Module 1 Practice" or "Course Intro")
 * - Joined with middle dot (·) separator for visual hierarchy
 *
 * RETURN VALUE:
 * - Full breadcrumb: "CBT 101 · Module 1 Practice"
 * - Fallback to course only if session info not parseable: "CBT 101"
 * - Empty string if both inputs missing
 *
 * USE CASE:
 * - Course detail screens: Display in header as secondary text
 * - Course cards: Show session context under title
 * - Breadcrumb navigation
 *
 * @param sessionCode - Full session code (e.g., "CBT101M1P", "CBT101INT")
 * @param courseCode - Course code (e.g., "CBT101")
 * @returns string - Formatted breadcrumb, or empty string if inputs invalid
 *
 * @example
 * buildSessionMetaInfo("CBT101M1P", "CBT101")   // "CBT 101 · Module 1 Practice"
 * buildSessionMetaInfo("CBT101INT", "CBT101")   // "CBT 101 · Course Intro"
 * buildSessionMetaInfo("INVALID", "CBT101")     // "CBT 101" (graceful fallback)
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
