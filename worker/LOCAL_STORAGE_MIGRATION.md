# Local storage migration (Firestore → SQLite, incremental)

Living tracking document for the incremental migration of V2 internal state from Firestore to local SQLite. Each phase is independently shippable and the system keeps working after every one.

> **Status: Phase 1 code complete (real-run validation deferred). Phase 2 in progress — schema + SqliteStepRunRepo + DualStepRunRepo + `make_step_run_repo` factory + composition-root wiring done. Integration tests next.**
> Phase 1 default remains `firestore`; flip `FACTORY_STORAGE_EVENTS=dual` to opt in.
> Phase 2 default also `firestore`; flip `FACTORY_STORAGE_STEP_RUNS=dual` to opt in. Code is wired into `worker_main.py` but the default keeps current behavior — deploying main changes nothing.
> Last updated: 2026-05-13

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
| **1** | `factory_events` | 🟢 CODE DONE, pending real-run validation | Safest. Append-only, no reads in hot path, failures are non-fatal (audit log). Proves the dual-write pattern. | ~1500 LOC shipped (4 commits) |
| **2** | `factory_step_runs` | 🟡 IN PROGRESS — schema + SqliteStepRunRepo + DualStepRunRepo + factory + wiring done; integration tests next | Fixes the consistency race class of bugs we keep hitting. The hot path. | ~600 LOC, ~2 days |
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

### Commits

In sequence (read the diffs in this order to understand the build):

| Step | Commit | What landed |
|---|---|---|
| Plan | [`924308fd`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/924308fd) | This doc — initial planning. |
| 1 | [`3f1a47a0`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/3f1a47a0) | `SqliteEventRepo` (inline schema) + 9 parity tests. No wiring. |
| 2 | [`896f508c`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/896f508c) | `DualEventRepo` + generic `MirrorDispatcher` + 13 dual-write tests. No wiring. |
| 3 | [`a35c7ea6`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/a35c7ea6) | `make_event_repo` factory + composition root wiring (`worker_main.py`) + 7 factory tests. **Default still firestore — zero runtime change.** |
| 4 | [`d5368c18`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/d5368c18) | End-to-end integration tests (real SQLite + fake Firestore) + 5 integration tests. |

### What was actually built (code map)

| File | What it does |
|---|---|
| [`factory_v2/infrastructure/sqlite_repos.py`](factory_v2/infrastructure/sqlite_repos.py) | `SqliteEventRepo`. Inline schema (no separate `.sql` file — `CREATE TABLE IF NOT EXISTS` on init). WAL mode, `synchronous=NORMAL`, `check_same_thread=False` + Python lock. Default db path: `worker/.tmp/factory.db` (override via `FACTORY_DB_PATH`). |
| [`factory_v2/infrastructure/dual_repos.py`](factory_v2/infrastructure/dual_repos.py) | Three things: (a) `MirrorDispatcher` — generic background thread + bounded queue + drop-oldest-on-overflow; (b) `DualEventRepo` — thin wrapper composing primary + mirror via the dispatcher; (c) `make_event_repo(db, storage_mode=None)` — factory that reads `FACTORY_STORAGE_EVENTS` and returns the right repo. |
| [`factory_v2/interfaces/worker_main.py`](factory_v2/interfaces/worker_main.py) | Single line changed — `self.event_repo = make_event_repo(db)` instead of `FirestoreEventRepo(db)`. This is the only production-code edit. |
| [`tests/test_sqlite_event_repo.py`](tests/test_sqlite_event_repo.py) | 9 tests. Parity against the interface contract. |
| [`tests/test_dual_event_repo.py`](tests/test_dual_event_repo.py) | 13 tests. Dual-write semantics, mirror failure tolerance, ordering, queue overflow, async-ness (timing assertion), lifecycle. |
| [`tests/test_event_repo_factory.py`](tests/test_event_repo_factory.py) | 7 tests. Env-var dispatch, unknown values, case sensitivity, default-firestore safety. |
| [`tests/test_event_repo_integration.py`](tests/test_event_repo_integration.py) | 5 tests. Real SQLite + fake Firestore mirror, realistic event sequence (single job, 5 concurrent jobs, intermittent mirror failures). |

