"""End-to-end integration tests for the events repo migration.

The earlier tests use fakes for both primary and mirror. This file uses
the REAL ``SqliteEventRepo`` (writing to a temp file on disk) wired
through the ``make_event_repo`` factory in ``dual`` mode. The mirror
is faked because we can't depend on Firestore in tests, but everything
else exercises the same code path that runs in production.

Goal: validate that flipping ``FACTORY_STORAGE_EVENTS=dual`` in
production will actually work — same number of events recorded in
both backends, same payloads, no exceptions, even under realistic load
patterns (a job's worth of events with bursts and intermittent mirror
failures).

What's pinned:
  - The factory's dual mode produces a working DualEventRepo that emits
    to both SQLite and the mirror.
  - SQLite file is created at the configured path with the expected
    schema.
  - A realistic emission sequence (the patterns claim_loop uses)
    ends with both backends agreeing on event count and content.
  - Intermittent mirror failures don't lose any events from SQLite —
    SQLite is authoritative.
  - Default mode (no env var) never touches SQLite — safety guarantee
    for unattended deploys.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class _RecordingMirror:
    """Stands in for FirestoreEventRepo. Records calls; thread-safe;
    can be configured to fail on N% of writes to simulate flaky
    Firestore conditions."""

    def __init__(self, fail_every: int = 0):
        self.events: list[tuple[str, str, str, dict]] = []
        self.fail_every = fail_every  # 0 = never; 3 = every 3rd call raises
        self._counter = 0
        self._lock = threading.Lock()

    def emit(self, event_type, job_id, run_id, payload):
        with self._lock:
            self._counter += 1
            if self.fail_every and self._counter % self.fail_every == 0:
                raise RuntimeError(f"simulated mirror failure #{self._counter}")
            self.events.append((event_type, job_id, run_id, payload))
            return f"mirror-{self._counter}"


# A representative event sequence based on the real claim_loop patterns.
# 10 step types × the typical lifecycle = ~30 events per simulated job.
_JOB_EVENT_PATTERN = [
    ("step_started",   "generate_script"),
    ("step_succeeded", "generate_script"),
    ("step_started",   "format_script"),
    ("step_succeeded", "format_script"),
    ("step_started",   "generate_image"),
    ("step_succeeded", "generate_image"),
    ("step_started",   "synthesize_audio_chunk"),
    ("step_succeeded", "synthesize_audio_chunk"),
    ("step_started",   "qc_audio_chunk"),
    ("step_succeeded", "qc_audio_chunk"),
    ("step_started",   "assemble_audio"),
    ("step_succeeded", "assemble_audio"),
    ("step_started",   "post_process_audio"),
    ("step_succeeded", "post_process_audio"),
    ("step_started",   "upload_audio"),
    ("step_succeeded", "upload_audio"),
    ("step_started",   "publish_content"),
    ("step_succeeded", "publish_content"),
]


def _emit_one_job(repo, job_id: str, run_id: str) -> int:
    """Emit a realistic event sequence for one job. Returns count emitted."""
    for event_type, step_name in _JOB_EVENT_PATTERN:
        repo.emit(
            event_type,
            job_id,
            run_id,
            {"step_name": step_name, "attempt": 1, "worker_id": "test"},
        )
    return len(_JOB_EVENT_PATTERN)


class _DummyDb:
    pass


class EventRepoIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._tmpdir.name) / "factory.db"
        # FACTORY_DB_PATH points the SqliteEventRepo at a per-test file
        # so tests don't share state or fight for the same .tmp/factory.db.
        self._patcher = mock.patch.dict(os.environ, {
            "FACTORY_DB_PATH": str(self.db_path),
        })
        self._patcher.start()

    def tearDown(self) -> None:
        self._patcher.stop()
        self._tmpdir.cleanup()

    # ----------------------- default safety -----------------------

    def test_default_mode_never_touches_sqlite(self) -> None:
        """Critical safety property: deployment of this code in default
        mode must NOT create ``worker/.tmp/factory.db``. Otherwise we'd
        be silently dual-writing without operator opt-in."""
        from factory_v2.infrastructure.dual_repos import make_event_repo
        env_without_storage = {
            k: v for k, v in os.environ.items() if k != "FACTORY_STORAGE_EVENTS"
        }
        with mock.patch.dict(os.environ, env_without_storage, clear=True):
            os.environ["FACTORY_DB_PATH"] = str(self.db_path)
            repo = make_event_repo(_DummyDb())  # default = firestore
            # Issue an emit — make_event_repo returned FirestoreEventRepo,
            # which under our DummyDb will fail or no-op. Either way:
            # the SQLite file must not exist.
            try:
                repo.emit("test", "job-1", "job-1-r1", {})
            except Exception:
                pass  # FirestoreEventRepo will fail on DummyDb; that's fine.
        self.assertFalse(
            self.db_path.exists(),
            "default mode created a SQLite file — that would mean unattended "
            "deploys quietly start dual-writing",
        )

    # ----------------------- dual mode end-to-end -----------------------

    def test_dual_mode_one_job_lands_in_both_backends(self) -> None:
        """Simulate a single job's worth of events through dual mode.
        Both SQLite (real file) and the fake mirror must end up with
        the same count and the same event types in the same order."""
        from factory_v2.infrastructure.dual_repos import make_event_repo, DualEventRepo

        # Patch the lazy-imported FirestoreEventRepo to return our fake.
        # The factory imports it on the dual branch; substituting at
        # that import site is the cleanest way to inject the mirror.
        mirror = _RecordingMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreEventRepo",
            return_value=mirror,
        ):
            repo = make_event_repo(_DummyDb(), storage_mode="dual")

        self.assertIsInstance(repo, DualEventRepo)
        try:
            count = _emit_one_job(repo, "job-1", "job-1-r1")
            self.assertTrue(repo.flush(timeout=3.0), "mirror flush timed out")

            # SQLite — read directly to bypass any repo-side caching.
            conn = sqlite3.connect(str(self.db_path))
            (sqlite_count,) = conn.execute(
                "SELECT COUNT(*) FROM factory_events"
            ).fetchone()
            event_types_sqlite = [
                row[0] for row in conn.execute(
                    "SELECT event_type FROM factory_events ORDER BY created_at"
                ).fetchall()
            ]
            conn.close()

            self.assertEqual(sqlite_count, count, "SQLite row count mismatch")
            self.assertEqual(len(mirror.events), count, "mirror row count mismatch")

            event_types_mirror = [et for (et, _j, _r, _p) in mirror.events]
            self.assertEqual(
                event_types_sqlite, event_types_mirror,
                "event ordering diverged between SQLite and mirror",
            )

            # Dispatcher should report no failures and the right success count.
            metrics = repo.metrics()
            self.assertEqual(metrics["failures"], 0)
            self.assertEqual(metrics["success"], count)
            self.assertEqual(metrics["drops"], 0)
        finally:
            repo.close()

    def test_dual_mode_multiple_concurrent_jobs(self) -> None:
        """Simulate 5 jobs emitting concurrently (the realistic worker
        pattern: multiple TTS chunks running in parallel, each emitting
        their own events). Final counts must match exactly."""
        from factory_v2.infrastructure.dual_repos import make_event_repo

        mirror = _RecordingMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreEventRepo",
            return_value=mirror,
        ):
            repo = make_event_repo(_DummyDb(), storage_mode="dual")

        try:
            threads = [
                threading.Thread(
                    target=_emit_one_job,
                    args=(repo, f"job-{i}", f"job-{i}-r1"),
                )
                for i in range(5)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertTrue(repo.flush(timeout=5.0))

            expected = 5 * len(_JOB_EVENT_PATTERN)
            conn = sqlite3.connect(str(self.db_path))
            (sqlite_count,) = conn.execute(
                "SELECT COUNT(*) FROM factory_events"
            ).fetchone()
            conn.close()

            self.assertEqual(sqlite_count, expected)
            self.assertEqual(len(mirror.events), expected)
            self.assertEqual(repo.metrics()["failures"], 0)
        finally:
            repo.close()

    def test_dual_mode_survives_intermittent_mirror_failures(self) -> None:
        """Simulate Firestore being flaky (every 3rd write fails).
        SQLite must still have ALL events; mirror loses some;
        dispatcher reports the failure count accurately. This is the
        production fault-tolerance contract."""
        from factory_v2.infrastructure.dual_repos import make_event_repo

        mirror = _RecordingMirror(fail_every=3)
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreEventRepo",
            return_value=mirror,
        ):
            repo = make_event_repo(_DummyDb(), storage_mode="dual")

        try:
            _emit_one_job(repo, "job-1", "job-1-r1")
            self.assertTrue(repo.flush(timeout=3.0))

            total = len(_JOB_EVENT_PATTERN)
            expected_failures = total // 3
            expected_mirror_success = total - expected_failures

            conn = sqlite3.connect(str(self.db_path))
            (sqlite_count,) = conn.execute(
                "SELECT COUNT(*) FROM factory_events"
            ).fetchone()
            conn.close()

            # SQLite is the source of truth — never loses anything.
            self.assertEqual(sqlite_count, total)
            # Mirror lost a third — that's expected with fail_every=3.
            self.assertEqual(len(mirror.events), expected_mirror_success)
            # Dispatcher metrics reflect reality.
            metrics = repo.metrics()
            self.assertEqual(metrics["failures"], expected_failures)
            self.assertEqual(metrics["success"], expected_mirror_success)
        finally:
            repo.close()

    # ----------------------- SQLite file shape -----------------------

    def test_sqlite_file_is_created_at_factory_db_path(self) -> None:
        """The SQLite file lands exactly where FACTORY_DB_PATH points.
        Operationally important so admins know where to look."""
        from factory_v2.infrastructure.dual_repos import make_event_repo
        mirror = _RecordingMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreEventRepo",
            return_value=mirror,
        ):
            repo = make_event_repo(_DummyDb(), storage_mode="dual")
        try:
            repo.emit("test", "job-1", "job-1-r1", {})
            self.assertTrue(self.db_path.exists())
            # File must be a valid SQLite db (not a directory, not empty).
            conn = sqlite3.connect(str(self.db_path))
            tables = [
                row[0] for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
            conn.close()
            self.assertIn("factory_events", tables)
        finally:
            repo.close()


if __name__ == "__main__":
    unittest.main()
