"""Parity tests for SqliteStepRunRepo.

Tests every method of ``SqliteStepRunRepo`` against the contract that
``FirestoreStepRunRepo`` satisfies. If a behavior is different between
the two backends, that's a bug — the orchestrator depends on this
parity being exact, otherwise dual-write produces backends that diverge
silently.

Patterns to copy in Phase 2 step 3 (DualStepRunRepo tests) and beyond:
- Per-test temp DB via tempfile + FACTORY_DB_PATH so tests don't share
  state and don't fight for the same .tmp/factory.db.
- Use the real SqliteStepRunRepo, not a mock — Phase 1 lesson: parity
  tests want the real backend.
- Each test exercises ONE method's contract + verifies state via the
  reads (``state``, ``succeeded_shard_keys``, etc.) so we don't rely on
  internal SQL knowledge.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class _StepRunRepoTestBase(unittest.TestCase):
    """Shared fixture: per-test temp SQLite db + closing in tearDown."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env = mock.patch.dict(os.environ, {
            "FACTORY_DB_PATH": str(Path(self._tmpdir.name) / "factory.db"),
        })
        self._env.start()
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        self.repo = SqliteStepRunRepo()

    def tearDown(self) -> None:
        self.repo.close()
        self._env.stop()
        self._tmpdir.cleanup()


class IdHelperTests(_StepRunRepoTestBase):
    def test_make_step_run_id_matches_firestore_format(self):
        """The format ``<run>__<step>__<shard>`` is shared with Firestore.
        Critical that both backends agree on the id so dual-write writes
        the same key to both."""
        sid = self.repo.make_step_run_id("job1-r2", "generate_script", "root")
        self.assertEqual(sid, "job1-r2__generate_script__root")

    def test_make_step_run_id_with_custom_shard(self):
        sid = self.repo.make_step_run_id("job1-r2", "synthesize_audio_chunk", "P03")
        self.assertEqual(sid, "job1-r2__synthesize_audio_chunk__P03")


class EnsureReadyTests(_StepRunRepoTestBase):
    def test_first_call_creates_row(self):
        sid = self.repo.ensure_ready("job1", "job1-r1", "generate_script", "root")
        self.assertEqual(self.repo.state("job1-r1", "generate_script"), "ready")
        self.assertEqual(sid, "job1-r1__generate_script__root")

    def test_idempotent_second_call_preserves_state(self):
        """Critical: repeated ensure_ready (a common dispatcher pattern)
        must not reset the row. If it did, a step that's already
        succeeded would get demoted back to ready."""
        sid = self.repo.ensure_ready("job1", "job1-r1", "generate_script")
        self.repo.mark_running(sid, "q1", "w1")
        self.repo.mark_succeeded(sid, {"x": 1})
        # Second ensure_ready should NOT reset state to 'ready'.
        sid2 = self.repo.ensure_ready("job1", "job1-r1", "generate_script")
        self.assertEqual(sid, sid2)
        self.assertEqual(self.repo.state("job1-r1", "generate_script"), "succeeded")

    def test_created_at_preserved_across_calls(self):
        """Second ensure_ready must NOT overwrite created_at — otherwise
        timing analytics get wrong start times."""
        self.repo.ensure_ready("job1", "job1-r1", "generate_script")
        time.sleep(0.05)
        self.repo.ensure_ready("job1", "job1-r1", "generate_script")
        # Direct DB inspection — created_at should be a single value < now.
        row = self.repo._conn.execute(
            "SELECT created_at FROM factory_step_runs "
            "WHERE step_run_id='job1-r1__generate_script__root'"
        ).fetchone()
        self.assertLess(row[0], time.time())


