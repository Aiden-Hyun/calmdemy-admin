# Firestore Schema (App + Worker)

This document describes the Firestore collections used by the Calmdemy app and the content factory worker. It is derived from:
- Rules: `firestore.rules`
- Indexes: `firestore.indexes.json`
- Types: `src/types/index.ts`
- Repositories: `src/features/**/data/*Repository.ts`, `src/shared/data/content/*Repository.ts`
- Worker content factory: `worker/CONTENT_FACTORY.md`

If a field is not listed below, it is not relied on by the app/worker and may be ignored or considered legacy.

**Conventions**
- Timestamps are stored as Firestore `Timestamp` values.
- User-owned collections use `user_id` (snake_case) and enforce per-user access in rules.
- Content collections are read-only for clients; admin/worker writes happen server-side.

**Premium Access Policy (Implemented March 1, 2026)**
- Only `course_sessions` are premium-gated in app logic.
- All non-course audio content is treated as free in repositories/UI.
- `isFree` remains stored on content docs for compatibility, but for non-course collections it is normalized to free.
- Legacy `bedtime_stories.is_premium` is removed by migration and no longer used by app code.
- Migration script: `scripts/migrateCoursesOnlyPremium.js` (`npm run migrate:courses-only-premium`).
- App policy helpers: `src/shared/utils/premiumPolicy.ts`.

## Collection Inventory

| Collection | Access | Notes |
| --- | --- | --- |
| `users` | User read/write own doc | Role gate for admin features via `role`.
| `meditation_sessions` | User read/write own docs | Session tracking, used for stats.
| `user_favorites` | User read/write own docs | Favorites list + toggle logic.
| `listening_history` | User read/write own docs | Used for recents.
| `playback_progress` | User read/write own docs | Used for resume playback.
| `completed_content` | User read/write own docs | Used to mark content completed.
| `content_ratings` | User read/write own docs | Like/dislike per user/content.
| `content_reports` | Create by user, read by admin | Content issue reports.
| `content_audit_logs` | Admin read-only | Content Manager metadata edit history.
| `guided_meditations` | Public read | Read-only content.
| `sleep_meditations` | Public read | Read-only content.
| `breathing_exercises` | Public read | Read-only content.
| `bedtime_stories` | Public read | Read-only content.
| `sleep_sounds` | Public read | Read-only content.
| `background_sounds` | Public read | Read-only content.
| `white_noise` | Public read | Read-only content.
| `music` | Public read | Read-only content.
| `asmr` | Public read | Read-only content.
| `albums` | Public read | Read-only content.
| `series` | Public read | Read-only content.
| `meditation_programs` | Public read | Read-only content.
| `emergency_meditations` | Public read | Read-only content.
| `courses` | Public read | Read-only content.
| `course_sessions` | Public read | Read-only content.
| `subjects` | Public read | Read-only content.
| `daily_quotes` | Public read | Read-only content.
| `narrators` | Public read | Read-only content.
| `content_jobs` | Admin read/write | Content factory jobs.
| `worker_status` | Admin read-only | Worker heartbeat/state.
| `worker_control` | Admin read/write | Admin control plane for worker.
| `factory_metrics` | Admin read-only | Daily aggregate metrics for content factory jobs.
| `worker_stacks_status` | Admin read-only | Local companion-reported stack list (pid, venv, log path).
| `worker_log_tails` | Admin read-only | Bounded per-stack live log tail snapshots for admin UI.

## Field Contracts (Known Fields)

### `users`
Required/expected fields used in app logic:
- `email` (string)
- `full_name` (string, optional)
- `avatar_url` (string, optional)
- `role` (`admin` or `user`, optional)
- `meditation_streak` (number)
- `longest_streak` (number)
- `total_meditation_minutes` (number)
- `preferences` (map)
  - `daily_reminder_time` (string)
  - `preferred_duration` (number)
  - `theme` (`light` or `dark`)
  - `notification_enabled` (boolean)
  - `background_sounds` (boolean)
- `created_at` (timestamp, optional)
- `updated_at` (timestamp, optional)

### `meditation_sessions`
- `user_id` (string)
- `duration_minutes` (number)
- `session_type` (string, see `SessionType` in `src/types/index.ts`)
- `completed_at` (timestamp)
- `notes` (string, optional)
- `mood_before` (number, optional)
- `mood_after` (number, optional)

### `user_favorites`
- `user_id` (string)
- `content_id` (string)
- `content_type` (string enum used by app)
- `favorited_at` (timestamp)

### `listening_history`
- `user_id` (string)
- `content_id` (string)
- `content_type` (string enum used by app)
- `content_title` (string)
- `content_thumbnail` (string or null)
- `duration_minutes` (number)
- `played_at` (timestamp)
- `course_code` (string, optional)
- `session_code` (string, optional)

### `playback_progress`
Document ID convention: `${userId}_${contentId}`
- `user_id` (string)
- `content_id` (string)
- `content_type` (string)
- `position_seconds` (number)
- `duration_seconds` (number)
- `updated_at` (timestamp)

