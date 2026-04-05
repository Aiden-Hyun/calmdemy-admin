## Summary

- 

## Migration Checklist

- [ ] No new files were added in legacy folders (`src/contexts`, `src/hooks`, `src/utils`, `src/components`) unless they are compatibility wrappers.
- [ ] New feature code lives under `src/features/*`.
- [ ] New cross-cutting shared code lives under `src/shared/*`.
- [ ] `src/core/*` changes are infra/bootstrap only.
- [ ] Imports prefer aliases (`@features`, `@shared`, `@core`) instead of deep relative paths.
- [ ] If a legacy module was replaced, migration log was updated in `docs/migration-log.md`.

## Testing

- [ ] Added/updated tests for moved hooks/data/components.
- [ ] Ran relevant tests locally.
- [ ] Ran `npm run typecheck`.
