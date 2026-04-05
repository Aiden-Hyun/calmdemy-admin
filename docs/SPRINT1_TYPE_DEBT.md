# Sprint 1 Type Debt Burn-Down

Date: 2026-02-04

## Scope

- TypeScript error reduction for app/runtime code (`tsc --noEmit`).
- Focused fixes for platform/API mismatches and data contract drift.

## Completed

- Auth and Apple Sign-In error code checks updated for current Expo typings.
- Firebase auth initialization updated to compile with current SDK exports.
- Notification service updated to current Expo notification behavior/trigger typings.
- Timer refs normalized to `ReturnType<typeof setInterval/setTimeout>` for RN compatibility.
- Theme contract normalized with `border` and `textSecondary`.
- Content/data contracts aligned:
  - Added optional `isFree` to `BedtimeStory`.
  - Added optional `totalDuration`/`difficulty` on `FirestoreCourse`.
  - Added optional `dayNumber` on `FirestoreCourseSession`.
  - Added `body-scan` to `MeditationTheme` to match seeded data.
- UI contract fixes:
  - `MeditationCard` updated for current `GuidedMeditation` fields.
  - `TabBarButton` prop forwarding narrowed to supported props.
  - `MeditateScreen` router usage fixed.

## Typecheck Gate

- Added `npm run typecheck` script.
- Current status: `npm run typecheck` passes.

## Notes

- Test files are excluded from the TypeScript gate (`tsconfig.json` exclude list) for now.
- We still keep runtime tests under `vitest`; this only narrows the compile gate to app code.