### `completed_content`
Document ID convention: `${userId}_${contentId}`
- `user_id` (string)
- `content_id` (string)
- `content_type` (string)
- `completed_at` (timestamp)

### `content_ratings`
- `user_id` (string)
- `content_id` (string)
- `content_type` (string)
- `rating` (`like` or `dislike`)
- `rated_at` (timestamp)

### `content_reports`
- `user_id` (string)
- `content_id` (string)
- `content_type` (string)
- `category` (`audio_issue`, `wrong_content`, `inappropriate`, `other`)
- `description` (string or null)
- `status` (`open` or `resolved`, optional on legacy docs; missing is treated as `open`)
- `resolution_note` (string or null, admin-managed)
- `resolved_at` (timestamp, admin-managed)
- `resolved_by_uid` (string or null, admin-managed)
- `resolved_by_email` (string or null, admin-managed)
- `reported_at` (timestamp)

### `content_audit_logs`
Container document ID convention: `${collection}__${contentId}`
- `collection` (string)
- `contentId` (string)
- `lastEditedAt` (timestamp)

Subcollection: `entries`
- `createdAt` (timestamp)
- `actorUid` (string)
- `actorEmail` (string or null)
- `reason` (string)
- `changedFields` (array of strings)
- `before` (map of editable field name -> prior value)
- `after` (map of editable field name -> updated value)

### `daily_quotes`
- `text` (string)
- `author` (string)
- `date` (string, `YYYY-MM-DD`)

### `guided_meditations`
- `title` (string)
- `description` (string)
- `duration_minutes` (number)
- `audioPath` (string)
- `thumbnailUrl` (string, optional)
- `themes` (array of strings)
- `techniques` (array of strings)
- `difficulty_level` (`beginner`, `intermediate`, `advanced`)
- `instructor` (string, optional)
- `isFree` (boolean, optional)
- `createdAt` or `created_at` (timestamp, optional)

### `meditation_programs`
- `title` (string)
- `description` (string)
- `duration_days` (number)
- `difficulty_level` (string)
- `created_at` (timestamp)
- `is_active` (boolean)

### `breathing_exercises`
Stored as flat fields (not nested) and re-shaped in the repository.
- `name` (string)
- `description` (string)
- `inhale_duration` (number)
- `hold_duration` (number, optional)
- `exhale_duration` (number)
- `pause_duration` (number, optional)
- `cycles` (number)
- `difficulty_level` (string)
- `benefits` (array of strings)

### `sleep_meditations`
- `title` (string)
- `description` (string)
- `duration_minutes` (number)
- `instructor` (string)
- `icon` (string)
- `audioPath` (string)
- `thumbnailUrl` (string, optional)
- `color` (string)
- `isFree` (boolean, optional)

### `bedtime_stories`
- `title` (string)
- `description` (string)
- `narrator` (string)
- `duration_minutes` (number)
- `audio_url` (string, optional)
- `audio_file` (string, optional, local asset key)
- `thumbnail_url` (string, optional)
- `category` (string)
- `isFree` (boolean, optional)
- `created_at` (timestamp, optional)

### `sleep_sounds`, `background_sounds`, `white_noise`, `music`, `asmr`
Each collection stores simple audio items with `audioPath` for storage-backed audio.
Common fields:
- `title` (string)
- `description` (string, optional)
- `icon` (string)
- `category` (string)
- `audioPath` (string)
- `color` (string)
- `thumbnailUrl` (string, optional)
- `duration_minutes` (number, optional)
- `isFree` (boolean, optional)

### `albums`
- `title` (string)
- `description` (string)
- `thumbnailUrl` (string, optional)
- `color` (string)
- `artist` (string)
- `trackCount` (number)
- `totalDuration` (number)
- `category` (string)
- `tracks` (array of album track objects)
  - `trackNumber` (number)
  - `title` (string)
  - `duration_minutes` (number)
  - `audioPath` (string)
  - `isFree` (boolean, optional)

### `series`
- `title` (string)
- `description` (string)
- `thumbnailUrl` (string, optional)
- `color` (string)
- `narrator` (string)
- `chapterCount` (number)
- `totalDuration` (number)
- `category` (string)
- `chapters` (array of series chapter objects)
  - `chapterNumber` (number)
  - `title` (string)
  - `description` (string)
  - `duration_minutes` (number)
  - `audioPath` (string)
  - `isFree` (boolean, optional)

### `emergency_meditations`
- `title` (string)
- `description` (string)
- `duration_minutes` (number)
- `icon` (string)
- `color` (string)
- `audioPath` (string)
- `narrator` (string, optional)
- `thumbnailUrl` (string, optional)
- `isFree` (boolean, optional)

