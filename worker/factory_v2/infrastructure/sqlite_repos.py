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


# Schema for Phase 1 (factory_events). Later phases will append their
# own tables here. CREATE IF NOT EXISTS keeps this idempotent.
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


def _open_connection(db_path: Path) -> sqlite3.Connection:
    """Open and bootstrap a SQLite connection.

    Creates the parent directory if missing, enables WAL+NORMAL, and
    applies the current schema (idempotent). Returns a connection
    configured for cross-thread use; callers must serialize their own
    writes with a lock.
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
    # The events log is audit-only; losing the last ~100ms of events on
    # a crash is acceptable.
    conn.execute("PRAGMA synchronous=NORMAL")
    # Apply schema. CREATE IF NOT EXISTS makes this safe on every boot.
    conn.executescript(_PHASE1_SCHEMA)
    conn.commit()
    return conn


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