### Env vars and config introduced

| Var | Default | Effect |
|---|---|---|
| `FACTORY_STORAGE_EVENTS` | `firestore` | One of `firestore` / `sqlite` / `dual` (case-insensitive). Picks the events-repo backend. Unknown values log a warning + fall back to `firestore`. |
| `FACTORY_STORAGE_STEP_RUNS` *(Phase 2)* | `firestore` | One of `firestore` / `sqlite` / `dual` (case-insensitive). Picks the step-runs-repo backend. Independent of `FACTORY_STORAGE_EVENTS` — flip them separately. |
| `FACTORY_DB_PATH` | `worker/.tmp/factory.db` | Override the SQLite file location. Mostly for tests. |

### Subtasks (mark as we go)

- [x] Design SQLite schema for `factory_events` (column types, indexes)
- [x] Implement `SqliteEventRepo`
- [x] Unit tests: SQLite parity (9 tests)
- [x] Implement `DualEventRepo` wrapper + generic `MirrorDispatcher`
- [x] Unit tests: dual-write semantics + mirror failure tolerance (13 tests)
- [x] `make_event_repo()` factory + composition root wiring in `worker_main.py`
- [x] Factory tests: env-var dispatch, unknown values, case sensitivity (7 tests)
- [x] Integration test: dual mode with real SQLite + fake Firestore mirror (5 tests)
- [ ] Validate on a real run: flip `FACTORY_STORAGE_EVENTS=dual` in plist, kick a meditation job, compare SQLite vs Firestore event counts — must match exactly
- [ ] Flip default to `dual` once we have a few successful runs
- [ ] Document operational checks (how to inspect events.db, how to detect mirror lag)

### Operational playbook — how to actually flip Phase 1

To enable dual-write events on a real worker:

1. Edit `~/Library/LaunchAgents/com.calmdemy.companion.plist`. Inside the existing `EnvironmentVariables` `<dict>` block, add:

   ```xml
   <key>FACTORY_STORAGE_EVENTS</key>
   <string>dual</string>
   ```

2. Restart the companion:

   ```bash
   launchctl kickstart -k gui/$(id -u)/com.calmdemy.companion
   ```

3. Confirm the worker booted in dual mode (look for the log line printed by the factory):

   ```bash
   grep "events repo:" worker/logs/local_worker_*.log | tail -3
   # Should print: "events repo: dual (SQLite primary + Firestore mirror)"
   ```

4. Run a meditation job through admin UI. When it completes, validate parity:

   ```bash
   # Total event count in SQLite
   sqlite3 worker/.tmp/factory.db "SELECT COUNT(*) FROM factory_events"

   # Distribution by event type (sanity check on shape)
   sqlite3 worker/.tmp/factory.db \
     "SELECT event_type, COUNT(*) FROM factory_events GROUP BY event_type ORDER BY 2 DESC"

   # Events for a specific job (replace JOBID)
   sqlite3 worker/.tmp/factory.db \
     "SELECT event_type, created_at FROM factory_events WHERE job_id='JOBID' ORDER BY created_at"
   ```

   Compare to the same job's events in Firestore's `factory_events` collection. Counts should match exactly. If they don't, see the troubleshooting section below.

5. After 3+ successful runs with matching counts, change the default in `make_event_repo` from `"firestore"` to `"dual"` (one-line edit in `dual_repos.py`). Land that as a separate small commit. Now everyone gets dual by default.

### Operational checks — how to inspect / debug

