/**
 * ============================================================
 * types/index.ts — Domain Model Definitions (Type Layer)
 * ============================================================
 *
 * Architectural Role:
 *   This is the canonical type registry for the entire Calmdemy app.
 *   Every Firestore document shape, every content variant, and every
 *   user-facing data structure is defined here. Think of it as the
 *   "schema" layer — the single source of truth that the Repository
 *   pattern, React Query hooks, and UI components all depend on.
 *
 * Design Patterns:
 *   - Discriminated Unions: SessionType, content_type fields, and
 *     MeditationTheme/MeditationTechnique use string literal unions
 *     to enable exhaustive type-checking at compile time. This is
 *     the TypeScript equivalent of algebraic data types.
 *   - Denormalization: Some interfaces (e.g., ListeningHistoryItem)
 *     carry denormalized fields (content_title, content_thumbnail)
 *     for read-heavy display paths, a common Firestore optimization
 *     that trades write complexity for O(1) reads.
 *   - Type Aliases for Backwards Compatibility: MeditationCategory
 *     and SleepStory are kept as aliases so existing code doesn't
 *     break during incremental refactors (Open/Closed Principle).
 *
 * Key Consumers:
 *   - All repository modules (src/features/*/data/)
 *   - All React Query hooks (src/shared/hooks/queries/)
 *   - All UI components that render content cards or player screens
 *
 * Firestore Mapping:
 *   Each interface roughly corresponds to a Firestore collection
 *   or subcollection document. See FIRESTORE_SCHEMA.md at the
 *   project root for the full collection ↔ type mapping.
 * ============================================================
 */

// --- User Domain ---

/**
 * Represents an authenticated Calmdemy user.
 * Maps to the `users` Firestore collection. The `role` field enables
 * Role-Based Access Control (RBAC) — admin users get access to the
 * content pipeline and moderation tools via the admin feature module.
 */
export interface User {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  role?: 'admin' | 'user';
  meditation_streak: number;
  total_meditation_minutes: number;
  preferences: UserPreferences;
  created_at: string;
}

/**
 * User-configurable preferences, stored as a nested object within
 * the User document. Each field is optional — Firestore documents
 * may omit fields that were never set, so consumers must handle
 * undefined gracefully (Defensive Programming).
 */
export interface UserPreferences {
  daily_reminder_time?: string;
  preferred_duration?: number;
  theme?: "light" | "dark";
  notification_enabled?: boolean;
  background_sounds?: boolean;
}

// --- Session & Content Domain ---

/**
 * Discriminated union of every trackable content type in the app.
 * Used as a partition key in Firestore queries and as a switch
 * discriminant in the media player — the player uses this value
 * to decide which UI variant (timer, progress bar, chapter list)
 * to render. Adding a new content type here propagates compile
 * errors to every switch that needs updating (exhaustiveness check).
 */
export type SessionType =
  | "meditation"
  | "breathing"
  | "nature_sound"
  | "bedtime_story"
  | "course_session"
  | "series_chapter"
  | "album_track"
  | "sleep_meditation"
  | "emergency"
  | "music"
  | "technique";

// --- Meditation Domain ---

/**
 * A completed meditation session record. Maps to the `meditation_sessions`
 * Firestore subcollection under each user. The mood_before/mood_after
 * fields enable the mood-tracking analytics shown on the Stats screen.
 */
export interface MeditationSession {
  id: string;
  user_id: string;
  duration_minutes: number;
  session_type: SessionType;
  completed_at: string;
  notes?: string;
  mood_before?: number;
  mood_after?: number;
}

/**
 * A piece of guided meditation content. Maps to the `guided_meditations`
 * Firestore collection. Note the multi-valued `themes` and `techniques`
 * arrays — a single meditation can span multiple categories, enabling
 * flexible filtering in the UI via array-contains queries in Firestore.
 * The `isFree` flag drives the Gatekeeper/paywall logic in PremiumGate.
 */
