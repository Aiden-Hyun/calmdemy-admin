# Local storage migration (Firestore → SQLite, incremental)

Living tracking document for the incremental migration of V2 internal state from Firestore to local SQLite. Each phase is independently shippable and the system keeps working after every one.

> **Status: Phase 0 (planning) — no migration code shipped yet.**
> Last updated: 2026-05-11

---

## Why we're doing this

Three motivations, in priority order:

1. **Eliminate Firestore eventual-consistency races.** We've hit at least one production bug ([`43f4e7b9`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/43f4e7b9)) where index lag caused fan-in helpers to miss a just-written shard. Surgical fix shipped, but the *class* of bug is real and will recur. SQLite gives strong read-after-write consistency for free.
2. **Reduce restart latency for retried jobs.** Even after the batch-checkpoint optimization, every `succeeded_shard_keys` query is a Firestore round-trip. Local SQLite reads are ~microseconds vs 100–300 ms. Adds up across the orchestrator's many state queries per tick.
3. **Reduce Firestore noise + cost.** The companion log fills with gRPC retry errors during normal operation. Each restart hits Firestore dozens of times. Going local removes a load-bearing dependency for *worker correctness* without removing it for *admin observability*.

---

## Architecture decision: dual-write with SQLite primary

The constraint: **the admin UI reads from Firestore directly via the JavaScript SDK**, and we can't migrate that without rewriting the admin app. So Firestore stays as a read source for the UI.

Pattern for each migrated collection:

```
Worker writes:    SQLite (transactional, primary)
                  ↓
                  Firestore (best-effort mirror, fire-and-forget background)
Worker reads:     SQLite (strong consistency, fast)
Admin UI reads:   Firestore (unchanged path)
```

Three implications:
- **Each repo class gets a SQLite sibling.** The `firestore_repos.py` pattern already exists. We add `sqlite_repos.py` next to it.
- **Composition root chooses backend per collection.** Env var per collection (e.g. `FACTORY_STORAGE_STEP_RUNS=sqlite|firestore|dual`). Default `firestore` so nothing changes until explicitly opted in.
- **Migration is reversible.** Flip the env var back to `firestore` and the worker behaves exactly as before.

### SQLite location
- Default: `worker/.tmp/factory.db` (gitignored, same volume as chunk WAVs).
- Override: `FACTORY_DB_PATH=/path/to/db`.
- Schema: one table per migrated collection, with the canonical fields preserved. Indexes mirror Firestore's composite indexes.

### Failure modes we have to plan for
- **SQLite write succeeds, Firestore mirror fails.** Worker keeps going (SQLite is authoritative). Admin UI sees stale data for that field until a later mirror succeeds. Mirror writes go on a best-effort retry queue.
- **SQLite write fails.** Worker treats it as a real failure (raise → claim-loop retries the step).
- **Worker writes SQLite, then crashes before Firestore mirror.** On worker restart, a "mirror reconciliation" pass replays unmirrored SQLite rows to Firestore. Idempotent merge so duplicates don't double-write.
- **Two workers running on different machines** — out of scope. This migration assumes single-host (which is the current production reality).

---

## Phases overview

| Phase | Collection | Status | Why this order | Estimated effort |
|---|---|---|---|---|
| **1** | `factory_events` | 🔵 NEXT | Safest. Append-only, no reads in hot path, failures are non-fatal (audit log). Proves the dual-write pattern. | ~400 LOC, ~1 day |
| **2** | `factory_step_runs` | ⏳ | Fixes the consistency race class of bugs we keep hitting. The hot path. | ~600 LOC, ~2 days |
| **3** | `factory_step_queue` | ⏳ | Atomic claim semantics. Highest risk. Biggest throughput win. | ~800 LOC, ~3 days |
| **4** | `worker_status` | ⏳ | Heartbeats. Tightly local. Could fix recovery sweep flakiness. | ~300 LOC, ~1 day |
| **5** | `factory_jobs.runtime` | ⏳ | Big accumulator. Many writes per run. | ~500 LOC, ~2 days |
| **6** | `factory_job_runs` | ⏳ | Per-run state. Less hot. Mostly cleanup. | ~300 LOC, ~1 day |

