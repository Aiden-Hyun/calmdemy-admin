# Storage Layout (Firebase Storage)

This document describes the Firebase Storage layout used by the app and content factory worker.

Source of truth:
- `storage.rules`
- `worker/CONTENT_FACTORY.md`
- `scripts/uploadAudio.js`
- `scripts/uploadCourse.js`

## Storage Rules Summary

`storage.rules` allows:
- Public read for everything under `audio/**`.
- Authenticated write for `audio/**` (admin-only policy is enforced outside Storage rules).

## Audio Path Conventions

All audio files live under the `audio/` prefix in Firebase Storage. The app expects these paths in Firestore documents via `audioPath` (or legacy `audio_url` in bedtime stories).

Content factory outputs:
- Guided meditations: `audio/meditate/meditations/`
- Sleep meditations: `audio/sleep/meditations/`
- Bedtime stories: `audio/sleep/stories/`
- Emergency meditations: `audio/meditate/emergency/`
- Course sessions: `audio/meditate/courses/`

Manual uploads (scripts):
- `scripts/uploadAudio.js` converts a local path under `assets/audio/**` to `audio/**` in storage.
- `scripts/uploadCourse.js` uploads to `audio/meditate/courses/{courseId}/` and creates Firestore docs.

### Naming

Content factory uses:
- `{topic-slug}-{8-char-uuid}.mp3`

Course uploads use standardized filenames:
- `course-intro.mp3`
- `module-1-lesson.mp3`
- `module-1-practice.mp3`
- etc.

## Audio Encoding Expectations

Content factory normalizes and encodes audio as:
- MP3
- 192 kbps
- 44.1 kHz
- Mono

`uploadAudio.js` and `uploadCourse.js` normalize to:
- Target loudness: -16 LUFS
- Tolerance: +/- 3 LUFS

All uploads set:
- `contentType`: `audio/mpeg`
- `cacheControl`: `public, max-age=31536000`

## Do-Not-Break Invariants

- Firestore `audioPath` values must match this layout.
- For bedtime stories, if you still use `audio_url`, it must be a valid, public URL.
- If you change path conventions, update:
  - Worker upload paths (`worker/pipeline/storage_uploader.py`)
  - Manual upload scripts (`scripts/uploadAudio.js`, `scripts/uploadCourse.js`)
  - Any UI that derives or resolves audio paths.

## Update Triggers

Update this doc when you:
- Change `storage.rules`.
- Add or change audio subpaths.
- Change audio encoding or cache headers.
