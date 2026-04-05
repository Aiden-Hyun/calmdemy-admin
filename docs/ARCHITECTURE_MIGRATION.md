# Architecture Migration Plan (Legacy-Aware, Low-Risk)

## 1) Inventory And Freeze

The following paths are **legacy and retired**. They are frozen and should not receive new files:

- `src/contexts`
- `src/hooks`
- `src/utils`
- `src/components`

Rule: do not place net-new business logic in these locations. Keep them absent or empty.

## 2) Target Structure (Single Source Of Truth)

- Feature-first for product logic and UI:
  - `src/features/*/screens`
  - `src/features/*/hooks`
  - `src/features/*/data`
  - `src/features/*/components`
- Cross-cutting shared modules:
  - `src/shared/ui`
  - `src/shared/hooks`
  - `src/shared/utils`
  - `src/shared/types`
  - `src/shared/data`
- Infra/bootstrap only:
  - `src/core/config`
  - `src/core/providers`
  - `src/core/firebase`
  - `src/core/navigation`
  - `src/core/session`

## 3) Migration Map

### `src/contexts` → `src/core/providers` or feature-local contexts

- App-wide runtime/context wiring belongs in `src/core/providers`.
- Feature-specific context moves to `src/features/<feature>/contexts`.
- Migration complete: app-wide contexts live in `src/core/providers/contexts`.

### `src/hooks` → `src/shared/hooks` or feature hooks

- Use `src/shared/hooks` for cross-feature behavior.
- Use `src/features/<feature>/hooks` for feature-only behavior.
- Migration complete: `src/hooks` wrappers removed.

### `src/utils` → `src/shared/utils` or feature utils

- Shared pure helpers move to `src/shared/utils`.
- Feature-only helpers move to `src/features/<feature>/utils`.

### `src/components` → `src/shared/ui` or feature components

- Reusable cross-feature UI moves to `src/shared/ui`.
- Feature-specific components move to `src/features/<feature>/components`.
- Migration complete: `src/components` wrappers removed.

### Shared data repositories → split repositories

- Break into focused modules by domain:
  - narrators
  - playback progress
  - completed content
  - content ratings
  - content reports
- Migration complete: import directly from `src/shared/data/content/*`.

## 4) Conventions (Opt-In, Effective Immediately)

- New code must land in the target structure, not legacy folders.
- Legacy folders are migration-only: wrappers, import bridge, or delete prep.
- Prefer alias imports (`@features`, `@shared`, `@core`) over deep relatives.
- Migrate in vertical slices (one feature at a time), then remove dead legacy files.
- Run `npm run check:legacy-freeze` in PR validation to catch new files added in frozen folders (`scripts/legacy-freeze-baseline.json` is the current allowed set).

## 5) Vertical Slice Workflow

1. Move one feature component/hook/data module to `src/features/<feature>/*`.
2. Update imports to target aliases.
3. Add compatibility re-export only if needed.
4. Add or update tests for touched modules.
5. Remove obsolete legacy files once no longer referenced.

## 6) Tracking

See [`docs/migration-log.md`](./migration-log.md) for completed moves and deletions.

Current baseline: legacy folders are now compatibility wrappers first; implementations should be migrated into `src/features/*`, `src/shared/*`, and `src/core/providers/contexts/*`.