| Question | How to answer |
|---|---|
| Is the dispatcher keeping up? | The dispatcher exposes a `metrics()` dict: `queue_size`, `drops`, `failures`, `success`. To surface in production, we'd thread it through a status endpoint (not done yet — TBD). |
| Where's the SQLite file? | `worker/.tmp/factory.db` (or wherever `FACTORY_DB_PATH` points). Survives launchd restarts. |
| Did the mirror lose any events? | If `mirror.drops + mirror.failures > 0` after a run, some events didn't reach Firestore. SQLite still has them. Admin UI will be missing those rows. |
| How big can the SQLite db get? | One event ≈ 200 bytes. A 50-event job → 10 KB. 1000 jobs → 10 MB. Not a concern at current scale. WAL mode keeps writes fast even at GB sizes. |

### Troubleshooting Phase 1

| Symptom | Likely cause | What to check |
|---|---|---|
| Worker boot log shows `events repo: firestore` despite the env var | Plist edit didn't take, or `launchctl kickstart` didn't reload | `launchctl list \| grep calmdemy` — check the PID changed; `cat ~/Library/LaunchAgents/com.calmdemy.companion.plist \| grep FACTORY_STORAGE` |
| SQLite count ≠ Firestore count after a job | Mirror failures during the run | Inspect dispatcher metrics; check `local_worker_*.log` for `"mirror dispatch failed"` warnings |
| `worker/.tmp/factory.db` doesn't exist after the worker started | Worker still in firestore mode, or `FACTORY_DB_PATH` points elsewhere | See first symptom + `echo $FACTORY_DB_PATH` |
| `sqlite3` reports "database is locked" | Another process has an exclusive lock | WAL mode shouldn't cause this; check `ps` for orphan worker processes |
| Tests fail with "no module named factory_v2" | Forgot to activate `.venv` | `cd worker && .venv/bin/python -m unittest discover -s tests` (the venv's Python, not system Python 3.9) |

### Risks specific to Phase 1 (with mitigations)

- **SQLite file lock contention.** Multiple workers writing to the same db file. WAL mode (set on init in `SqliteEventRepo`) handles this fine for ≤10 concurrent writers. We have at most 6 worker stacks; well within tolerance. Not validated under contention yet — Phase 1 step 5 (real-run validation) will exercise this.
- **Mirror queue grows unboundedly if Firestore is down for hours.** Mitigated: bounded queue (10k default, configurable via `DualEventRepo(max_queue=N)`) + drop-oldest-on-overflow.
- **Worker crash between SQLite write and Firestore mirror.** Last-few events lost from Firestore but kept in SQLite. Acceptable for audit-only data. Future phases (step_runs, state-bearing collections) will revisit this with a reconciliation pass on boot.

---

## Phase 2: `factory_step_runs` (next up — detailed plan)

The hot path. **This is the migration that fixes the eventual-consistency race we keep hitting** (already mitigated surgically in [`43f4e7b9`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/43f4e7b9), but Phase 2 closes it structurally — reads from SQLite never see stale state).

### What's reused from Phase 1 (no new work)

- **`MirrorDispatcher`** — generic, already handles bounded queue, drop-oldest, daemon thread, failure tolerance. Just instantiate a new one named `"step_runs"`.
- **Factory pattern** — copy `make_event_repo` shape into `make_step_run_repo`. Same env-var-or-explicit-arg signature. Same case normalization, same unknown-value fallback behavior.
- **Composition root wiring** — same one-line edit in `worker_main.py`.
- **Test scaffolding** — copy the integration-test structure (real SQLite + fake Firestore + simulated load) and adapt for step_runs.
- **PRAGMAs and connection setup** — same WAL / NORMAL / check_same_thread pattern.

### What's NEW in Phase 2

- **Schema is more complex.** Events is one append-only table. step_runs is mutable (`ready → running → succeeded`/`failed`) and queried by composite indexes (`job_id + run_id + step_name + state`). Need to think about which composite indexes are critical for query latency.
- **Read paths matter.** This is where the eventual-consistency win actually lives. The orchestrator calls `succeeded_shard_keys`, `failed_shard_keys`, `state`, `has_succeeded` — all reads. In dual mode, these MUST read from SQLite, otherwise we get the same Firestore lag as before.
- **Update semantics.** `mark_running`, `mark_succeeded`, `mark_failed`, `mark_retry_scheduled` — multiple state transitions. The mirror must replay them in order; the dispatcher's FIFO queue handles this within one repo, but cross-method ordering needs verification.
- **`heartbeat` is high-frequency.** The watchdog calls `heartbeat` every ~2s per running step. Volume is much higher than events. Mirror queue sizing may need adjustment.
- **`ensure_ready` uses `create()` semantics** (idempotent create). SQLite's equivalent is `INSERT OR IGNORE` then a SELECT. Different mental model.
- **`batch_mark_succeeded_from_checkpoint`** (introduced in [`d8424f96`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/d8424f96)). Must work in SQLite too — and in SQLite it's nearly free vs Firestore's network round-trips. Phase 2 is where the restart-latency win actually materializes.

### Commits

In sequence (read the diffs in this order to understand the build):

| Step | Commit | What landed |
|---|---|---|
| 1 | [`018065d5`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/018065d5) | `schema/step_runs.sql` (22 cols, 3 indexes, partial index for stale-lease sweep) + 8 schema-validity tests including EXPLAIN QUERY PLAN check. |
| 2 | [`c9c3d3ff`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/c9c3d3ff) | `SqliteStepRunRepo` — all 14 methods of `FirestoreStepRunRepo` reimplemented against SQLite. Schema loader refactored to read `schema/*.sql` files. 33 parity tests across 7 test classes (id helpers, ensure_ready, state transitions, checkpoint UPSERT, read paths, delete, concurrency, id parsing). |
| 3 | [`51f73d75`](https://github.com/Aiden-Hyun/calmdemy-admin/commit/51f73d75) | `DualStepRunRepo` — composes `SqliteStepRunRepo` (primary) + `FirestoreStepRunRepo` (mirror). Writes dispatch to both; reads go to primary ONLY (this is the structural race fix). Reuses the generic `MirrorDispatcher` from Phase 1 unchanged. 21 tests across 5 classes pin: writes-to-both for every method (11), reads-from-primary-only for every read (5), mirror failure tolerance (3), async non-blocking timing (1), FIFO ordering (1). Constructor rejects `None` for either backend. No wiring yet — no factory means nothing imports this class. |
| 4 | (this commit) | `make_step_run_repo` factory + composition-root wiring. `FACTORY_STORAGE_STEP_RUNS` env var (firestore / sqlite / dual). Single-line change in `worker_main.py`: `self.step_run_repo = make_step_run_repo(db)`. 9 factory tests pin default-firestore safety (including "default mode never touches SQLite"), explicit-mode dispatch, env-var read + case-insensitive normalization, unknown-value warn-and-fall-back, dual-mode wiring (SQLite primary + Firestore mirror — pinned both directions), and cross-factory independence (events ↔ step_runs env vars are decoupled). **Default still `firestore` — zero runtime change.** |

### Subtask plan for Phase 2

Same shape as Phase 1:

- [x] **Design SQLite schema for `factory_step_runs`** — separate `.sql` file (per Phase 1 retrospective lesson). 22 columns, 3 indexes (primary composite + 2 secondary), schema-validity tests including EXPLAIN QUERY PLAN. Lives at [`schema/step_runs.sql`](factory_v2/infrastructure/schema/step_runs.sql).
- [x] **Implement `SqliteStepRunRepo`** with all 14 methods of the Firestore one. Lives in [`sqlite_repos.py`](factory_v2/infrastructure/sqlite_repos.py). Parity tests (33) cover state transitions, ensure_ready idempotency, checkpoint UPSERT semantics, read-path correctness with realistic mixed-state data, batch operations up to 1500 rows, multi-threaded concurrent writes, and the step_run_id parse helper.
- [x] **Implement `DualStepRunRepo`** — same dual-write pattern as `DualEventRepo`, but with **read methods that go to the primary (SQLite) ONLY — never to the mirror**. **This is where the consistency-race bug is fixed structurally.** Lives in [`dual_repos.py`](factory_v2/infrastructure/dual_repos.py) alongside `DualEventRepo`. 21 tests cover: every write method dispatches to both backends (11), every read method goes to primary only and ignores mirror state (5), mirror failure tolerance (3), async non-blocking via timing assertion (1), and FIFO ordering of state transitions (1).
- [x] **`make_step_run_repo` factory** + composition root wiring. `FACTORY_STORAGE_STEP_RUNS` env var. Default `firestore`. Same 3-mode dispatch as `make_event_repo` (firestore / sqlite / dual). Wired in [`worker_main.py`](factory_v2/interfaces/worker_main.py) — single-line change to `self.step_run_repo = make_step_run_repo(db)`. 9 factory tests pin the default-firestore safety contract (including "default mode never touches SQLite"), explicit modes, env-var dispatch with case-insensitive normalization, unknown-value warn-and-fall-back, dual-mode wiring (SQLite primary + Firestore mirror — pinned both directions), and a cross-factory independence test that flipping `FACTORY_STORAGE_EVENTS` does NOT affect `FACTORY_STORAGE_STEP_RUNS` and vice versa.
- [ ] **Integration tests** — orchestrator runs against the dual repo, verify reads come from SQLite (no race), writes land in both, mirror failures don't break the pipeline.
- [ ] **Real-run validation** — flip the env var, run a few jobs, compare row counts.
- [ ] **Flip default to `dual`** after confidence.

### Risks specific to Phase 2

- **Read-path correctness is load-bearing.** If `succeeded_shard_keys` reads from SQLite but the orchestrator's logic accidentally branches based on something written to Firestore-only, we get split-brain. Must audit every read site.
- **Heartbeat write rate may pressure the mirror queue.** 6 workers × 1 step each × 0.5 Hz = 3 mirror writes/sec from heartbeats alone. Plus state transitions. Total mirror write rate during a busy job might hit 10-20/sec. Well within Firestore capacity but worth measuring.
- **Schema migration story.** Once we have a `factory.db` from Phase 1 with just events table, Phase 2 adds step_runs table to the same db. `CREATE TABLE IF NOT EXISTS` handles this for greenfield; existing installations will pick it up on next boot via the inline schema bootstrap.

---

## Phases 3-6: skeletons (planned when their turn comes)

### Phase 3: `factory_step_queue`
Atomic claim is the riskiest piece. SQLite transactions can implement this, but the contention story is different from Firestore's (no `runTransaction` with exponential backoff — need explicit retry). May need to introduce a connection pool for the queue claim hot path. Highest-effort phase.

### Phase 4: `worker_status`
Heartbeats. Companion + workers all touch this. Simple schema. Helps recovery_manager and autoscaler decisions get tighter latency.

### Phase 5: `factory_jobs.runtime`
The accumulator. Lots of `patch_runtime` calls with arbitrary nested keys. JSON column or normalized? Likely JSON given the dynamic shape. Mirror needs to handle Firestore's dot-notation merge semantics — SQLite JSON1 extension's `json_patch` is close but not identical.

### Phase 6: `factory_job_runs`
Mostly straightforward — small state, low volume. Save for last because it's least urgent.

---

## Phase 1 retrospective (after code-complete)

**What worked:**
- **Five-step sequencing (schema → SqliteRepo → DualRepo → factory → integration tests) kept each commit small enough to review independently.** Each commit was a clean checkpoint that could be reverted without affecting earlier ones.
- **Default-firestore safety contract.** Pinning `test_default_returns_firestore_event_repo` and `test_default_mode_never_touches_sqlite` means we landed all this code without changing runtime behavior — anyone can deploy main and not notice.
- **Generic `MirrorDispatcher` design paid off in the same phase.** Used by `DualEventRepo` and will be reused unchanged by Phase 2's `DualStepRunRepo`. Probably also Phase 3 (queue).
- **34 tests in 4 commits.** High test-to-code ratio for migration work. Each test pins a *specific contract* (drop-oldest, async-ness timing, default safety, etc.) rather than just "happy path works."

**What was harder than expected:**
- **Threading semantics around close/flush.** Got the order wrong on first attempt — set `_stop` before flushing, which made the consumer exit before draining. Fixed by flushing first, then stopping. Pinned by `test_close_flushes_pending_writes`.
- **Test isolation for SQLite path.** Multiple tests sharing a `factory.db` file would interfere. Solved with per-test `tempfile.TemporaryDirectory` + `FACTORY_DB_PATH` env override. Worth standardizing this pattern for Phase 2.

**What we should do differently in Phase 2:**
- **Land a `tests/_fixtures.py` first** with the temp-db / env-override boilerplate, instead of duplicating it across each test file.
- **Surface dispatcher metrics in `worker_status`** so operators can see queue depth in real time without reading code. Tracked as a "would be nice" but not blocking Phase 2.
- **Define schema in a separate `.sql` file** for the more complex Phase 2 schema. Inline strings worked fine for events' single table, but step_runs' multi-index schema will be more readable as a standalone file with comments.

---

## Lessons learned (append as we go)

### Phase 1 lessons
- **Picking the right SQLite PRAGMAs matters.** `journal_mode=WAL` is non-negotiable for our multi-worker setup (writers don't block readers, writers don't block other writers on different rows). `synchronous=NORMAL` is the right speed/safety tradeoff for an audit log; `FULL` would be 10× slower for negligible safety gain on append-only data.
- **`check_same_thread=False` + a Python lock is simpler than per-thread connections.** The worker has 3 threads that emit (main poll loop, watchdog, recovery sweep). A single connection with a lock is cleaner than threading.local() and we don't pay for cross-thread coordination in SQLite itself.
- **`ensure_ascii=False` in JSON encoding is important.** Meditation scripts contain Korean / Japanese text. Default JSON encoding would store them as `\uXXXX` escapes — ugly when grepping the db. Pinned by test.
- **Schema bootstrap via `CREATE IF NOT EXISTS` is the right pattern.** Idempotent on every boot. Future phases can append their own tables to the same schema string.
- **Generic `MirrorDispatcher` pays off immediately.** Built as a separate class composed by `DualEventRepo` rather than baked into it. Future phases (step_runs, queue) get the same bounded-queue, drop-oldest, daemon-thread, failure-tolerant behavior for free.
- **Drop OLDEST on overflow, not newest.** When Firestore is slow and the queue fills up, the *recent* events are usually the most diagnostically valuable. Pinned by test (`test_queue_overflow_drops_oldest`) — `i=9` (newest) must reach the mirror even after dropping several earlier events.
- **Daemon thread + `close()` flush handles both lifecycles.** Production SIGTERM: daemon dies, last few events lost (audit log; acceptable). Tests / graceful shutdown: `close()` blocks until queue drains. Both modes work without conditional logic in the consumer.
- **Pin async-ness with a timing assertion.** `test_slow_mirror_does_not_slow_primary_path` — 5 emits against a 500ms-per-call mirror complete in <200ms total. Catches accidental refactors that wait on the mirror.
- **Counter atomicity in CPython.** `_drops`, `_failures`, `_success` are integers; `x += 1` is atomic enough on CPython (GIL serializes the bytecode). No lock needed for metrics. Documented in code so future-me doesn't add unnecessary locking.
- **Default-firestore is the safety guarantee.** The `make_event_repo` factory defaults to `firestore` when the env var is unset, so landing this code touches zero runtime behavior. Pinned by `test_default_returns_firestore_event_repo` — that test is the contract for "this commit is safe to deploy without flipping anything."
- **Unknown env-var values fall through, not crash.** A typo in the plist (e.g. `dual_sqlite` instead of `dual`) shouldn't bring the worker down at boot. The factory logs a warning and uses Firestore. Pinned by `test_unknown_mode_falls_back_to_firestore_with_warning`.
- **Env-var dispatch is lower-cased; explicit `storage_mode=` is not.** Real config sources (plist, .env files) often have inconsistent casing. The env-var path normalizes to lowercase. Explicit calls (only tests) stay strict so we don't accidentally hide a bug.
- **The integration test uses REAL SQLite, FAKE Firestore.** Halfway between unit and full e2e. SQLite is cheap to spin up per-test (`tempfile.TemporaryDirectory`), Firestore is not. Confidence-cost ratio is high — we exercise the actual SQLite implementation, schema, file I/O, but don't need network access or service-account credentials.
- **"Default mode never touches SQLite" is a safety test, not just a behavior test.** Pinning that the SQLite file does not exist after a default-mode emit means deploying this code can't accidentally start dual-writing on a machine where the operator hasn't opted in. Tests like this one protect the "land code, don't change behavior" contract.

### Phase 2 lessons (so far)
- **Schema in a separate `.sql` file paid off immediately.** Phase 2's step_runs table is 22 cols + 3 indexes including a partial index. As a Python string literal it would be unreadable; as a `.sql` file with SQL comments explaining each index, it's reviewable on its own. The `_load_schema_file` helper added in step 2 also positions us to drop in Phase 3-6 tables (`step_queue.sql`, `worker_status.sql`, etc.) without touching `sqlite_repos.py` boilerplate.
- **`MirrorDispatcher` was reused verbatim.** Zero changes. The Phase 1 retrospective predicted this; Phase 2 step 3 confirms it. Future phases (queue, status) get the same treatment.
- **`DualStepRunRepo` reads MUST bypass the mirror entirely.** Not "prefer primary, fall back to mirror" — primary ONLY. If we ever route a read to the mirror, we re-open the eventual-consistency race we just closed. Pinned by `test_reads_unaffected_by_mirror_being_broken` (mirror raises on every read; dual repo still returns the right value because reads never touch it).
- **`batch_mark_succeeded_from_checkpoint` must snapshot inputs defensively before deferring the mirror call.** The mirror write runs later on the dispatcher thread — if the caller mutates the entries list after our sync return (rare but possible), the mirror would write the mutated version. Cheap fix: `list(entries)` at the sync site. Pinned by `test_batch_snapshot_caller_can_reuse_list`.
- **Primary errors propagate; mirror errors don't.** Same rule as Phase 1, restated for the hot path: if SQLite write fails, the orchestrator must see the exception so the step can be retried. If Firestore mirror fails, the worker continues — admin UI loses one row, but the worker's source of truth is intact.
- **Per-collection env vars need a cross-factory independence test.** It's tempting to assume "two factories, two env vars, obviously independent" — but a future refactor could collapse them onto a shared base class with a single env var read, silently coupling them. Pinned by `test_events_and_step_runs_env_vars_are_independent` (flip one, the other stays default; flip the other, the first stays default). Cheap test, real footgun prevention.
- **The composition-root wiring change is one line.** Same shape as Phase 1 step 3 in `worker_main.py`: `FirestoreStepRunRepo(db)` → `make_step_run_repo(db)`. The factory absorbs all the dispatch logic. Anyone reviewing the diff sees "factory call replaces direct constructor" and that's the whole production-code change. Default-firestore keeps the contract intact: deploying this commit changes nothing until an operator sets the env var.

---

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-05-11 | Adopted dual-write pattern (SQLite primary, Firestore mirror) instead of full migration. | Admin UI reads from Firestore directly; can't migrate it incrementally. Dual-write preserves UI without forcing a JS rewrite. |
| 2026-05-11 | Phase 1 = `factory_events`, not `factory_step_runs` (which fixes a known bug). | Events is lower risk to validate the dual-write pattern. The race bug already has a surgical fix in `43f4e7b9`. Better to learn the pattern on a safe collection before betting it on the hot path. |
| 2026-05-11 | SQLite db lives at `worker/.tmp/factory.db`. | Same volume as chunk WAVs, already gitignored, persistent across launchd restarts. Override via `FACTORY_DB_PATH`. |
| 2026-05-11 | Out of scope: cross-machine coordination. | Current production is single-host. If we ever need cross-machine, we revisit. |
| 2026-05-12 | Per-collection env var (`FACTORY_STORAGE_EVENTS`) rather than one global flag. | Lets each phase migrate independently; rolling back one collection doesn't force rolling back others. Future phases get their own `FACTORY_STORAGE_STEP_RUNS`, etc. |
| 2026-05-12 | Mirror writes use `set` + `merge=True` semantics (in the underlying `FirestoreEventRepo.emit`), but each backend generates its own id. | Matching ids across backends would require coordinating writes — extra complexity for marginal cross-reference benefit. If we ever need it, add a `mirror_id` column to the SQLite schema later. |
| 2026-05-12 | `MirrorDispatcher` runs as a daemon thread, not joined on shutdown. | macOS launchd SIGTERMs us; we don't have a clean shutdown signal to flush. Audit log losing the last few events on hard restart is acceptable. Tests use explicit `close()` for deterministic flush. |
| 2026-05-12 | Phase 2 = `factory_step_runs`. | Highest-impact next: fixes the eventual-consistency race class structurally, exercises the read-from-primary path that all subsequent phases share. |

---

## How to resume this work later (instructions to future-me)

### General workflow

1. **Read this whole doc top-to-bottom.** Architecture decisions are at the top; phase details below.
2. **Check the "Phases overview" table** for current status. Find the phase marked 🔵 NEXT.
3. **Read that phase's "Subtasks" checklist** — what's done, what isn't.
4. **Read the "Lessons learned" + "Phase X retrospective" sections** for any prior phases — they document non-obvious things that bit us and patterns to reuse.
5. **Start with the first unchecked subtask.** Update the box as you go.
6. **At end of session**, update:
   - Status emoji in the phases table
   - Subtask checkboxes
   - Lessons learned (anything surprising or non-obvious)
   - Decision log (if you made a meaningful choice)
   - Commit log section of the current phase
7. **Commit the doc updates alongside the code changes.** The doc is part of the deliverable.

### Where to pick up right now (as of last update)

**Phase 1 status: code complete. Pending real-run validation before promoting `dual` to default.**

If you want to:

- **Validate Phase 1 end-to-end** → follow the "Operational playbook" section in the Phase 1 docs. Flip the env var, run a meditation, compare counts.
- **Promote Phase 1 default to `dual`** → after 3+ successful runs with matching counts: edit `make_event_repo` in `dual_repos.py` to default to `"dual"` instead of `"firestore"`. One-line change. Commit as `worker: promote events repo dual mode to default`.
- **Start Phase 2** → read "Phase 2: `factory_step_runs`" section above. Subtask plan is laid out. Begin with subtask 1 (schema design). Reuse `MirrorDispatcher`, `make_*_repo` factory pattern, integration-test scaffolding from Phase 1 — those are documented as "what's reused."

### Files that matter for picking up

- This doc — context + plan + history.
- `worker/factory_v2/infrastructure/sqlite_repos.py` — reference SQLite implementation.
- `worker/factory_v2/infrastructure/dual_repos.py` — reference dual-write pattern.
- `worker/tests/test_event_repo_*.py` — reference test patterns to copy for new phases.
- `worker/factory_v2/interfaces/worker_main.py` line 124-ish — composition root, where new factories get wired.

---

## Related reading

- [`README.md`](README.md) — overall worker architecture; section 8 covers storage layout.
- [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](HOW_TO_ADD_A_STEP_TO_PIPELINE.md) — the cross-layer checklist; relevant for repo plumbing.
- Repo-root `FIRESTORE_SCHEMA.md` — current Firestore schema (will need a SQLite parallel as phases ship).
- The earlier "is Firebase the cause of delays" conversation (in session transcript) — the original cost-benefit framing.
