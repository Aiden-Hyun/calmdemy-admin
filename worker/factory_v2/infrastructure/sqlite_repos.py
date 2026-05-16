"""SQLite-backed implementations of the V2 repository interfaces.

Part of the incremental Firestore → SQLite migration. See
``worker/LOCAL_STORAGE_MIGRATION.md`` for the full plan, phasing,
and rationale. The headline:

- Each class here mirrors its Firestore sibling in ``firestore_repos.py``
  with the same public method signatures.
- The composition root (``local_worker.py``, ``local_companion.py``)
  picks a backend per collection via env var.
- The admin UI continues to read from Firestore directly; SQLite is the
  worker's primary, Firestore is a best-effort mirror (wired by
  ``DualRepo`` wrappers in a separate module).

Connection model:
- One SQLite file at ``worker/.tmp/factory.db`` by default (override with
  ``FACTORY_DB_PATH``). Same volume as chunk WAVs, gitignored, persists
  across launchd restarts.
- WAL journal mode so multiple worker subprocesses on the same machine
  can append without blocking each other.
- ``synchronous=NORMAL`` for a ~10× write speedup over ``FULL`` at the
  cost of a tiny crash-window risk (acceptable for the audit log).
- Threading: a per-repo lock serializes writes so the main poll loop,
  the watchdog thread, and the recovery sweep don't corrupt the
  connection. WAL allows readers to bypass the writer.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path


def _default_db_path() -> Path:
    """Resolve the SQLite file path, honoring ``FACTORY_DB_PATH``.

    Anchored relative to this source file (not CWD), so the worker
    always finds the same DB regardless of where it was launched from.
    """
    override = os.getenv("FACTORY_DB_PATH", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    # __file__ → factory_v2/infrastructure/sqlite_repos.py.
    # parents[2] → worker/. Sibling to .venv/, logs/, .tmp/.
    return Path(__file__).resolve().parents[2] / ".tmp" / "factory.db"


# Schema for Phase 1 (factory_events). Inline because the events table
# is tiny and predates the schema/ directory convention adopted in
# Phase 2. Later phases load their schema from schema/*.sql files
# (see _SCHEMA_DIR below).
_PHASE1_SCHEMA = """
CREATE TABLE IF NOT EXISTS factory_events (
    id          TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_job_id   ON factory_events(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run_id   ON factory_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created  ON factory_events(created_at);
"""

# Phase 2+: schemas live in their own .sql files next to this module.
# Loaded at connection-open time. Per the Phase 1 retrospective, the
# multi-table / multi-index schemas are easier to read as standalone
# SQL with real comments than as Python triple-quoted strings.
_SCHEMA_DIR = Path(__file__).resolve().parent / "schema"


def _load_schema_file(filename: str) -> str:
    """Read a schema/*.sql file. Raises if missing — fail-loud so a
    deployment with a partial install surfaces immediately at boot."""
    path = _SCHEMA_DIR / filename
    return path.read_text()


def _open_connection(db_path: Path) -> sqlite3.Connection:
    """Open and bootstrap a SQLite connection.

    Creates the parent directory if missing, enables WAL+NORMAL, and
    applies every phase's schema (idempotent via CREATE IF NOT EXISTS).
    Returns a connection configured for cross-thread use; callers must
    serialize their own writes with a lock.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False lets the watchdog thread emit too. The
    # caller wraps writes in a lock — a single connection across threads
    # is safe with that pattern, faster than per-thread connections.
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    # WAL: writers don't block readers, readers don't block writers.
    # Essential for multi-worker setups on a single host.
    conn.execute("PRAGMA journal_mode=WAL")
    # NORMAL fsyncs at commit time but not within transactions. Trades a
    # narrow window of in-flight data on power loss for much faster commits.
    conn.execute("PRAGMA synchronous=NORMAL")
    # Apply schemas in phase order. CREATE IF NOT EXISTS makes each safe
    # to re-run on every boot.
    conn.executescript(_PHASE1_SCHEMA)
    conn.executescript(_load_schema_file("step_runs.sql"))
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Internal helpers shared across repos
# ---------------------------------------------------------------------------


def _datetime_to_epoch(value) -> float | None:
    """Convert a datetime (with or without tz) to Unix epoch seconds.

    Application code occasionally passes naive datetimes from older
    callers; assume UTC for those rather than crashing. Returns None
    for None input — lets callers pass through optional fields.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    # datetime.datetime
    try:
        if value.tzinfo is None:
            from datetime import timezone
            value = value.replace(tzinfo=timezone.utc)
        return value.timestamp()
    except AttributeError:
        raise TypeError(f"expected datetime or numeric, got {type(value).__name__}")


class SqliteEventRepo:
    """SQLite-backed implementation of the V2 events log.

    Matches ``FirestoreEventRepo.emit`` exactly:

        def emit(event_type: str, job_id: str, run_id: str, payload: dict) -> str

    Differences from Firestore:
    - IDs are 32-char hex UUID4 instead of Firestore's 20-char id.
      Semantically equivalent (opaque unique strings); callers don't
      depend on the format.
    - ``created_at`` is a local Python timestamp (``time.time()``)
      instead of Firestore's SERVER_TIMESTAMP. For audit-log purposes
      this is fine; if cross-machine clock drift becomes an issue we'd
      address it via NTP, not the storage layer.

    Append-only: no update or delete methods. By design — events are
    immutable history.
    """

    def __init__(self, db_path: Path | str | None = None):
        path = Path(db_path) if db_path else _default_db_path()
        self._conn = _open_connection(path)
        # Single lock serializes all writes through this repo instance.
        # SQLite + WAL handles inter-process contention; this lock just
        # handles intra-process thread safety (main + watchdog + sweep).
        self._lock = threading.Lock()

    def emit(self, event_type: str, job_id: str, run_id: str, payload: dict) -> str:
        """Append one event row. Returns the row's id."""
        event_id = uuid.uuid4().hex
        created_at = time.time()
        # JSON payload is encoded once here so callers don't have to
        # think about the wire format. ensure_ascii=False keeps unicode
        # (e.g. Korean text in meditation scripts) readable in the file.
        payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        with self._lock:
            self._conn.execute(
                "INSERT INTO factory_events "
                "(id, event_type, job_id, run_id, payload, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (event_id, event_type, job_id, run_id, payload_json, created_at),
            )
            self._conn.commit()
        return event_id

    def close(self) -> None:
        """Close the underlying connection. Mainly for tests; production
        repos live for the worker process lifetime."""
        with self._lock:
            self._conn.close()


# ---------------------------------------------------------------------------
# Step-run repository (Phase 2)
# ---------------------------------------------------------------------------


class SqliteStepRunRepo:
    """SQLite-backed implementation of the V2 step-run repository.

    Method-for-method parity with ``FirestoreStepRunRepo``. The semantic
    differences boil down to:

    - **Strong read-after-write consistency.** Every read sees every
      prior write from the same connection. This is the property that
      structurally closes the eventual-consistency race that
      ``43f4e7b9`` patched surgically — once Phase 2 ships and reads
      route through SQLite, the union-just-succeeded-shard workaround
      becomes a belt-and-suspenders rather than a load-bearing fix.

    - **Timestamps are application-set (``time.time()``) rather than
      ``SERVER_TIMESTAMP``.** Same trade-off as the events repo:
      cross-machine clock drift is an NTP problem, not a storage one.

    - **`ensure_ready` uses ``INSERT OR IGNORE``** rather than
      ``create() + catch AlreadyExists``. Same idempotent semantics,
      no exception handling needed.

    - **`mark_succeeded_from_checkpoint` and `batch_mark_succeeded_from_checkpoint`
      use SQLite UPSERT** (``INSERT ... ON CONFLICT DO UPDATE``) because
      they're called without a prior ``ensure_ready``. Firestore's
      ``set(merge=True)`` has the same semantics — create if absent,
      update if present.

    - **Batched checkpoint writes don't need the 500-row chunking** the
      Firestore version does (Firestore's hard batch limit). One big
      SQLite transaction handles any number of rows efficiently. We
      keep the function signature identical so the orchestrator's
      callers don't change.
    """

    def __init__(self, db_path: Path | str | None = None):
        path = Path(db_path) if db_path else _default_db_path()
        self._conn = _open_connection(path)
        self._lock = threading.Lock()

    # ------------- identity / id helpers ----------------

    @staticmethod
    def make_step_run_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
        """Same deterministic format as the Firestore implementation so
        composition-layer callers can use one helper for both backends."""
        return f"{run_id}__{step_name}__{shard_key}"

    # ------------- write methods ----------------

    def ensure_ready(self, job_id: str, run_id: str, step_name: str, shard_key: str = "root") -> str:
        """Idempotent create. Returns the step_run_id.

        ``INSERT OR IGNORE`` is the SQLite equivalent of Firestore's
        ``create() + catch AlreadyExists``: subsequent calls with the
        same key are no-ops, preserving the original ``created_at``
        and ``attempt``."""
        step_run_id = self.make_step_run_id(run_id, step_name, shard_key)
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT OR IGNORE INTO factory_step_runs (
                    step_run_id, job_id, run_id, step_name, shard_key,
                    state, attempt, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'ready', 1, ?, ?)
                """,
                (step_run_id, job_id, run_id, step_name, shard_key, now, now),
            )
            self._conn.commit()
        return step_run_id

    def mark_running(
        self,
        step_run_id: str,
        queue_id: str,
        worker_id: str,
        attempt: int = 1,
        *,
        started_at=None,
        deadline_at=None,
    ) -> None:
        """Transition to ``running`` + initialize watchdog fields.

        Clears prior-attempt error / retry fields so reads of the row
        always reflect the current execution. Matches the Firestore
        ``mark_running`` field set exactly."""
        now = time.time()
        started_ts = _datetime_to_epoch(started_at) if started_at is not None else now
        deadline_ts = _datetime_to_epoch(deadline_at)
        with self._lock:
            self._conn.execute(
                """
                UPDATE factory_step_runs SET
                    state = 'running',
                    queue_id = ?, worker_id = ?, attempt = ?,
                    error_code = NULL, error_message = NULL,
                    next_attempt = NULL, retry_delay_seconds = NULL,
                    ended_at = NULL, progress_detail = NULL,
                    started_at = ?, last_heartbeat_at = ?, deadline_at = ?,
                    watchdog_state = 'running',
                    updated_at = ?
                WHERE step_run_id = ?
                """,
                (
                    queue_id, worker_id, attempt,
                    started_ts, started_ts, deadline_ts,
                    now,
                    step_run_id,
                ),
            )
            self._conn.commit()

    def heartbeat(
        self,
        step_run_id: str,
        worker_id: str,
        *,
        deadline_at,
        progress_detail: str | None = None,
    ) -> None:
        """Refresh heartbeat + watchdog deadline. Optional progress note."""
        now = time.time()
        deadline_ts = _datetime_to_epoch(deadline_at)
        with self._lock:
            if progress_detail:
                self._conn.execute(
                    """
                    UPDATE factory_step_runs SET
                        worker_id = ?, last_heartbeat_at = ?, deadline_at = ?,
                        watchdog_state = 'running', progress_detail = ?,
                        updated_at = ?
                    WHERE step_run_id = ?
                    """,
                    (worker_id, now, deadline_ts, progress_detail, now, step_run_id),
                )
            else:
                self._conn.execute(
                    """
                    UPDATE factory_step_runs SET
                        worker_id = ?, last_heartbeat_at = ?, deadline_at = ?,
                        watchdog_state = 'running', updated_at = ?
                    WHERE step_run_id = ?
                    """,
                    (worker_id, now, deadline_ts, now, step_run_id),
                )
            self._conn.commit()

    def mark_succeeded(self, step_run_id: str, output: dict) -> None:
        """Record success + the step's output dict (JSON-encoded)."""
        now = time.time()
        payload = json.dumps(output or {}, separators=(",", ":"), ensure_ascii=False)
        with self._lock:
            self._conn.execute(
                """
                UPDATE factory_step_runs SET
                    state = 'succeeded', output = ?,
                    watchdog_state = 'succeeded',
                    ended_at = ?, updated_at = ?
                WHERE step_run_id = ?
                """,
                (payload, now, now, step_run_id),
            )
            self._conn.commit()

    def mark_succeeded_from_checkpoint(self, step_run_id: str, output: dict) -> None:
        """Create-or-replace a step-run as 'succeeded from checkpoint'.

        Used when an entire prior step's output is being reused without
        re-execution. Unlike ``mark_succeeded``, this may be called
        WITHOUT a prior ``ensure_ready`` (the orchestrator's checkpoint
        seed inserts directly), so we UPSERT."""
        run_id, step_name, shard_key = self._parse_step_run_id(step_run_id)
        job_id = self._lookup_job_id(step_run_id) or ""
        now = time.time()
        payload = json.dumps(output or {}, separators=(",", ":"), ensure_ascii=False)
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO factory_step_runs (
                    step_run_id, job_id, run_id, step_name, shard_key,
                    state, attempt, worker_id, output,
                    created_at, updated_at,
                    started_at, last_heartbeat_at, ended_at,
                    watchdog_state
                ) VALUES (?, ?, ?, ?, ?, 'succeeded', 1, 'checkpoint', ?,
                          ?, ?, ?, ?, ?, 'succeeded')
                ON CONFLICT(step_run_id) DO UPDATE SET
                    state = 'succeeded',
                    attempt = 1,
                    worker_id = 'checkpoint',
                    output = excluded.output,
                    started_at = excluded.started_at,
                    last_heartbeat_at = excluded.last_heartbeat_at,
                    ended_at = excluded.ended_at,
                    watchdog_state = 'succeeded',
                    updated_at = excluded.updated_at
                """,
                (
                    step_run_id, job_id, run_id, step_name, shard_key,
                    payload,
                    now, now, now, now, now,
                ),
            )
            self._conn.commit()

    def batch_mark_succeeded_from_checkpoint(
        self,
        entries: list[tuple[str, str, str, str, dict]],
    ) -> None:
        """Bulk UPSERT for checkpoint reuse. One transaction.

        Matches the Firestore signature: each entry is
        ``(job_id, run_id, step_name, shard_key, output)``. The
        Firestore version chunks at 500 (its hard batch limit);
        SQLite has no such limit so we commit the whole list in
        one transaction — both faster and atomic across the set."""
        if not entries:
            return
        now = time.time()
        rows = []
        for job_id, run_id, step_name, shard_key, output in entries:
            step_run_id = self.make_step_run_id(run_id, step_name, shard_key)
            payload = json.dumps(output or {}, separators=(",", ":"), ensure_ascii=False)
            rows.append((
                step_run_id, job_id, run_id, step_name, shard_key,
                payload,
                now, now, now, now, now,
            ))
        with self._lock:
            self._conn.executemany(
                """
                INSERT INTO factory_step_runs (
                    step_run_id, job_id, run_id, step_name, shard_key,
                    state, attempt, worker_id, output,
                    created_at, updated_at,
                    started_at, last_heartbeat_at, ended_at,
                    watchdog_state
                ) VALUES (?, ?, ?, ?, ?, 'succeeded', 1, 'checkpoint', ?,
                          ?, ?, ?, ?, ?, 'succeeded')
                ON CONFLICT(step_run_id) DO UPDATE SET
                    state = 'succeeded',
                    attempt = 1,
                    worker_id = 'checkpoint',
                    output = excluded.output,
                    started_at = excluded.started_at,
                    last_heartbeat_at = excluded.last_heartbeat_at,
                    ended_at = excluded.ended_at,
                    watchdog_state = 'succeeded',
                    updated_at = excluded.updated_at
                """,
                rows,
            )
            self._conn.commit()

    def mark_failed(self, step_run_id: str, error_code: str, error_message: str) -> None:
        """Terminal failure. No automatic retry follows from this state."""
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                UPDATE factory_step_runs SET
                    state = 'failed',
                    error_code = ?, error_message = ?,
                    watchdog_state = 'failed',
                    ended_at = ?, updated_at = ?
                WHERE step_run_id = ?
                """,
                (error_code, error_message, now, now, step_run_id),
            )
            self._conn.commit()

    def mark_retry_scheduled(
        self,
        step_run_id: str,
        error_code: str,
        error_message: str,
        next_attempt: int,
        delay_seconds: int,
    ) -> None:
        """Record retry intent. The queue repo separately re-enqueues."""
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                UPDATE factory_step_runs SET
                    state = 'retry_scheduled',
                    error_code = ?, error_message = ?,
                    next_attempt = ?, retry_delay_seconds = ?,
                    watchdog_state = 'retry_scheduled',
                    updated_at = ?
                WHERE step_run_id = ?
                """,
                (error_code, error_message, next_attempt, delay_seconds, now, step_run_id),
            )
            self._conn.commit()

    def mark_waiting(self, step_run_id: str, delay_seconds: int) -> None:
        """Non-error pause (e.g. polling for an external resource)."""
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                UPDATE factory_step_runs SET
                    state = 'waiting',
                    error_code = NULL, error_message = NULL,
                    retry_delay_seconds = ?,
                    watchdog_state = 'waiting',
                    updated_at = ?
                WHERE step_run_id = ?
                """,
                (delay_seconds, now, step_run_id),
            )
            self._conn.commit()

    def delete(self, step_run_id: str) -> None:
        """Hard delete. Used by the QC retry path so ``ensure_ready``
        can recreate the row in the ``ready`` state."""
        with self._lock:
            self._conn.execute(
                "DELETE FROM factory_step_runs WHERE step_run_id = ?",
                (step_run_id,),
            )
            self._conn.commit()

    # ------------- read methods ----------------

    def state(self, run_id: str, step_name: str, shard_key: str = "root") -> str | None:
        """Current state of a single step-run shard, or None if absent."""
        step_run_id = self.make_step_run_id(run_id, step_name, shard_key)
        with self._lock:
            row = self._conn.execute(
                "SELECT state FROM factory_step_runs WHERE step_run_id = ?",
                (step_run_id,),
            ).fetchone()
        if not row:
            return None
        s = (row[0] or "").strip()
        return s or None

    def has_succeeded(self, job_id: str, run_id: str, step_name: str) -> bool:
        """True if any shard of this step has succeeded. LIMIT 1 for cheapness."""
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM factory_step_runs "
                "WHERE job_id = ? AND run_id = ? AND step_name = ? AND state = 'succeeded' "
                "LIMIT 1",
                (job_id, run_id, step_name),
            ).fetchone()
        return row is not None

    def succeeded_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set[str]:
        """Shard keys that succeeded for this step. The hot read path —
        every fan-in gate calls this. Uses the composite index from the
        schema."""
        return self._shard_keys_by_state(job_id, run_id, step_name, "succeeded")

    def failed_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set[str]:
        return self._shard_keys_by_state(job_id, run_id, step_name, "failed")

    def _shard_keys_by_state(
        self, job_id: str, run_id: str, step_name: str, state: str,
    ) -> set[str]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT shard_key FROM factory_step_runs "
                "WHERE job_id = ? AND run_id = ? AND step_name = ? AND state = ?",
                (job_id, run_id, step_name, state),
            ).fetchall()
        return {(r[0] or "root").strip() for r in rows if (r[0] or "").strip()}

    # ------------- internal helpers ----------------

    @staticmethod
    def _parse_step_run_id(step_run_id: str) -> tuple[str, str, str]:
        """Reverse of ``make_step_run_id``. The format is
        ``<run_id>__<step_name>__<shard_key>``; run_id itself can contain
        single underscores (it's typically ``<job_id>-r<N>``) but the
        double-underscore delimiter is reserved."""
        parts = step_run_id.split("__", 2)
        if len(parts) != 3:
            raise ValueError(f"malformed step_run_id: {step_run_id!r}")
        return parts[0], parts[1], parts[2]

    def _lookup_job_id(self, step_run_id: str) -> str | None:
        """Look up job_id for an existing step_run. Used by
        ``mark_succeeded_from_checkpoint`` when the row already exists
        (we want to preserve the original job_id rather than depend on
        the caller to supply it again)."""
        with self._lock:
            row = self._conn.execute(
                "SELECT job_id FROM factory_step_runs WHERE step_run_id = ?",
                (step_run_id,),
            ).fetchone()
        return row[0] if row else None

    # ------------- lifecycle ----------------

    def close(self) -> None:
        """Close the connection. Mainly for tests."""
        with self._lock:
            self._conn.close()
