# Calmdemy - Meditation & Mindfulness App

A React Native app built with Expo for meditation, breathing exercises, and sleep stories.

## Tech Stack

- **Expo SDK 54** with React Native 0.81
- **Expo Router v6** for navigation
- **TypeScript** (strict mode)
- **Firebase (Auth, Firestore, Storage)** for backend services
- **RevenueCat** for subscriptions
- **React Native StyleSheet** for styling

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in Firebase, Google Sign-In, and RevenueCat values.

3. Start the development server:
   ```bash
   npx expo start
   ```

4. Run tests:
   ```bash
   npm test
   ```

### Firestore indexes

All composite indexes live in [`firestore.indexes.json`](./firestore.indexes.json). After editing that file, deploy the indexes to Firebase:

```bash
firebase login          # first time only
firebase deploy --only firestore:indexes
```

Alternatively, copy the field definitions into the Firestore Console → Database → Indexes UI.

### Firebase Storage Setup (Audio Files)

The app uses Firebase Storage for meditation audio files. To upload the audio:

1. **Authenticate Firebase CLI:**
   ```bash
   firebase login --reauth
   ```

2. **Generate a service account key:**
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate new private key"
   - Save as `serviceAccountKey.json` in the project root (this file is git-ignored)

3. **Upload audio files:**
   ```bash
   node scripts/uploadAudioToStorage.js
   ```

4. **Or use Google Cloud Console:**
   - Go to [Google Cloud Storage](https://console.cloud.google.com/storage)
   - Navigate to bucket: `calmnest-e910e.firebasestorage.app`
   - Create folder: `audio/`
   - Upload files from `assets/audio/` maintaining the folder structure

Audio files are organized as:
```
audio/
  meditation/   # Guided meditation content
  sleep/        # Sleep story ambient sounds
  breathing/    # Breathing exercise backgrounds
```

## Features

- **Authentication**: Email/password signup and login
- **Meditation Sessions**: Track your meditation practice
- **Breathing Exercises**: Guided breathing techniques
- **Sleep Stories**: Relaxing audio content for better sleep
- **Progress Tracking**: Monitor your meditation streak and total minutes

## Project Structure

```
/app
  - _layout.tsx      # Root layout with app providers
  - index.tsx        # Entry point with auth routing
  - (tabs)/          # Tab routes (thin wrappers)
  - ...              # Other route screens

/src
  - core/            # App-wide config, providers, infrastructure
  - features/        # Feature-first modules (home, sleep, meditate, music, profile)
  - shared/          # Cross-feature modules (ui, hooks, utils, data/content)
  - core/providers/contexts/ # New home for app-wide context implementations
```

## Documentation Map

- `FIRESTORE_SCHEMA.md` - Firestore collection inventory, access rules, and field contracts.
- `STORAGE_LAYOUT.md` - Firebase Storage paths, encoding conventions, and invariants.
- `src/shared/data/DATA_ACCESS.md` - Repository map, query patterns, and index guidance.
- `scripts/SCRIPTS.md` - Script purposes, inputs, side effects, and safety notes.
- `worker/CONTENT_FACTORY.md` - Content Factory architecture and worker pipeline.

## Architecture Migration (Legacy-Aware)

This project already completed one refactor pass, so we are running a staged migration to avoid risky big-bang changes.

- Legacy paths retired and frozen: `src/contexts`, `src/hooks`, `src/utils`, `src/components` (guarded by `check:legacy-freeze`)
- New home for feature code: `src/features/*/{screens,hooks,data,components}`
- New home for cross-cutting shared code: `src/shared/*`
- `src/core/*` is reserved for infrastructure/bootstrap concerns only
- Migration guard: run `npm run check:legacy-freeze` to prevent new files in frozen legacy folders

See [`docs/ARCHITECTURE_MIGRATION.md`](./docs/ARCHITECTURE_MIGRATION.md) for the migration map, rules, and phased rollout.

## Database Schema

- **users**: User profiles and meditation stats
- **meditation_sessions**: Individual meditation session records
- **meditation_programs**: Structured meditation programs
- **user_program_progress**: User progress through programs
