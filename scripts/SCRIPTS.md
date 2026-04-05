# Scripts Guide

This folder contains one-off or operational scripts. Run them from the project root (`apps/calmdemy`) unless a script says otherwise.

## Scripts

`checkLegacyFreeze.js`
- Purpose: CI guard that fails when new files are added under frozen legacy folders (`src/contexts`, `src/hooks`, `src/utils`, `src/components`).
- Inputs: `scripts/legacy-freeze-baseline.json`.
- Side effects: None (read-only).

`getAudioDuration.js`
- Purpose: Print durations for a single MP3 file or a folder of MP3s.
- Inputs: file or directory path (defaults to `assets/audio/meditate/courses/foundational-series`).
- Side effects: None (read-only).

`seedSubjects.js`
- Purpose: Seed the `subjects` collection in Firestore.
- Inputs: Firebase Admin credentials via `GOOGLE_APPLICATION_CREDENTIALS` or `worker/service-account-key.json`.
- Side effects: Writes/merges six subject documents in Firestore.
- Do not run: Against production unless you intend to overwrite subject data.

`migrateCoursesOnlyPremium.js`
- Purpose: Enforce the "courses-only premium" policy in Firestore data.
- Inputs: `serviceAccountKey.json` in repo root; optional `--dry-run`.
- Side effects: Updates `isFree` flags across audio collections, removes legacy `bedtime_stories.is_premium`, and enforces `course_sessions.isFree=false`.
- Do not run: Against production without validating the dry-run output first.

`uploadAudio.js`
- Purpose: Normalize and upload audio files under `assets/audio/**` to Firebase Storage.
- Inputs: `serviceAccountKey.json` in repo root, FFmpeg installed, optional flags `--all`, `--force`, `--skip-normalize`.
- Side effects: Modifies audio files in place when normalization runs; uploads to Firebase Storage; prints the `audioPath` to use in Firestore.
- Do not run: Against production unless you intend to publish audio files.

`uploadCourse.js`
- Purpose: Upload a full course folder to Firebase Storage and create Firestore documents for `courses` and `course_sessions`.
- Inputs: `serviceAccountKey.json` in repo root, FFmpeg (optional for normalization), `music-metadata` package, and required `--course-code` flag.
- Side effects: Uploads audio, creates Firestore documents, and can delete the local folder with `--delete-after`.
- Do not run: Against production unless you intend to publish a course.

## Supporting Files

`UPLOAD_COURSE.md`
- Purpose: Detailed usage guide for `uploadCourse.js` including naming conventions and expected output.

`legacy-freeze-baseline.json`
- Purpose: Baseline file list used by `checkLegacyFreeze.js`.

## Output Locations

- Firebase Storage uploads go to `audio/**`.
- Firestore writes go to `courses`, `course_sessions`, or `subjects` depending on the script.

## Safety Tips

- Prefer running scripts against a staging Firebase project when possible.
- Keep `serviceAccountKey.json` out of git (it is already gitignored).