### `courses`
- `code` (string)
- `title` (string)
- `subtitle` (string, optional)
- `description` (string)
- `thumbnailUrl` (string, optional)
- `color` (string)
- `icon` (string)
- `instructor` (string)
- `session_count` (number, optional)
- `sessionCount` (number, optional)
- `createdAt` or `created_at` (timestamp, optional)

### `course_sessions`
- `courseId` (string)
- `code` (string)
- `title` (string)
- `description` (string)
- `duration_minutes` (number)
- `audioPath` (string)
- `order` (number)
- `isFree` (boolean, optional)
  - Premium gate source of truth: when `isFree !== true`, session is locked for non-subscribers.

### `subjects`
Document IDs are slugs (e.g. `cbt`, `act`).
- `label` (string)
- `fullName` (string)
- `icon` (string)
- `color` (string)
- `description` (string, optional)

### `narrators`
- `name` (string)
- `bio` (string, optional)
- `photoUrl` (string)

### `content_jobs`
See `worker/CONTENT_FACTORY.md` for full schema. Core fields:
- `status` (string, includes `tts_pending`)
- `contentType` (string)
- `params` (map)
- `llmBackend`, `llmModel`, `ttsBackend`, `ttsModel`, `ttsVoice` (strings)
- `createdAt`, `updatedAt`, `startedAt`, `ttsPendingAt`, `completedAt` (timestamps)
- `createdBy` (string)
- Optional: `generatedScript`, `formattedScript`, `generatedTitle`, `imagePrompt`, `imagePath`,
  `thumbnailUrl`, `audioPath`, `error`, `courseProgress`, `coursePlan`,
  `courseRawScripts`, `courseFormattedScripts`, `courseAudioResults`, `courseId`

### `worker_status`
- `status` (string)
- `lastSeenAt` (timestamp)
- Other fields as defined by the worker

### `worker_control`
- `desiredState` (string)
- `idleTimeoutMin` (number)
- `requestedBy` (string)
- `requestedAt` (timestamp)

### `factory_metrics`
Document ID convention: `YYYY-MM-DD` (UTC).
- `completed_total` (number)
- `failed_total` (number)
- `completed_by_type` (map: contentType -> count)
- `failed_by_type` (map: contentType -> count)
- `failed_by_stage` (map: stage -> count, optional)
- `duration_sec_sum` (number, optional)
- `duration_sec_count` (number, optional)
- `queue_latency_sec_sum` (number, optional)
- `queue_latency_sec_count` (number, optional)
- `lastUpdatedAt` (timestamp)

### `worker_stacks_status`
- `updatedAt` (timestamp)
- `stacks` (array of maps)
  - `id` (string) — stack/worker id (matches `worker_status` doc id)
  - `role` (string) — `pre`, `tts`, `course`, or `full`
  - `venv` (string) — virtualenv path used
  - `enabled` (boolean)
  - `pid` (number, optional) — OS process id if running
  - `logPath` (string, optional) — stdout/stderr log file path
  - `lastUpdatedAt` (timestamp)

### `worker_log_tails`
Document ID convention: `{stackId}`.
- `stackId` (string)
- `stackRole` (string, optional)
- `pid` (number or null)
- `source` (string, currently `"local-companion"`)
- `lineCount` (number)
- `updatedAt` (timestamp)
- `lines` (array of maps, bounded tail)
  - `timestamp` (string, optional)
  - `level` (string, e.g. `INFO`, `WARNING`, `ERROR`)
  - `logger` (string, optional)
  - `message` (string)
  - `raw` (string, optional)
  - `job_id`, `stage`, `content_type`, `model_id`, `error` (string, optional)

## Index Requirements

From `firestore.indexes.json`:
- `listening_history`: `user_id` ASC, `played_at` DESC
- `guided_meditations`: `category` ASC, `created_at` DESC
- `meditation_sessions`: `user_id` ASC, `completed_at` DESC
- `meditation_programs`: `is_active` ASC, `created_at` DESC
- `user_favorites`:
  - `user_id` ASC, `favorited_at` DESC
  - `user_id` ASC, `content_id` ASC
  - `user_id` ASC, `content_id` ASC, `content_type` ASC

If you add new query patterns that combine `where` + `orderBy` or multiple `where` clauses, update `firestore.indexes.json` and deploy indexes.

## Do-Not-Break Invariants

- User-owned documents must always carry `user_id` and match the authenticated user.
- `completed_content` and `playback_progress` document IDs must stay `${userId}_${contentId}` to preserve overwrite semantics.
- `content_jobs` must be admin-only. If rules are relaxed, the worker can be abused.
- `content_audit_logs` must remain admin-read-only and client-write-disabled because it stores internal actor identity and change history.
- Audio content documents must retain the fields expected by screens (see `DATA_ACCESS.md`).
- If you rename fields, update both type definitions and repositories together.

## Update Triggers

Update this doc when you:
- Add/remove a collection in `firestore.rules`.
- Add a repository or a new query pattern.
- Change a content document shape used by screens.
- Change any document ID conventions or ownership rules.
