"""Parity tests for SqliteEventRepo against the FirestoreEventRepo contract.

The orchestrator must be able to substitute these for each other
without behavioral surprises. These tests pin every guarantee the
hot path relies on so a future refactor doesn't silently break it:

  - emit() returns a non-empty unique id (callers may persist it)
  - All 5 fields stored exactly as passed in
  - Payload round-trips through JSON faithfully (including unicode)
  - Concurrent writers (main loop + watchdog + sweep) don't corrupt
    the table or produce duplicate ids
  - Default db location is anchored to worker/.tmp/factory.db
  - FACTORY_DB_PATH env var override works
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class SqliteEventRepoTests(unittest.TestCase):
    def setUp(self) -> None:
        # Per-test temp db so tests don't interfere or pollute disk.
        self._tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._tmpdir.name) / "factory.db"

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def _make_repo(self):
        from factory_v2.infrastructure.sqlite_repos import SqliteEventRepo
        return SqliteEventRepo(self.db_path)

    # ----------------------- emit() shape -----------------------

    def test_emit_returns_nonempty_unique_ids(self) -> None:
        repo = self._make_repo()
        try:
            id1 = repo.emit("step_started", "job-1", "job-1-r1", {"step": "generate_script"})
            id2 = repo.emit("step_succeeded", "job-1", "job-1-r1", {"step": "generate_script"})
            self.assertTrue(id1, "emit() must return a non-empty id")
            self.assertTrue(id2)
            self.assertNotEqual(id1, id2, "consecutive emits must produce distinct ids")
        finally:
            repo.close()

    def test_emit_stores_all_fields(self) -> None:
        """Every field passed to emit() must round-trip exactly through SQLite."""
        repo = self._make_repo()
        try:
            payload = {
                "step": "generate_image",
                "elapsed_ms": 1234,
                "nested": {"k": "v", "list": [1, 2, 3]},
                "unicode": "명상",  # meditation in Korean — scripts can contain non-ASCII
            }
            event_id = repo.emit("step_succeeded", "job-abc", "job-abc-r2", payload)

            # Read via a fresh sqlite3 connection — bypasses any repo-side
            # caching and proves the row is actually persisted.
            conn = sqlite3.connect(str(self.db_path))
            row = conn.execute(
                "SELECT id, event_type, job_id, run_id, payload, created_at "
                "FROM factory_events WHERE id = ?",
                (event_id,),
            ).fetchone()
            conn.close()

            self.assertIsNotNone(row, "row was not persisted")
            self.assertEqual(row[0], event_id)
            self.assertEqual(row[1], "step_succeeded")
            self.assertEqual(row[2], "job-abc")
            self.assertEqual(row[3], "job-abc-r2")
            self.assertEqual(
                json.loads(row[4]), payload,
                "payload must round-trip through JSON without loss",
            )
            # created_at is a recent unix timestamp.
            self.assertGreater(row[5], 1_700_000_000, "timestamp looks like a sentinel, not a real time")
            self.assertLess(row[5], 4_000_000_000, "timestamp is in the far future")
        finally:
            repo.close()

    def test_payload_with_only_unicode_does_not_break_storage(self) -> None:
        """ensure_ascii=False is correct — Korean meditation text should
        store and read back as the same string, not as escape sequences."""
        repo = self._make_repo()
        try:
            event_id = repo.emit("test", "job-1", "job-1-r1", {"text": "들숨 날숨"})
            conn = sqlite3.connect(str(self.db_path))
            (raw,) = conn.execute(
                "SELECT payload FROM factory_events WHERE id = ?", (event_id,),
            ).fetchone()
            conn.close()
            # The raw column should contain the literal characters, not
            # \uXXXX escapes — readable when grepping the db.
            self.assertIn("들숨 날숨", raw)
        finally:
            repo.close()

    # ----------------------- concurrency -----------------------

    def test_concurrent_writers_do_not_corrupt(self) -> None:
        """20 threads × 50 events = 1000 writes. Validates that WAL +
        per-emit lock are sufficient for the worker's actual concurrency:
        main poll loop + watchdog thread + recovery sweep can all emit
        events at once without losing rows or duplicating ids."""
        repo = self._make_repo()
        try:
            errors: list[tuple[int, str]] = []

            def worker(thread_idx: int) -> None:
                try:
                    for i in range(50):
                        repo.emit(
                            "test_event",
                            f"job-{thread_idx}",
                            f"job-{thread_idx}-r1",
                            {"i": i, "thread": thread_idx},
                        )
                except Exception as exc:  # pragma: no cover — failure path
                    errors.append((thread_idx, f"{type(exc).__name__}: {exc}"))

            threads = [threading.Thread(target=worker, args=(t,)) for t in range(20)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(errors, [], f"errors during concurrent writes: {errors}")

            conn = sqlite3.connect(str(self.db_path))
            (count,) = conn.execute("SELECT COUNT(*) FROM factory_events").fetchone()
            (unique_ids,) = conn.execute(
                "SELECT COUNT(DISTINCT id) FROM factory_events"
            ).fetchone()
            conn.close()

            self.assertEqual(count, 1000, "every emit() must produce exactly one row")
            self.assertEqual(unique_ids, 1000, "every event id must be unique")
        finally:
            repo.close()

    # ----------------------- db path resolution -----------------------

    def test_explicit_db_path_is_honored(self) -> None:
        """The repo constructor accepts an explicit Path / str."""
        custom = Path(self._tmpdir.name) / "explicit.db"
        from factory_v2.infrastructure.sqlite_repos import SqliteEventRepo
        repo = SqliteEventRepo(custom)
        try:
            repo.emit("x", "j", "r", {})
            self.assertTrue(custom.exists(), "db file should exist at explicit path")
        finally:
            repo.close()

    def test_factory_db_path_env_var_overrides_default(self) -> None:
        from factory_v2.infrastructure.sqlite_repos import _default_db_path
        custom = Path(self._tmpdir.name) / "custom.db"
        with mock.patch.dict(os.environ, {"FACTORY_DB_PATH": str(custom)}):
            resolved = _default_db_path()
        self.assertEqual(resolved, custom.resolve())

    def test_default_db_path_falls_back_to_worker_tmp(self) -> None:
        """Without an env override, the path lives under worker/.tmp/."""
        from factory_v2.infrastructure.sqlite_repos import _default_db_path
        env_without_override = {
            k: v for k, v in os.environ.items() if k != "FACTORY_DB_PATH"
        }
        with mock.patch.dict(os.environ, env_without_override, clear=True):
            path = _default_db_path()
        # Should resolve to worker/.tmp/factory.db.
        self.assertEqual(path.name, "factory.db")
        self.assertEqual(path.parent.name, ".tmp")
        self.assertEqual(path.parent.parent.name, "worker")

    # ----------------------- schema & idempotency -----------------------

    def test_schema_created_on_first_use(self) -> None:
        """Opening a repo against a fresh path must create the table."""
        fresh = Path(self._tmpdir.name) / "fresh.db"
        self.assertFalse(fresh.exists())
        from factory_v2.infrastructure.sqlite_repos import SqliteEventRepo
        repo = SqliteEventRepo(fresh)
        try:
            self.assertTrue(fresh.exists())
            # Table should exist and be empty.
            conn = sqlite3.connect(str(fresh))
            (count,) = conn.execute("SELECT COUNT(*) FROM factory_events").fetchone()
            conn.close()
            self.assertEqual(count, 0)
        finally:
            repo.close()

    def test_reopening_existing_db_preserves_data(self) -> None:
        """Re-opening a repo against an existing file (e.g. after worker
        restart) must not wipe rows or fail with 'table exists' errors."""
        from factory_v2.infrastructure.sqlite_repos import SqliteEventRepo
        repo1 = SqliteEventRepo(self.db_path)
        try:
            id1 = repo1.emit("a", "j", "r", {})
        finally:
            repo1.close()
        repo2 = SqliteEventRepo(self.db_path)
        try:
            id2 = repo2.emit("b", "j", "r", {})
            conn = sqlite3.connect(str(self.db_path))
            (count,) = conn.execute("SELECT COUNT(*) FROM factory_events").fetchone()
            conn.close()
            self.assertEqual(count, 2, "rows from prior session must survive a re-open")
            self.assertNotEqual(id1, id2)
        finally:
            repo2.close()


if __name__ == "__main__":
    unittest.main()