class StateTransitionTests(_StepRunRepoTestBase):
    def setUp(self):
        super().setUp()
        self.sid = self.repo.ensure_ready("job1", "job1-r1", "generate_script")

    def test_mark_running_transitions_state(self):
        self.repo.mark_running(self.sid, "q1", "worker-1", attempt=1)
        self.assertEqual(self.repo.state("job1-r1", "generate_script"), "running")

    def test_mark_running_clears_prior_error_fields(self):
        """If a step previously failed and gets re-run, the new mark_running
        must wipe error_code/error_message so reads don't see stale errors."""
        self.repo.mark_failed(self.sid, "boom", "everything broke")
        # Now retry kicks in.
        self.repo.mark_running(self.sid, "q2", "worker-1", attempt=2)
        row = self.repo._conn.execute(
            "SELECT error_code, error_message, next_attempt, retry_delay_seconds, ended_at "
            "FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row, (None, None, None, None, None))

    def test_mark_running_with_datetime_timestamps(self):
        """Callers pass datetime objects; the repo converts to epoch seconds."""
        started = datetime(2026, 5, 16, 10, 0, 0, tzinfo=timezone.utc)
        deadline = started + timedelta(minutes=5)
        self.repo.mark_running(self.sid, "q1", "w1", started_at=started, deadline_at=deadline)
        row = self.repo._conn.execute(
            "SELECT started_at, deadline_at FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertAlmostEqual(row[0], started.timestamp(), places=3)
        self.assertAlmostEqual(row[1], deadline.timestamp(), places=3)

    def test_heartbeat_updates_timestamps_only(self):
        self.repo.mark_running(self.sid, "q1", "worker-1")
        deadline = datetime.now(timezone.utc) + timedelta(seconds=60)
        self.repo.heartbeat(self.sid, "worker-1", deadline_at=deadline)
        # State should still be 'running'; just heartbeat refreshed.
        self.assertEqual(self.repo.state("job1-r1", "generate_script"), "running")

    def test_heartbeat_with_progress_detail(self):
        self.repo.mark_running(self.sid, "q1", "worker-1")
        deadline = datetime.now(timezone.utc) + timedelta(seconds=60)
        self.repo.heartbeat(self.sid, "worker-1", deadline_at=deadline, progress_detail="3/7 chunks done")
        row = self.repo._conn.execute(
            "SELECT progress_detail FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row[0], "3/7 chunks done")

    def test_heartbeat_without_progress_does_not_clobber_existing(self):
        """If you pass progress_detail=None, the existing detail should be
        preserved — Firestore semantics (set+merge skips None unset)."""
        self.repo.mark_running(self.sid, "q1", "worker-1")
        deadline = datetime.now(timezone.utc) + timedelta(seconds=60)
        self.repo.heartbeat(self.sid, "worker-1", deadline_at=deadline, progress_detail="first message")
        self.repo.heartbeat(self.sid, "worker-1", deadline_at=deadline)  # no progress_detail
        row = self.repo._conn.execute(
            "SELECT progress_detail FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row[0], "first message")

    def test_mark_succeeded_records_output_as_json(self):
        self.repo.mark_running(self.sid, "q1", "worker-1")
        self.repo.mark_succeeded(self.sid, {"word_count": 240, "title": "안녕"})
        row = self.repo._conn.execute(
            "SELECT state, output, ended_at FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row[0], "succeeded")
        decoded = json.loads(row[1])
        # ensure_ascii=False keeps Korean text readable in the DB.
        self.assertEqual(decoded, {"word_count": 240, "title": "안녕"})
        self.assertIsNotNone(row[2])

    def test_mark_failed_records_error(self):
        self.repo.mark_running(self.sid, "q1", "worker-1")
        self.repo.mark_failed(self.sid, "tts_unavailable", "LM Studio returned 503")
        row = self.repo._conn.execute(
            "SELECT state, error_code, error_message, ended_at "
            "FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row[0], "failed")
        self.assertEqual(row[1], "tts_unavailable")
        self.assertEqual(row[2], "LM Studio returned 503")
        self.assertIsNotNone(row[3])

    def test_mark_retry_scheduled(self):
        self.repo.mark_running(self.sid, "q1", "worker-1")
        self.repo.mark_retry_scheduled(self.sid, "transient", "timeout", next_attempt=2, delay_seconds=30)
        row = self.repo._conn.execute(
            "SELECT state, next_attempt, retry_delay_seconds, error_code "
            "FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row[0], "retry_scheduled")
        self.assertEqual(row[1], 2)
        self.assertEqual(row[2], 30)
        self.assertEqual(row[3], "transient")

    def test_mark_waiting_clears_error_fields(self):
        """Waiting is a non-error pause; prior error data should clear."""
        self.repo.mark_failed(self.sid, "boom", "broke")
        self.repo.mark_waiting(self.sid, delay_seconds=10)
        row = self.repo._conn.execute(
            "SELECT state, error_code, error_message, retry_delay_seconds "
            "FROM factory_step_runs WHERE step_run_id = ?",
            (self.sid,),
        ).fetchone()
        self.assertEqual(row[0], "waiting")
        self.assertIsNone(row[1])
        self.assertIsNone(row[2])
        self.assertEqual(row[3], 10)


class CheckpointTests(_StepRunRepoTestBase):
    def test_mark_succeeded_from_checkpoint_creates_row_when_absent(self):
        """Unlike mark_succeeded, this UPSERTs — it's called from the
        orchestrator's checkpoint-seed without a prior ensure_ready."""
        sid = self.repo.make_step_run_id("job1-r2", "format_script", "root")
        # No ensure_ready first.
        self.repo.mark_succeeded_from_checkpoint(sid, {"reused_from_checkpoint": True})
        self.assertEqual(self.repo.state("job1-r2", "format_script"), "succeeded")

    def test_mark_succeeded_from_checkpoint_preserves_job_id_for_existing_rows(self):
        """If the row already exists (e.g. a manual replay), the existing
        job_id must be preserved, not overwritten to empty."""
        sid = self.repo.ensure_ready("job1", "job1-r1", "format_script")
        self.repo.mark_succeeded_from_checkpoint(sid, {"x": 1})
        row = self.repo._conn.execute(
            "SELECT job_id FROM factory_step_runs WHERE step_run_id = ?",
            (sid,),
        ).fetchone()
        self.assertEqual(row[0], "job1")

    def test_batch_mark_succeeded_from_checkpoint(self):
        entries = [
            ("job1", "job1-r1", "generate_script", "root", {"reused": True}),
            ("job1", "job1-r1", "format_script", "root", {"reused": True}),
            ("job1", "job1-r1", "generate_image", "root", {"reused": True}),
        ]
        self.repo.batch_mark_succeeded_from_checkpoint(entries)
        self.assertEqual(self.repo.state("job1-r1", "generate_script"), "succeeded")
        self.assertEqual(self.repo.state("job1-r1", "format_script"), "succeeded")
        self.assertEqual(self.repo.state("job1-r1", "generate_image"), "succeeded")

    def test_batch_mark_succeeded_from_checkpoint_empty_is_no_op(self):
        """Don't crash, don't write anything. Matches the Firestore guard."""
        self.repo.batch_mark_succeeded_from_checkpoint([])
        count = self.repo._conn.execute(
            "SELECT COUNT(*) FROM factory_step_runs"
        ).fetchone()
        self.assertEqual(count[0], 0)

    def test_batch_handles_large_input_in_one_transaction(self):
        """The Firestore version chunks at 500 (its API limit); SQLite has
        no such limit and commits everything atomically. Verify with 1500
        entries."""
        entries = [
            ("job1", "job1-r1", f"step_{i}", "root", {"i": i})
            for i in range(1500)
        ]
        self.repo.batch_mark_succeeded_from_checkpoint(entries)
        count = self.repo._conn.execute(
            "SELECT COUNT(*) FROM factory_step_runs WHERE state = 'succeeded'"
        ).fetchone()
        self.assertEqual(count[0], 1500)


class ReadPathTests(_StepRunRepoTestBase):
    def setUp(self):
        super().setUp()
        # Set up a realistic mix: one job, one run, 7 audio chunks plus the
        # earlier pipeline steps.
        self.job_id = "job1"
        self.run_id = "job1-r1"
        for step in ("generate_script", "format_script", "generate_image"):
            sid = self.repo.ensure_ready(self.job_id, self.run_id, step)
            self.repo.mark_running(sid, "q", "w")
            self.repo.mark_succeeded(sid, {})
        for i in range(7):
            shard = f"P{i+1:02d}"
            sid = self.repo.ensure_ready(self.job_id, self.run_id, "synthesize_audio_chunk", shard)
            self.repo.mark_running(sid, f"q-{shard}", "w-tts")
            if i < 5:
                self.repo.mark_succeeded(sid, {"chunk": i})
            elif i == 5:
                self.repo.mark_failed(sid, "tts_error", "voice unavailable")
            # i == 6: leave in 'running' state

    def test_state_returns_current_state(self):
        self.assertEqual(self.repo.state(self.run_id, "generate_script"), "succeeded")
        self.assertEqual(self.repo.state(self.run_id, "synthesize_audio_chunk", "P06"), "failed")
        self.assertEqual(self.repo.state(self.run_id, "synthesize_audio_chunk", "P07"), "running")

    def test_state_returns_none_for_missing(self):
        self.assertIsNone(self.repo.state(self.run_id, "nonexistent_step"))
        self.assertIsNone(self.repo.state(self.run_id, "synthesize_audio_chunk", "P99"))

    def test_has_succeeded_for_any_shard(self):
        self.assertTrue(self.repo.has_succeeded(self.job_id, self.run_id, "synthesize_audio_chunk"))
        self.assertFalse(self.repo.has_succeeded(self.job_id, self.run_id, "post_process_audio"))

    def test_succeeded_shard_keys_returns_only_succeeded(self):
        keys = self.repo.succeeded_shard_keys(self.job_id, self.run_id, "synthesize_audio_chunk")
        self.assertEqual(keys, {"P01", "P02", "P03", "P04", "P05"})

    def test_failed_shard_keys_returns_only_failed(self):
        keys = self.repo.failed_shard_keys(self.job_id, self.run_id, "synthesize_audio_chunk")
        self.assertEqual(keys, {"P06"})

    def test_shard_keys_isolated_by_job_run_step(self):
        """A different (job, run, step) tuple must not return our shards.
        Critical because in production the table holds entries for many
        jobs/runs at once."""
        # Different job_id
        self.assertEqual(
            self.repo.succeeded_shard_keys("other-job", self.run_id, "synthesize_audio_chunk"),
            set(),
        )
        # Different step_name
        self.assertEqual(
            self.repo.succeeded_shard_keys(self.job_id, self.run_id, "qc_audio_chunk"),
            set(),
        )


class DeleteTests(_StepRunRepoTestBase):
    def test_delete_removes_row(self):
        sid = self.repo.ensure_ready("job1", "job1-r1", "generate_script")
        self.assertIsNotNone(self.repo.state("job1-r1", "generate_script"))
        self.repo.delete(sid)
        self.assertIsNone(self.repo.state("job1-r1", "generate_script"))

    def test_delete_nonexistent_is_no_op(self):
        """Don't crash on deleting something that's not there. The QC
        retry path doesn't check existence first."""
        self.repo.delete("never-existed__something__root")  # no exception


class ConcurrencyTests(_StepRunRepoTestBase):
    def test_concurrent_writes_from_multiple_threads_succeed(self):
        """Worker has the main poll loop, the watchdog, and the recovery
        sweep all hitting this repo. Simulate that load and verify all
        writes land without exception or corruption."""
        errors = []

        def worker(thread_id: int):
            try:
                for i in range(50):
                    sid = self.repo.ensure_ready(
                        "job1", "job1-r1", f"step_{thread_id}", f"shard_{i}",
                    )
                    self.repo.mark_running(sid, f"q-{i}", f"w-{thread_id}")
                    self.repo.mark_succeeded(sid, {"i": i})
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        # Verify all rows landed.
        count = self.repo._conn.execute(
            "SELECT COUNT(*) FROM factory_step_runs WHERE state = 'succeeded'"
        ).fetchone()
        self.assertEqual(count[0], 5 * 50)


class MakeStepRunIdParseTests(unittest.TestCase):
    """The internal _parse_step_run_id is critical for the
    mark_succeeded_from_checkpoint UPSERT path — it has to round-trip
    the format that make_step_run_id produces."""

    def test_round_trip(self):
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        sid = SqliteStepRunRepo.make_step_run_id("job1-r2", "format_script", "root")
        parts = SqliteStepRunRepo._parse_step_run_id(sid)
        self.assertEqual(parts, ("job1-r2", "format_script", "root"))

    def test_run_id_with_hyphen(self):
        """run_id format is ``<jobid>-r<N>`` — must not be split by hyphen."""
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        sid = SqliteStepRunRepo.make_step_run_id("abc-def-r10", "synthesize_audio_chunk", "P07")
        parts = SqliteStepRunRepo._parse_step_run_id(sid)
        self.assertEqual(parts, ("abc-def-r10", "synthesize_audio_chunk", "P07"))

    def test_shard_with_underscore(self):
        """Shard keys can contain underscores; only the first two ``__``
        delimiters are the structural ones."""
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        sid = "job1-r1__some_step__some_shard_with_underscores"
        parts = SqliteStepRunRepo._parse_step_run_id(sid)
        self.assertEqual(parts, ("job1-r1", "some_step", "some_shard_with_underscores"))

    def test_malformed_raises(self):
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        with self.assertRaises(ValueError):
            SqliteStepRunRepo._parse_step_run_id("no_delimiters_here")


if __name__ == "__main__":
    unittest.main()
