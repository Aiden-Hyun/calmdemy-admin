-- factory_step_runs — SQLite schema for Phase 2 of the storage migration.
-- See worker/LOCAL_STORAGE_MIGRATION.md for the full migration plan.
--
-- One row per (run_id, step_name, shard_key) tuple. Mirrors the
-- factory_step_runs Firestore collection 1:1 — same field names, same
-- semantics, just stored locally so reads are strongly consistent and
-- microseconds-fast.
--
-- The primary key matches the Firestore document id format
-- (run_id__step_name__shard_key) so the composition layer can use the
-- same make_step_run_id() helper for both backends. Reads by step_run_id
-- are point lookups (microseconds in SQLite).
--
-- The composite index mirrors the Firestore composite index used by the
-- orchestrator's hot read paths (succeeded_shard_keys, failed_shard_keys,
-- _shard_keys_by_state). Those queries always have
-- job_id + run_id + step_name + state in the WHERE clause and don't need
-- range scans on any other column, so a four-column btree is the right
-- shape.
--
-- All state-machine values are stored as TEXT without a CHECK constraint.
-- Rationale: adding a new state value (e.g. when we land Phase 4's
-- worker_status integration) shouldn't require a migration. The
-- application layer enforces the state machine; the DB just stores it.

CREATE TABLE IF NOT EXISTS factory_step_runs (
    -- Identity. step_run_id is deterministic:
    -- make_step_run_id(run_id, step_name, shard_key) -> "<run>__<step>__<shard>".
    -- Same format the Firestore implementation uses for its doc id.
    step_run_id          TEXT    PRIMARY KEY,
    job_id               TEXT    NOT NULL,
    run_id               TEXT    NOT NULL,
    step_name            TEXT    NOT NULL,
    shard_key            TEXT    NOT NULL DEFAULT 'root',

    -- State machine. One of: ready, running, succeeded, failed,
    -- retry_scheduled, waiting. (No CHECK — see header note.)
    state                TEXT    NOT NULL,

    -- Retry metadata. attempt starts at 1 on first ensure_ready; bumps
    -- on each mark_retry_scheduled -> mark_running cycle.
    attempt              INTEGER NOT NULL DEFAULT 1,
    next_attempt         INTEGER,
    retry_delay_seconds  INTEGER,

    -- Execution context — null until mark_running.
    worker_id            TEXT,
    queue_id             TEXT,

    -- Lifecycle timestamps. Stored as REAL Unix epoch seconds with
    -- fractional precision; matches Firestore's SERVER_TIMESTAMP
    -- semantically (we just don't get the "set by the server" property —
    -- the application sets these explicitly).
    created_at           REAL    NOT NULL,
    updated_at           REAL    NOT NULL,
    started_at           REAL,
    last_heartbeat_at    REAL,
    deadline_at          REAL,
    ended_at             REAL,

    -- Result / error payloads.
    output               TEXT,   -- JSON-encoded dict; null for non-success states
    error_code           TEXT,
    error_message        TEXT,
    progress_detail      TEXT,

    -- Watchdog mirror — separate from `state` because the watchdog runs
    -- in a different thread and races could otherwise corrupt one field
    -- with stale data from the other. Values: running, succeeded, failed.
    watchdog_state       TEXT
);

-- Composite index that mirrors the Firestore composite index for the
-- orchestrator's hot read paths. Without this, succeeded_shard_keys
-- and friends would do a full-table scan on every call — slow once
-- the table has thousands of rows (a busy day produces ~1000s).
CREATE INDEX IF NOT EXISTS idx_step_runs_by_state
    ON factory_step_runs(job_id, run_id, step_name, state);

-- Secondary index for the watchdog and recovery_manager sweeps that
-- scan by (run_id, state) — e.g. "find all running steps with
-- last_heartbeat_at older than X". Less hot than the composite above
-- but worth indexing because the sweeps run every few seconds.
CREATE INDEX IF NOT EXISTS idx_step_runs_by_run_state
    ON factory_step_runs(run_id, state);

-- Index on last_heartbeat_at for the stale-lease recovery sweep. The
-- sweep query is "WHERE state='running' AND last_heartbeat_at < ?";
-- combined with state filtering above, this lets SQLite scan only
-- the running rows.
CREATE INDEX IF NOT EXISTS idx_step_runs_heartbeat
    ON factory_step_runs(state, last_heartbeat_at)
    WHERE state = 'running';