export interface GuidedMeditation {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  audioPath: string;
  thumbnailUrl?: string;
  themes: MeditationTheme[];      // Multiple themes allowed
  techniques: MeditationTechnique[]; // Multiple techniques allowed
  difficulty_level: "beginner" | "intermediate" | "advanced";
  instructor?: string;
  isFree?: boolean;
}

/**
 * String literal union for meditation theme categorization.
 * Used as filter chips on the Meditate tab and as Firestore
 * array-contains query values.
 */
export type MeditationTheme =
  | "focus"
  | "stress"
  | "anxiety"
  | "sleep"
  | "body-scan"
  | "relationships"
  | "self-esteem"
  | "gratitude"
  | "loving-kindness";

/**
 * String literal union for meditation technique categorization.
 * Orthogonal to themes — a "breathing" technique can appear under
 * multiple themes (sleep, anxiety, focus). This two-axis taxonomy
 * enables richer content discovery.
 */
export type MeditationTechnique =
  | "breathing"
  | "body-scan"
  | "visualization"
  | "loving-kindness"
  | "mindfulness"
  | "grounding"
  | "progressive-relaxation";

// Legacy alias — kept so older code that references MeditationCategory
// still compiles. Prefer MeditationTheme in new code.
export type MeditationCategory = MeditationTheme;

/**
 * A multi-day meditation program (e.g., "7-Day Stress Relief").
 * Programs are a higher-order content structure — they compose
 * multiple GuidedMeditation sessions into a sequential curriculum.
 * The `is_active` flag lets admins soft-delete without purging data.
 */
export interface MeditationProgram {
  id: string;
  title: string;
  description: string;
  duration_days: number;
  difficulty_level: "beginner" | "intermediate" | "advanced";
  created_at: string;
  is_active: boolean;
  sessions?: GuidedMeditation[];
}

/**
 * Tracks a user's advancement through a MeditationProgram.
 * Maps to the `user_program_progress` subcollection. The optional
 * `program` field is a client-side join — populated after fetching
 * the program document to avoid an N+1 query in list views.
 */
export interface UserProgramProgress {
  id: string;
  user_id: string;
  program_id: string;
  current_day: number;
  completed_at?: string;
  started_at: string;
  program?: MeditationProgram;
}

// --- Breathing Domain ---

/**
 * A breathing exercise definition. The `pattern` field is a Value Object
 * (BreathingPattern) that parameterizes the breathing animation cycle —
 * the BreathingGuide UI component reads these durations to drive its
 * inhale/hold/exhale/pause animation loop.
 */
export interface BreathingExercise {
  id: string;
  name: string;
  description: string;
  pattern: BreathingPattern;
  duration_minutes: number;
  difficulty_level: "beginner" | "intermediate" | "advanced";
  benefits: string[];
}

/**
 * Value Object defining the timing of a breathing cycle.
 * Each duration is in seconds. Optional hold/pause durations allow
 * modeling different techniques (e.g., 4-7-8 breathing uses all four
 * phases, while simple belly breathing omits hold and pause).
 */
export interface BreathingPattern {
  inhale_duration: number;
  hold_duration?: number;
  exhale_duration: number;
  pause_duration?: number;
  cycles: number;
}

// --- Sleep Domain ---

/**
 * An ambient nature sound for sleep. Dual audio source strategy:
 * `audio_url` is a full URL (for externally hosted audio), while
 * `audio_file` is a key into audioFiles.ts (for Firebase Storage).
 * The media player resolves whichever is present, preferring audio_url.
 */
export interface NatureSound {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  audio_url?: string;
  audio_file?: string; // Key for local audio asset (see audioFiles.ts)
  thumbnail_url?: string;
  category: "rain" | "ocean" | "forest" | "fire" | "wind" | "ambient";
  isFree?: boolean;
  created_at: string;
}

/**
 * A narrated bedtime story. Same dual audio source pattern as NatureSound.
 * The `narrator` field supports the narrator attribution UI. Categories
 * use a different union than NatureSound, reflecting the editorial taxonomy.
 */
