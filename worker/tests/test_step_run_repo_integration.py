"""End-to-end integration tests for the step-runs repo migration.

The unit tests for ``DualStepRunRepo`` (in ``test_dual_step_run_repo.py``)
use fakes for BOTH primary and mirror. This file uses the REAL
``SqliteStepRunRepo`` (writing to a temp SQLite file on disk) wired
through the ``make_step_run_repo`` factory in ``dual`` mode. The mirror
is faked because we can't depend on Firestore in tests, but everything
else exercises the same code path that runs in production.

Goal: validate that flipping ``FACTORY_STORAGE_STEP_RUNS=dual`` in
production will actually work the way Phase 2 promises:

  1. Writes land in both SQLite (real disk) and the Firestore mirror.
  2. **Reads come from SQLite, not the mirror.** This is THE structural
     fix for the eventual-consistency race patched surgically in
     43f4e7b9. We pin it at the integration layer (not just the unit
     layer) so a future refactor of the dual repo, the factory, the
     dispatcher, or the SqliteStepRunRepo cannot reopen the race
     without breaking a test.
  3. Read-after-write is strongly consistent. A reader that queries
     state() immediately after mark_succeeded() sees succeeded — even
     though the mirror dispatch hasn't flushed yet.
  4. Intermittent mirror failures don't lose any rows from SQLite,
     don't affect read correctness, and don't propagate to the caller.
  5. Default mode (no env var) never touches SQLite — the safety
     guarantee that lets us land this code without flipping anything.

What this test does NOT cover (intentionally):
  - The orchestrator's actual fan-in logic (covered by orchestrator
    unit tests; the integration boundary here is the repo, not the
    application layer).
  - Real Firestore — by design, the mirror is faked so this suite
    doesn't need network access or service-account credentials.
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


class _RecordingStepRunMirror:
    """Stands in for FirestoreStepRunRepo. Records calls per method;
    thread-safe; can be configured to fail on every Nth WRITE to
    simulate flaky Firestore.

    Notable: reads (state, has_succeeded, succeeded_shard_keys,
    failed_shard_keys) raise unconditionally. The dual repo MUST NOT
    call them — if it does, the test fails loudly. This is the
    integration-level pin for the "reads from primary only" contract.
    """

    def __init__(self, fail_every: int = 0):
        self._lock = threading.Lock()
        self.fail_every = fail_every
        self._counter = 0
        # Per-method call records — useful for cross-checking the
        # primary's state. Each entry is the positional + kw args.
        self.ensure_ready_calls: list[tuple] = []
        self.mark_running_calls: list[tuple] = []
        self.heartbeat_calls: list[tuple] = []
        self.mark_succeeded_calls: list[tuple] = []
        self.mark_failed_calls: list[tuple] = []
        self.mark_retry_scheduled_calls: list[tuple] = []
        self.mark_waiting_calls: list[tuple] = []
        self.delete_calls: list[tuple] = []
        self.batch_calls: list[list] = []
        self.checkpoint_calls: list[tuple] = []

    # ---- write methods: record + occasionally raise ----

    def _maybe_fail(self) -> None:
        self._counter += 1
        if self.fail_every and self._counter % self.fail_every == 0:
            raise RuntimeError(f"simulated mirror failure #{self._counter}")

    def ensure_ready(self, job_id, run_id, step_name, shard_key="root"):
        with self._lock:
            self._maybe_fail()
            self.ensure_ready_calls.append((job_id, run_id, step_name, shard_key))
        return f"{run_id}__{step_name}__{shard_key}"

    def mark_running(
        self, step_run_id, queue_id, worker_id, attempt=1,
        *, started_at=None, deadline_at=None,
    ):
        with self._lock:
            self._maybe_fail()
            self.mark_running_calls.append(
                (step_run_id, queue_id, worker_id, attempt, started_at, deadline_at)
            )

    def heartbeat(self, step_run_id, worker_id, *, deadline_at, progress_detail=None):
        with self._lock:
            self._maybe_fail()
            self.heartbeat_calls.append(
                (step_run_id, worker_id, deadline_at, progress_detail)
            )

    def mark_succeeded(self, step_run_id, output):
        with self._lock:
            self._maybe_fail()
            self.mark_succeeded_calls.append((step_run_id, output))

    def mark_succeeded_from_checkpoint(self, step_run_id, output):
        with self._lock:
            self._maybe_fail()
            self.checkpoint_calls.append((step_run_id, output))

    def batch_mark_succeeded_from_checkpoint(self, entries):
        with self._lock:
            self._maybe_fail()
            self.batch_calls.append(list(entries))

    def mark_failed(self, step_run_id, error_code, error_message):
        with self._lock:
            self._maybe_fail()
            self.mark_failed_calls.append((step_run_id, error_code, error_message))

    def mark_retry_scheduled(
        self, step_run_id, error_code, error_message, next_attempt, delay_seconds,
    ):
        with self._lock:
            self._maybe_fail()
            self.mark_retry_scheduled_calls.append(
                (step_run_id, error_code, error_message, next_attempt, delay_seconds)
            )

    def mark_waiting(self, step_run_id, delay_seconds):
        with self._lock:
            self._maybe_fail()
            self.mark_waiting_calls.append((step_run_id, delay_seconds))

    def delete(self, step_run_id):
        with self._lock:
            self._maybe_fail()
            self.delete_calls.append((step_run_id,))

    # ---- read methods: must never be called by the dual repo ----
    # If any of these fire, the dual repo violated its read-from-primary
    # contract — that's a serious regression (the eventual-consistency
    # race is back). Raise loudly with a specific message.

    def state(self, *args, **kwargs):
        raise AssertionError(
            "DualStepRunRepo called state() on the mirror — reads must "
            "go to the primary (SQLite) ONLY"
        )

    def has_succeeded(self, *args, **kwargs):
        raise AssertionError(
            "DualStepRunRepo called has_succeeded() on the mirror — "
            "reads must go to the primary (SQLite) ONLY"
        )

    def succeeded_shard_keys(self, *args, **kwargs):
        raise AssertionError(
            "DualStepRunRepo called succeeded_shard_keys() on the mirror "
            "— reads must go to the primary (SQLite) ONLY"
        )

    def failed_shard_keys(self, *args, **kwargs):
        raise AssertionError(
            "DualStepRunRepo called failed_shard_keys() on the mirror — "
            "reads must go to the primary (SQLite) ONLY"
        )


class _DummyDb:
    pass


# A representative step lifecycle for one shard. Mirrors what claim_loop
# does for a single step: ensure_ready → mark_running → heartbeat (×2)
# → mark_succeeded.
def _run_one_shard_lifecycle(repo, job_id, run_id, step_name, shard_key):
    step_run_id = repo.ensure_ready(job_id, run_id, step_name, shard_key)
    deadline = "2026-01-01T00:00:00+00:00"  # FirestoreStepRunRepo accepts ISO/datetime; SQLite tolerates strings via _datetime_to_epoch
    repo.mark_running(
        step_run_id, "queue-1", "worker-test", 1,
        started_at=None, deadline_at=None,
    )
    repo.heartbeat(step_run_id, "worker-test", deadline_at=None, progress_detail="50%")
    repo.heartbeat(step_run_id, "worker-test", deadline_at=None, progress_detail="100%")
    repo.mark_succeeded(step_run_id, {"output_key": "value", "shard": shard_key})
    return step_run_id


class StepRunRepoIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._tmpdir.name) / "factory.db"
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
        be silently dual-writing without operator opt-in. Same contract
        Phase 1 pins for events; restated here for step_runs because the
        consequences of accidental dual-write on the hot path are worse.
        """
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        env_without_storage = {
            k: v for k, v in os.environ.items() if k != "FACTORY_STORAGE_STEP_RUNS"
        }
        with mock.patch.dict(os.environ, env_without_storage, clear=True):
            os.environ["FACTORY_DB_PATH"] = str(self.db_path)
            # Default = firestore. With a DummyDb, the repo won't be
            # functional, but we never call it — we only check that
            # constructing it doesn't create a SQLite file.
            make_step_run_repo(_DummyDb())
        self.assertFalse(
            self.db_path.exists(),
            "default mode created a SQLite file — that would mean "
            "unattended deploys quietly start dual-writing on the hot path",
        )

    # ----------------------- dual mode end-to-end -----------------------

    def test_dual_mode_one_shard_lifecycle_lands_in_both_backends(self) -> None:
        """Run a single shard through its full lifecycle (ensure_ready →
        mark_running → heartbeat ×2 → mark_succeeded) via the dual repo.
        Both SQLite (real file) and the fake mirror must end up with the
        same calls, same arguments."""
        from factory_v2.infrastructure.dual_repos import (
            make_step_run_repo, DualStepRunRepo,
        )

        mirror = _RecordingStepRunMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")

        self.assertIsInstance(repo, DualStepRunRepo)
        try:
            step_run_id = _run_one_shard_lifecycle(
                repo, "job-1", "job-1-r1", "synthesize_audio_chunk", "chunk-0",
            )
            self.assertTrue(repo.flush(timeout=3.0), "mirror flush timed out")

            # SQLite — read directly to bypass any repo-side caching.
            conn = sqlite3.connect(str(self.db_path))
            rows = conn.execute(
                "SELECT step_run_id, state, output FROM factory_step_runs"
            ).fetchall()
            conn.close()

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], step_run_id)
            self.assertEqual(rows[0][1], "succeeded")

            # Mirror saw the same lifecycle in the same order.
            self.assertEqual(len(mirror.ensure_ready_calls), 1)
            self.assertEqual(len(mirror.mark_running_calls), 1)
            self.assertEqual(len(mirror.heartbeat_calls), 2)
            self.assertEqual(len(mirror.mark_succeeded_calls), 1)
            # Dispatcher reports no failures.
            self.assertEqual(repo.metrics()["failures"], 0)
            self.assertEqual(repo.metrics()["drops"], 0)
        finally:
            repo.close()

    def test_dual_mode_reads_come_from_sqlite_not_mirror(self) -> None:
        """THE structural race-fix property at the integration layer.

        The mirror's read methods raise loudly if called. We exercise
        every read method on the dual repo and confirm none of them
        touch the mirror — all answers come from SQLite. If this test
        ever breaks, the consistency race is back.
        """
        from factory_v2.infrastructure.dual_repos import make_step_run_repo

        mirror = _RecordingStepRunMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")

        try:
            # Populate state: 3 shards, 2 succeed, 1 fails.
            for shard in ("a", "b", "c"):
                step_run_id = repo.ensure_ready(
                    "job-1", "job-1-r1", "synthesize_audio_chunk", shard,
                )
                repo.mark_running(step_run_id, "queue", "worker", 1)
                if shard == "c":
                    repo.mark_failed(step_run_id, "timeout", "too slow")
                else:
                    repo.mark_succeeded(step_run_id, {"shard": shard})

            # Every read below MUST go to the primary (SQLite) only.
            # The mirror's read methods raise AssertionError on call.
            self.assertEqual(
                repo.state("job-1-r1", "synthesize_audio_chunk", "a"), "succeeded",
            )
            self.assertEqual(
                repo.state("job-1-r1", "synthesize_audio_chunk", "c"), "failed",
            )
            self.assertEqual(
                repo.state("job-1-r1", "synthesize_audio_chunk", "missing"), None,
            )
            self.assertTrue(
                repo.has_succeeded("job-1", "job-1-r1", "synthesize_audio_chunk"),
            )
            self.assertEqual(
                repo.succeeded_shard_keys("job-1", "job-1-r1", "synthesize_audio_chunk"),
                {"a", "b"},
            )
            self.assertEqual(
                repo.failed_shard_keys("job-1", "job-1-r1", "synthesize_audio_chunk"),
                {"c"},
            )
        finally:
            repo.close()

    def test_dual_mode_read_after_write_is_strongly_consistent(self) -> None:
        """The whole point of the migration, restated as a test: a
        reader that queries state() immediately after mark_succeeded()
        sees succeeded — without waiting for the mirror to flush.

        Under the old Firestore-only setup, this required a few hundred
        ms (or more, on a bad day) for the index to converge — the
        exact bug that 43f4e7b9 patched. Now the answer is local: the
        primary already has the write committed before mark_succeeded
        returns.
        """
        from factory_v2.infrastructure.dual_repos import make_step_run_repo

        mirror = _RecordingStepRunMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")

        try:
            step_run_id = repo.ensure_ready(
                "job-1", "job-1-r1", "format_script", "root",
            )
            # Read immediately — no flush, no sleep. SQLite is local
            # and the dispatcher is async, so the mirror likely hasn't
            # even fired yet. The read still returns the right answer.
            self.assertEqual(
                repo.state("job-1-r1", "format_script", "root"), "ready",
            )

            repo.mark_running(step_run_id, "queue", "worker", 1)
            self.assertEqual(
                repo.state("job-1-r1", "format_script", "root"), "running",
            )

            repo.mark_succeeded(step_run_id, {"text": "ok"})
            self.assertEqual(
                repo.state("job-1-r1", "format_script", "root"), "succeeded",
            )
            self.assertTrue(
                repo.has_succeeded("job-1", "job-1-r1", "format_script"),
            )
        finally:
            repo.close()

    def test_dual_mode_concurrent_shards_one_job(self) -> None:
        """Realistic worker pattern: 6 TTS chunks running in parallel
        for the same job, each going through its full lifecycle. After
        flush, both backends agree on the final state of every shard.
        """
        from factory_v2.infrastructure.dual_repos import make_step_run_repo

        mirror = _RecordingStepRunMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")

        try:
            shards = [f"chunk-{i}" for i in range(6)]
            threads = [
                threading.Thread(
                    target=_run_one_shard_lifecycle,
                    args=(repo, "job-1", "job-1-r1", "synthesize_audio_chunk", s),
                )
                for s in shards
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertTrue(repo.flush(timeout=5.0))

            # SQLite has all 6 shards in succeeded state.
            conn = sqlite3.connect(str(self.db_path))
            (sqlite_count,) = conn.execute(
                "SELECT COUNT(*) FROM factory_step_runs WHERE state='succeeded'"
            ).fetchone()
            conn.close()
            self.assertEqual(sqlite_count, 6)

            # Mirror saw 6 ensure_ready + 6 mark_running + 12 heartbeats
            # + 6 mark_succeeded (no failures).
            self.assertEqual(len(mirror.ensure_ready_calls), 6)
            self.assertEqual(len(mirror.mark_running_calls), 6)
            self.assertEqual(len(mirror.heartbeat_calls), 12)
            self.assertEqual(len(mirror.mark_succeeded_calls), 6)

            # Dual repo reads see the full set immediately (already
            # populated; reads go to SQLite).
            self.assertEqual(
                repo.succeeded_shard_keys("job-1", "job-1-r1", "synthesize_audio_chunk"),
                set(shards),
            )
            self.assertEqual(
                repo.failed_shard_keys("job-1", "job-1-r1", "synthesize_audio_chunk"),
                set(),
            )
            self.assertEqual(repo.metrics()["failures"], 0)
        finally:
            repo.close()

    def test_dual_mode_survives_intermittent_mirror_failures(self) -> None:
        """Simulate Firestore being flaky (every 3rd write fails).
        SQLite must still have every row; reads stay correct because
        they go to the primary; dispatcher metrics reflect reality;
        no exception propagates to the caller. This is the production
        fault-tolerance contract on the hot path."""
        from factory_v2.infrastructure.dual_repos import make_step_run_repo

        mirror = _RecordingStepRunMirror(fail_every=3)
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")

        try:
            shards = [f"chunk-{i}" for i in range(9)]
            for s in shards:
                # The whole lifecycle for each shard:
                # ensure_ready + mark_running + 2×heartbeat + mark_succeeded
                # = 5 mirror writes per shard × 9 shards = 45 mirror writes.
                # fail_every=3 means 15 of those 45 raise.
                _run_one_shard_lifecycle(
                    repo, "job-1", "job-1-r1", "synthesize_audio_chunk", s,
                )
            self.assertTrue(repo.flush(timeout=5.0))

            # SQLite (the source of truth) has ALL 9 succeeded rows.
            self.assertEqual(
                repo.succeeded_shard_keys("job-1", "job-1-r1", "synthesize_audio_chunk"),
                set(shards),
                "SQLite lost a row when mirror was flaky — that's a bug",
            )

            metrics = repo.metrics()
            self.assertEqual(metrics["failures"], 45 // 3)
            self.assertEqual(metrics["success"], 45 - 45 // 3)
        finally:
            repo.close()

    def test_dual_mode_batch_mark_succeeded_from_checkpoint(self) -> None:
        """The checkpoint hot path optimization works through the dual
        repo: SQLite UPSERTs in one transaction, mirror gets the batch
        as a single deferred call. Both end up with the same set of
        succeeded shards."""
        from factory_v2.infrastructure.dual_repos import make_step_run_repo

        mirror = _RecordingStepRunMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")

        try:
            entries = [
                ("job-1", "job-1-r1", "synthesize_audio_chunk", f"chunk-{i}",
                 {"audio_uri": f"gs://bucket/chunk-{i}.wav"})
                for i in range(5)
            ]
            repo.batch_mark_succeeded_from_checkpoint(entries)
            self.assertTrue(repo.flush(timeout=3.0))

            # SQLite has all 5 succeeded.
            shards = repo.succeeded_shard_keys(
                "job-1", "job-1-r1", "synthesize_audio_chunk",
            )
            self.assertEqual(shards, {f"chunk-{i}" for i in range(5)})

            # Mirror received exactly one batch with all 5 entries
            # (single dispatcher call, not 5).
            self.assertEqual(len(mirror.batch_calls), 1)
            self.assertEqual(len(mirror.batch_calls[0]), 5)
        finally:
            repo.close()

    def test_sqlite_file_is_created_at_factory_db_path_with_step_runs_table(self) -> None:
        """The SQLite file lands exactly where FACTORY_DB_PATH points,
        and contains the ``factory_step_runs`` table with the expected
        columns. Operationally important so admins know where to look
        and what to expect in the schema."""
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        mirror = _RecordingStepRunMirror()
        with mock.patch(
            "factory_v2.infrastructure.firestore_repos.FirestoreStepRunRepo",
            return_value=mirror,
        ):
            repo = make_step_run_repo(_DummyDb(), storage_mode="dual")
        try:
            repo.ensure_ready("job-1", "job-1-r1", "format_script", "root")
            self.assertTrue(self.db_path.exists())

            conn = sqlite3.connect(str(self.db_path))
            tables = [
                row[0] for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
            # A minimal smoke check on the columns — full schema is
            # validated in test_sqlite_step_run_repo.py; here we just
            # confirm the table exists with at least the key cols.
            cols = [
                row[1] for row in conn.execute(
                    "PRAGMA table_info(factory_step_runs)"
                ).fetchall()
            ]
            conn.close()

            self.assertIn("factory_step_runs", tables)
            for required in ("step_run_id", "job_id", "run_id", "step_name",
                             "shard_key", "state", "created_at"):
                self.assertIn(required, cols)
        finally:
            repo.close()


if __name__ == "__main__":
    unittest.main()