**What we DON'T migrate (ever, in this plan):**
- `content_jobs` — external contract with admin UI + mobile app. Stays on Firestore.
- Published collections (`guided_meditations`, `narrators`, `courses`, etc.) — read by mobile app. Stays on Firestore.

---

## Phase 1: `factory_events` (current)

### Why this first

`factory_events` is the safest starting point:
- **Append-only** — no reads, no updates. Each event is independent.
- **Not load-bearing for correctness** — events are audit trail. If a mirror fails, nothing in the pipeline breaks.
- **Admin UI reads are light** — mostly the job-detail step timeline uses it indirectly.
- **High write volume** — every state transition emits an event. Big writer, small reader. Good fit for the dual-write pattern.

If Phase 1 reveals a fundamental flaw in the dual-write approach, we find out without breaking the pipeline.

### What changes

| File | Change |
|---|---|
| `factory_v2/infrastructure/sqlite_repos.py` (NEW) | `SqliteEventRepo` with the same interface as `FirestoreEventRepo`. SQLite schema with indexes on `job_id`, `run_id`, `emitted_at`. |
| `factory_v2/infrastructure/dual_repos.py` (NEW) | `DualEventRepo(primary, mirror)` wrapper. Writes go to primary first (transactional), then mirror (fire-and-forget thread or queue). |
| `factory_v2/infrastructure/firestore_repos.py` | No change. |
| `local_worker.py` + `local_companion.py` | Composition root reads `FACTORY_STORAGE_EVENTS` env var; instantiates `FirestoreEventRepo`, `SqliteEventRepo`, or `DualEventRepo`. Default: `firestore` (no change). |
| `factory_v2/infrastructure/schema/events.sql` (NEW) | DDL for the events table. |
| `tests/test_sqlite_event_repo.py` (NEW) | Parity tests — same fixtures as the Firestore implementation passes. |
| `tests/test_dual_event_repo.py` (NEW) | Tests that writes go to both backends and reads come from primary; mirror failures don't crash. |
| `.gitignore` | `worker/.tmp/factory.db*` (already covered by `worker/.tmp/`). |

### Subtasks (mark as we go)

- [x] Design SQLite schema for `factory_events` (column types, indexes)
- [x] Implement `SqliteEventRepo`
- [x] Unit tests: SQLite parity (9 tests)
- [ ] Implement `DualEventRepo` wrapper
- [ ] Unit tests: dual-write semantics + mirror failure tolerance
- [ ] Add env-var driven composition in `local_worker.py` / `local_companion.py`
- [ ] Integration test: run a job end-to-end with `FACTORY_STORAGE_EVENTS=dual`
- [ ] Compare SQLite vs Firestore event counts after a few runs — they should match exactly
- [ ] Flip default to `dual` once we have confidence
- [ ] Document operational checks (how to inspect events.db, how to detect mirror lag)

### Validation checkpoints

After Phase 1 ships:
1. **Run a normal meditation job with `FACTORY_STORAGE_EVENTS=dual`**. Admin UI should look identical. SQLite db file should have all the same events that Firestore has.
2. **Kill the Firestore connection** (block network temporarily). Worker should keep functioning — SQLite is authoritative.
3. **Inspect mirror lag**: `tail -f` the mirror write log; gap between SQLite write and Firestore mirror should be <500 ms steady state.
4. **Restart the worker mid-job**: on restart, the reconciliation pass should replay any unmirrored events.

### Risks specific to Phase 1

- **SQLite file lock contention.** Multiple workers writing to the same db file. Standard SQLite with WAL mode handles this fine for ≤10 concurrent writers, but worth verifying with a test.
- **Mirror queue grows unboundedly if Firestore is down for hours.** Need a size cap + oldest-drop policy.
- **Reconciliation pass on startup is O(n)** in number of unmirrored rows. Worst case: hours of downtime → minutes to reconcile. Acceptable.

---

## Phases 2-6: detailed plans (TBD when we get there)

Skeletons only for now. Each gets a full plan when its turn comes.

