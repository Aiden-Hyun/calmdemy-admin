// User types
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

export interface UserPreferences {
  daily_reminder_time?: string;
  preferred_duration?: number;
  theme?: "light" | "dark";
  notification_enabled?: boolean;
  background_sounds?: boolean;
}

// Session type for all trackable content
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

// Meditation types
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

export type MeditationTechnique =
  | "breathing"
  | "body-scan"
  | "visualization"
  | "loving-kindness"
  | "mindfulness"
  | "grounding"
  | "progressive-relaxation";

// Keep for backwards compatibility
export type MeditationCategory = MeditationTheme;

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

export interface UserProgramProgress {
  id: string;
  user_id: string;
  program_id: string;
  current_day: number;
  completed_at?: string;
  started_at: string;
  program?: MeditationProgram;
}

// Breathing exercises
export interface BreathingExercise {
  id: string;
  name: string;
  description: string;
  pattern: BreathingPattern;
  duration_minutes: number;
  difficulty_level: "beginner" | "intermediate" | "advanced";
  benefits: string[];
}

export interface BreathingPattern {
  inhale_duration: number;
  hold_duration?: number;
  exhale_duration: number;
  pause_duration?: number;
  cycles: number;
}

// Nature Sounds (ambient audio for sleep)
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

// Bedtime Stories (narrated stories for sleep)
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

// Legacy alias for backward compatibility
export type SleepStory = NatureSound;

// Daily content
export interface DailyQuote {
  id: string;
  text: string;
  author: string;
  date: string;
}

// Favorites
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

// Listening History
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

// Statistics
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

// Content Ratings (Like/Dislike)
export type RatingType = "like" | "dislike";

export interface ContentRating {
  id: string;
  user_id: string;
  content_id: string;
  content_type: string;
  rating: RatingType;
  rated_at: string;
}

// Content Reports
export type ReportCategory = "audio_issue" | "wrong_content" | "inappropriate" | "other";

export type ContentReportStatus = "open" | "resolved";

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
