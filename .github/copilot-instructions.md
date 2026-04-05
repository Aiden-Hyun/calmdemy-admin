# Copilot instructions for Calmdemy

## Big picture
- Expo Router app: route files live under `app/` and are intentionally thin wrappers that render feature screens from `src/features/*` (see `app/(tabs)/home.tsx`).
- Global providers are composed in `src/core/providers/AppProviders.tsx` and applied in `app/_layout.tsx`.
- Auth gating uses `ProtectedRoute` in `src/shared/ui/ProtectedRoute.tsx` (redirects to `/login`).

## Architecture & code organization
- Feature-first layout is the source of truth:
  - `src/features/<feature>/{screens,components,hooks,data,domain}`
- Cross-cutting modules live in `src/shared/{ui,hooks,utils,types,data}`.
- Infra/bootstrap only in `src/core/{config,providers,firebase,navigation,session}`.
- Legacy folders are frozen: `src/contexts`, `src/hooks`, `src/utils`, `src/components`, and `src/shared/data/contentRepository.ts` (see `docs/ARCHITECTURE_MIGRATION.md`). Do not add new files there; use the feature/shared/core paths and run `npm run check:legacy-freeze` to verify.

## Key integrations & data flow
- Firebase config/env lives in `src/core/config/env.ts`; initialization and helpers in `src/firebase.ts`.
- External services: Firebase (Auth/Firestore/Storage) and RevenueCat (`react-native-purchases`).
- Content/audio assets are stored in Firebase Storage; see the upload workflow in `README.md` and `scripts/`.

## Conventions & patterns
- Use path aliases: `@core/*`, `@features/*`, `@shared/*`, `@/*` (see `tsconfig.json` and `babel.config.js`).
- Screens in `app/` should avoid business logic; keep it in feature modules and shared hooks/components.

## Developer workflows (from README/package.json)
- Install: `npm install`
- Start dev server: `npx expo start` (or `npm run start`)
- Run tests: `npm test` (Vitest)
- Typecheck: `npm run typecheck`
- Legacy-freeze guard: `npm run check:legacy-freeze`
- Firebase indexes: edit `firestore.indexes.json`, then `firebase deploy --only firestore:indexes`.
- Environment: copy `.env.example` to `.env` and fill Firebase/Google/RevenueCat keys.