### Phase 2: `factory_step_runs`
Fixes the eventual-consistency race class. Hot path. Read-heavy on `succeeded_shard_keys`, `failed_shard_keys`, `state`. Dual-write writes go to both backends. **Reads must come from SQLite** — that's the whole point.

### Phase 3: `factory_step_queue`
Atomic claim is the riskiest piece. SQLite transactions can implement this, but the contention story is different from Firestore's. May need to introduce a connection pool. Highest-effort phase.

### Phase 4: `worker_status`
Heartbeats. Companion + workers all touch this. Simple schema. Helps recovery_manager and autoscaler decisions get tighter latency.

### Phase 5: `factory_jobs.runtime`
The accumulator. Lots of `patch_runtime` calls. JSON column or normalized? Likely JSON given the dynamic shape. Mirror needs to handle Firestore's dot-notation merge semantics.

### Phase 6: `factory_job_runs`
Mostly straightforward — small state, low volume. Save for last because it's least urgent.

---

## Lessons learned (append as we go)

*(empty for now — populate after each phase)*

### Phase 1 lessons
- **Picking the right SQLite PRAGMAs matters.** `journal_mode=WAL` is non-negotiable for our multi-worker setup (writers don't block readers, writers don't block other writers on different rows). `synchronous=NORMAL` is the right speed/safety tradeoff for an audit log; `FULL` would be 10× slower for negligible safety gain on append-only data.
- **`check_same_thread=False` + a Python lock is simpler than per-thread connections.** The worker has 3 threads that emit (main poll loop, watchdog, recovery sweep). A single connection with a lock is cleaner than threading.local() and we don't pay for cross-thread coordination in SQLite itself.
- **`ensure_ascii=False` in JSON encoding is important.** Meditation scripts contain Korean / Japanese text. Default JSON encoding would store them as `\uXXXX` escapes — ugly when grepping the db. Pinned by test.
- **Schema bootstrap via `CREATE IF NOT EXISTS` is the right pattern.** Idempotent on every boot. Future phases can append their own tables to the same schema string.

---

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-05-11 | Adopted dual-write pattern (SQLite primary, Firestore mirror) instead of full migration. | Admin UI reads from Firestore directly; can't migrate it incrementally. Dual-write preserves UI without forcing a JS rewrite. |
| 2026-05-11 | Phase 1 = `factory_events`, not `factory_step_runs` (which fixes a known bug). | Events is lower risk to validate the dual-write pattern. The race bug already has a surgical fix in `43f4e7b9`. Better to learn the pattern on a safe collection before betting it on the hot path. |
| 2026-05-11 | SQLite db lives at `worker/.tmp/factory.db`. | Same volume as chunk WAVs, already gitignored, persistent across launchd restarts. Override via `FACTORY_DB_PATH`. |
| 2026-05-11 | Out of scope: cross-machine coordination. | Current production is single-host. If we ever need cross-machine, we revisit. |

---

## How to resume this work later (instructions to future-me)

If you're picking this up after a break:

1. **Read this whole doc top-to-bottom.** Architecture decisions are at the top; phase details below.
2. **Check the "Phases overview" table** for current status. Find the phase marked 🔵 NEXT.
3. **Read that phase's "Subtasks" checklist** — what's done, what isn't.
4. **Read the "Lessons learned" section** for that phase if any prior work was done — it documents non-obvious things that bit us.
5. **Start with the first unchecked subtask.** Update the box as you go.
6. **At end of session**, update:
   - The status emoji in the phases table
   - Subtask checkboxes
   - Lessons learned (anything surprising or non-obvious)
   - Decision log (if you made a meaningful choice)
7. **Commit the doc updates alongside the code changes.** The doc is part of the deliverable.

---

## Related reading

- [`README.md`](README.md) — overall worker architecture; section 8 covers storage layout.
- [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](HOW_TO_ADD_A_STEP_TO_PIPELINE.md) — the cross-layer checklist; relevant for repo plumbing.
- Repo-root `FIRESTORE_SCHEMA.md` — current Firestore schema (will need a SQLite parallel as phases ship).
- The earlier "is Firebase the cause of delays" conversation (in session transcript) — the original cost-benefit framing.