export interface BedtimeStory {
  id: string;
  title: string;
  description: string;
  narrator: string;
  duration_minutes: number;
  audio_url?: string;
  audio_file?: string; // Key for local audio asset (see audioFiles.ts)
  thumbnail_url?: string;
  category: "nature" | "fantasy" | "travel" | "fiction" | "thriller" | "fairytale";
  isFree?: boolean;
  created_at: string;
}

// Legacy alias — the original type was "SleepStory" before the model
// split into NatureSound + BedtimeStory. Kept for migration safety.
export type SleepStory = NatureSound;

// --- Daily Content ---

/**
 * A motivational quote displayed on the Home screen.
 * The `date` field is used to match a curated quote to today's date;
 * if no match exists, the repository falls back to a random selection
 * (Graceful Degradation).
 */
export interface DailyQuote {
  id: string;
  text: string;
  author: string;
  date: string;
}

// --- User Engagement Domain ---

/**
 * A user's favorite bookmark. The `content_type` discriminant enables
 * polymorphic content resolution — when rendering a favorites list,
 * the UI uses this field to dispatch to the correct detail screen.
 * Maps to the `favorites` subcollection under each user.
 */
export interface UserFavorite {
  id: string;
  user_id: string;
  content_id: string;
  content_type:
    | "meditation"
    | "nature_sound"
    | "bedtime_story"
    | "breathing_exercise"
    | "series_chapter"
    | "album_track"
    | "emergency"
    | "course_session";
  favorited_at: string;
}

/**
 * A record in the user's listening history feed.
 * Heavily denormalized (content_title, content_thumbnail, course_code)
 * so the history list can render without joining against the content
 * collection — a classic Firestore read-optimization trade-off.
 */
export interface ListeningHistoryItem {
  id: string;
  user_id: string;
  content_id: string;
  content_type:
    | "meditation"
    | "nature_sound"
    | "bedtime_story"
    | "breathing_exercise"
    | "series_chapter"
    | "album_track"
    | "emergency"
    | "course_session";
  content_title: string; // Denormalized for quick display
  content_thumbnail?: string; // Denormalized
  duration_minutes: number;
  played_at: string;
  // For course sessions - to display code badge and module info
  course_code?: string; // e.g., "CBT101"
  session_code?: string; // e.g., "CBT101M1L"
}

// --- Analytics Domain ---

/**
 * Aggregated statistics for the profile/stats screen.
 * The weekly/monthly/yearly arrays store rolling minute totals
 * for chart rendering. These are computed server-side (Cloud Functions)
 * to avoid expensive client-side aggregation over the full session history.
 */
export interface UserStats {
  total_sessions: number;
  total_minutes: number;
  current_streak: number;
  longest_streak: number;
  favorite_time_of_day?: string;
  most_used_category?: MeditationCategory;
  weekly_minutes: number[];
  monthly_minutes: number[];
  yearly_minutes: number[];
  mood_improvement: number;
}

// --- Content Moderation Domain ---

/** Binary rating system — simpler than a star scale, optimized for engagement. */
export type RatingType = "like" | "dislike";

/** A user's rating on a piece of content. One rating per user per content item. */
export interface ContentRating {
  id: string;
  user_id: string;
  content_id: string;
  content_type: string;
  rating: RatingType;
  rated_at: string;
}

/** Categories for user-submitted content reports — drives the admin triage workflow. */
export type ReportCategory = "audio_issue" | "wrong_content" | "inappropriate" | "other";

/** Report lifecycle state — admins transition open → resolved via the content manager. */
export type ContentReportStatus = "open" | "resolved";

/**
 * A user-submitted content report. The resolution fields (resolved_at,
 * resolved_by_uid, resolution_note) form a mini audit trail so admins
 * can review moderation history in the content-manager reports screen.
 */
export interface ContentReport {
  id: string;
  user_id: string;
  content_id: string;
  content_type: string;
  category: ReportCategory;
  description?: string | null;
  status?: ContentReportStatus;
  resolution_note?: string | null;
  resolved_at?: string;
  resolved_by_uid?: string;
  resolved_by_email?: string;
  reported_at: string;
}
