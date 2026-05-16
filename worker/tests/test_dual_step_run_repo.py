"""Tests for DualStepRunRepo.

The dual-write contract for step_runs is subtly different from events:
events is write-only (mirror failures cost audit-log entries but
nothing else); step_runs is read AND written by the worker, and reads
must be strongly consistent or the orchestrator's fan-in races.

So the key contracts pinned here:

  1. **Writes go to BOTH** (primary sync, mirror async). All 12 write
     methods exercised.
  2. **Reads route to PRIMARY ONLY.** A mirror failure or stale mirror
     state cannot affect the worker's view. This is the property that
     fixes the eventual-consistency race structurally.
  3. **Mirror failures don't propagate** — same as Phase 1 events.
  4. **Mirror ordering is preserved.** Important here because step state
     transitions have causal order (ready → running → succeeded);
     admin UI watching Firestore should see the same sequence.

Uses thread-safe in-memory fakes for both backends so tests are fast
and deterministic. The real SQLite backend is exercised by
test_sqlite_step_run_repo.py.
"""
from __future__ import annotations

import os
import sys
import threading
import time
import unittest

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class _RecordingStepRunRepo:
    """Thread-safe fake. Records every call as a tuple so tests can
    assert on the call sequence and the per-method arguments."""

    def __init__(self, fail_count: int = 0):
        self.calls: list[tuple] = []  # (method_name, *args)
        # State snapshot for reads — set by tests directly.
        self._state: dict[str, str | None] = {}
        self._succeeded_shards: dict[tuple, set[str]] = {}
        self._failed_shards: dict[tuple, set[str]] = {}
        self.fail_count = fail_count
        self._lock = threading.Lock()
        self._counter = 0

    def _record(self, method: str, *args, **kwargs):
        with self._lock:
            if self.fail_count > 0:
                self.fail_count -= 1
                raise RuntimeError(f"simulated {method} failure")
            self.calls.append((method, args, kwargs))
            self._counter += 1

    # Writes
    def ensure_ready(self, job_id, run_id, step_name, shard_key="root"):
        self._record("ensure_ready", job_id, run_id, step_name, shard_key)
        return f"{run_id}__{step_name}__{shard_key}"

    def mark_running(self, step_run_id, queue_id, worker_id, attempt=1, *, started_at=None, deadline_at=None):
        self._record("mark_running", step_run_id, queue_id, worker_id, attempt,
                     started_at=started_at, deadline_at=deadline_at)

    def heartbeat(self, step_run_id, worker_id, *, deadline_at, progress_detail=None):
        self._record("heartbeat", step_run_id, worker_id,
                     deadline_at=deadline_at, progress_detail=progress_detail)

    def mark_succeeded(self, step_run_id, output):
        self._record("mark_succeeded", step_run_id, output)

    def mark_succeeded_from_checkpoint(self, step_run_id, output):
        self._record("mark_succeeded_from_checkpoint", step_run_id, output)

    def batch_mark_succeeded_from_checkpoint(self, entries):
        self._record("batch_mark_succeeded_from_checkpoint", entries)

    def mark_failed(self, step_run_id, error_code, error_message):
        self._record("mark_failed", step_run_id, error_code, error_message)

    def mark_retry_scheduled(self, step_run_id, error_code, error_message, next_attempt, delay_seconds):
        self._record("mark_retry_scheduled", step_run_id, error_code, error_message,
                     next_attempt, delay_seconds)

    def mark_waiting(self, step_run_id, delay_seconds):
        self._record("mark_waiting", step_run_id, delay_seconds)

    def delete(self, step_run_id):
        self._record("delete", step_run_id)

    # Reads — set by test setUp directly via the public dicts above.
    def state(self, run_id, step_name, shard_key="root"):
        with self._lock:
            self.calls.append(("state", (run_id, step_name, shard_key), {}))
        return self._state.get(f"{run_id}__{step_name}__{shard_key}")

    def has_succeeded(self, job_id, run_id, step_name):
        with self._lock:
            self.calls.append(("has_succeeded", (job_id, run_id, step_name), {}))
        return bool(self._succeeded_shards.get((job_id, run_id, step_name)))

    def succeeded_shard_keys(self, job_id, run_id, step_name):
        with self._lock:
            self.calls.append(("succeeded_shard_keys", (job_id, run_id, step_name), {}))
        return set(self._succeeded_shards.get((job_id, run_id, step_name), set()))

    def failed_shard_keys(self, job_id, run_id, step_name):
        with self._lock:
            self.calls.append(("failed_shard_keys", (job_id, run_id, step_name), {}))
        return set(self._failed_shards.get((job_id, run_id, step_name), set()))


class DualStepRunRepoWriteTests(unittest.TestCase):
    """Every write method writes to BOTH primary and mirror. Primary
    is synchronous; mirror is async via the dispatcher."""

    def _make_repo(self, primary=None, mirror=None):
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        primary = primary or _RecordingStepRunRepo()
        mirror = mirror or _RecordingStepRunRepo()
        return DualStepRunRepo(primary, mirror), primary, mirror

    def test_ensure_ready_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            sid = repo.ensure_ready("job1", "job1-r1", "generate_script", "root")
            self.assertEqual(sid, "job1-r1__generate_script__root")
            self.assertTrue(repo.flush(timeout=2.0))
            # Both got the call
            self.assertEqual(len(primary.calls), 1)
            self.assertEqual(len(mirror.calls), 1)
            # Same args
            self.assertEqual(primary.calls[0][:2], mirror.calls[0][:2])
        finally:
            repo.close()

    def test_mark_running_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.mark_running("sid", "q1", "w1", attempt=2)
            self.assertTrue(repo.flush(timeout=2.0))
            self.assertEqual(primary.calls[0][0], "mark_running")
            self.assertEqual(mirror.calls[0][0], "mark_running")
            # attempt value propagated to both
            self.assertEqual(primary.calls[0][1], ("sid", "q1", "w1", 2))
            self.assertEqual(mirror.calls[0][1], ("sid", "q1", "w1", 2))
        finally:
            repo.close()

    def test_heartbeat_writes_both(self):
        from datetime import datetime, timezone, timedelta
        repo, primary, mirror = self._make_repo()
        deadline = datetime.now(timezone.utc) + timedelta(seconds=60)
        try:
            repo.heartbeat("sid", "w1", deadline_at=deadline, progress_detail="halfway")
            self.assertTrue(repo.flush(timeout=2.0))
            for r in (primary, mirror):
                self.assertEqual(r.calls[0][0], "heartbeat")
                self.assertEqual(r.calls[0][2]["progress_detail"], "halfway")
        finally:
            repo.close()

    def test_mark_succeeded_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.mark_succeeded("sid", {"word_count": 240})
            self.assertTrue(repo.flush(timeout=2.0))
            self.assertEqual(primary.calls[0], ("mark_succeeded", ("sid", {"word_count": 240}), {}))
            self.assertEqual(mirror.calls[0], ("mark_succeeded", ("sid", {"word_count": 240}), {}))
        finally:
            repo.close()

    def test_mark_failed_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.mark_failed("sid", "boom", "everything broke")
            self.assertTrue(repo.flush(timeout=2.0))
            for r in (primary, mirror):
                self.assertEqual(r.calls[0], ("mark_failed", ("sid", "boom", "everything broke"), {}))
        finally:
            repo.close()

    def test_mark_retry_scheduled_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.mark_retry_scheduled("sid", "transient", "timeout", 2, 30)
            self.assertTrue(repo.flush(timeout=2.0))
            for r in (primary, mirror):
                self.assertEqual(
                    r.calls[0],
                    ("mark_retry_scheduled", ("sid", "transient", "timeout", 2, 30), {}),
                )
        finally:
            repo.close()

    def test_mark_waiting_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.mark_waiting("sid", 15)
            self.assertTrue(repo.flush(timeout=2.0))
            for r in (primary, mirror):
                self.assertEqual(r.calls[0], ("mark_waiting", ("sid", 15), {}))
        finally:
            repo.close()

    def test_delete_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.delete("sid")
            self.assertTrue(repo.flush(timeout=2.0))
            for r in (primary, mirror):
                self.assertEqual(r.calls[0], ("delete", ("sid",), {}))
        finally:
            repo.close()

    def test_mark_succeeded_from_checkpoint_writes_both(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.mark_succeeded_from_checkpoint("sid", {"reused": True})
            self.assertTrue(repo.flush(timeout=2.0))
            for r in (primary, mirror):
                self.assertEqual(
                    r.calls[0],
                    ("mark_succeeded_from_checkpoint", ("sid", {"reused": True}), {}),
                )
        finally:
            repo.close()

    def test_batch_mark_succeeded_from_checkpoint_writes_both(self):
        repo, primary, mirror = self._make_repo()
        entries = [
            ("job1", "job1-r1", "generate_script", "root", {"reused": True}),
            ("job1", "job1-r1", "format_script", "root", {"reused": True}),
        ]
        try:
            repo.batch_mark_succeeded_from_checkpoint(entries)
            self.assertTrue(repo.flush(timeout=2.0))
            # Both repos got the full list in one call (matches the
            # SQLite single-transaction semantics)
            for r in (primary, mirror):
                self.assertEqual(r.calls[0][0], "batch_mark_succeeded_from_checkpoint")
                self.assertEqual(len(r.calls[0][1][0]), 2)
        finally:
            repo.close()

    def test_batch_snapshot_caller_can_reuse_list(self):
        """The dispatcher runs the mirror write later (on a background
        thread). If we passed the list by reference and the caller
        mutated it, the mirror would see different data than the
        primary. Pin that we snapshot."""
        repo, primary, mirror = self._make_repo()
        entries = [("job1", "job1-r1", "step_a", "root", {"i": 1})]
        try:
            repo.batch_mark_succeeded_from_checkpoint(entries)
            entries.clear()  # caller mutates after our call returns
            entries.append(("job2", "job2-r1", "step_b", "root", {"i": 999}))
            self.assertTrue(repo.flush(timeout=2.0))
            # Mirror must have seen the ORIGINAL entry, not the mutated one.
            mirror_entries = mirror.calls[0][1][0]
            self.assertEqual(mirror_entries[0][2], "step_a")
        finally:
            repo.close()


class DualStepRunRepoReadTests(unittest.TestCase):
    """Reads route to PRIMARY only — never the mirror. This is the
    property that fixes the eventual-consistency race structurally."""

    def _make_repo(self):
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        primary = _RecordingStepRunRepo()
        mirror = _RecordingStepRunRepo()
        return DualStepRunRepo(primary, mirror), primary, mirror

    def test_state_reads_primary_only(self):
        repo, primary, mirror = self._make_repo()
        primary._state["job1-r1__generate_script__root"] = "succeeded"
        mirror._state["job1-r1__generate_script__root"] = "WRONG"  # would mislead if read
        try:
            result = repo.state("job1-r1", "generate_script")
            self.assertEqual(result, "succeeded")
            # Primary saw the read; mirror did NOT.
            self.assertEqual(len(primary.calls), 1)
            self.assertEqual(len(mirror.calls), 0)
        finally:
            repo.close()

    def test_has_succeeded_reads_primary_only(self):
        repo, primary, mirror = self._make_repo()
        primary._succeeded_shards[("job1", "job1-r1", "synthesize_audio_chunk")] = {"P01"}
        mirror._succeeded_shards[("job1", "job1-r1", "synthesize_audio_chunk")] = set()
        try:
            self.assertTrue(repo.has_succeeded("job1", "job1-r1", "synthesize_audio_chunk"))
            self.assertEqual(len(primary.calls), 1)
            self.assertEqual(len(mirror.calls), 0)
        finally:
            repo.close()

    def test_succeeded_shard_keys_reads_primary_only(self):
        repo, primary, mirror = self._make_repo()
        primary._succeeded_shards[("job1", "job1-r1", "synthesize_audio_chunk")] = {"P01", "P02"}
        mirror._succeeded_shards[("job1", "job1-r1", "synthesize_audio_chunk")] = {"WRONG"}
        try:
            self.assertEqual(
                repo.succeeded_shard_keys("job1", "job1-r1", "synthesize_audio_chunk"),
                {"P01", "P02"},
            )
            self.assertEqual(len(mirror.calls), 0)
        finally:
            repo.close()

    def test_failed_shard_keys_reads_primary_only(self):
        repo, primary, mirror = self._make_repo()
        primary._failed_shards[("job1", "job1-r1", "synthesize_audio_chunk")] = {"P03"}
        try:
            self.assertEqual(
                repo.failed_shard_keys("job1", "job1-r1", "synthesize_audio_chunk"),
                {"P03"},
            )
            self.assertEqual(len(mirror.calls), 0)
        finally:
            repo.close()

    def test_reads_unaffected_by_mirror_being_broken(self):
        """The whole point: a flaky / disconnected mirror cannot corrupt
        reads. The orchestrator can always trust read results regardless
        of mirror state."""
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        primary = _RecordingStepRunRepo()
        # Mirror raises on EVERY call.
        mirror = _RecordingStepRunRepo(fail_count=10**6)
        repo = DualStepRunRepo(primary, mirror)
        primary._state["job1-r1__generate_script__root"] = "running"
        try:
            self.assertEqual(repo.state("job1-r1", "generate_script"), "running")
        finally:
            repo.close()


class DualStepRunRepoFailureToleranceTests(unittest.TestCase):
    """Mirror failures must never break the worker — same contract as
    DualEventRepo from Phase 1."""

    def test_mirror_failure_does_not_propagate(self):
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        primary = _RecordingStepRunRepo()
        mirror = _RecordingStepRunRepo(fail_count=10)
        repo = DualStepRunRepo(primary, mirror)
        try:
            for i in range(10):
                # Must NOT raise even though every mirror write fails.
                repo.mark_running(f"sid-{i}", "q", "w")
            self.assertTrue(repo.flush(timeout=2.0))
            self.assertEqual(len(primary.calls), 10)
            metrics = repo.metrics()
            self.assertEqual(metrics["failures"], 10)
            self.assertEqual(metrics["success"], 0)
        finally:
            repo.close()

    def test_primary_failure_propagates(self):
        """Primary errors are real — caller must see them so the
        claim_loop can retry or fail the step."""
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        primary = _RecordingStepRunRepo(fail_count=1)
        mirror = _RecordingStepRunRepo()
        repo = DualStepRunRepo(primary, mirror)
        try:
            with self.assertRaises(RuntimeError):
                repo.mark_running("sid", "q", "w")
        finally:
            repo.close()

    def test_constructor_rejects_none_backends(self):
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        with self.assertRaises(ValueError):
            DualStepRunRepo(None, _RecordingStepRunRepo())
        with self.assertRaises(ValueError):
            DualStepRunRepo(_RecordingStepRunRepo(), None)


class DualStepRunRepoAsyncContractTests(unittest.TestCase):
    """The mirror runs in the background. Pin that primary writes don't
    block on mirror latency — same property as DualEventRepo."""

    def test_slow_mirror_does_not_slow_primary_path(self):
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo

        class _SlowMirror:
            def __init__(self):
                self.calls = 0
                self._lock = threading.Lock()

            def __getattr__(self, name):
                """Catch-all so any method on the mirror is slow."""
                def slow_call(*args, **kwargs):
                    time.sleep(0.5)
                    with self._lock:
                        self.calls += 1
                return slow_call

        primary = _RecordingStepRunRepo()
        mirror = _SlowMirror()
        repo = DualStepRunRepo(primary, mirror)
        try:
            start = time.time()
            for _ in range(5):
                repo.mark_running("sid", "q", "w")
            elapsed = time.time() - start
            self.assertLess(
                elapsed, 0.2,
                f"mark_running blocked on slow mirror; took {elapsed:.3f}s for 5 calls",
            )
        finally:
            repo.close()


class DualStepRunRepoOrderingTests(unittest.TestCase):
    """Mirror sees state transitions in the same order as primary.
    Important because the admin UI watches Firestore for the timeline."""

    def test_mirror_sees_state_transitions_in_order(self):
        from factory_v2.infrastructure.dual_repos import DualStepRunRepo
        primary = _RecordingStepRunRepo()
        mirror = _RecordingStepRunRepo()
        repo = DualStepRunRepo(primary, mirror)
        try:
            sid = repo.ensure_ready("job1", "job1-r1", "step1")
            repo.mark_running(sid, "q1", "w1")
            repo.mark_succeeded(sid, {"x": 1})
            self.assertTrue(repo.flush(timeout=2.0))
            # Mirror should see them in submission order.
            mirror_methods = [call[0] for call in mirror.calls]
            self.assertEqual(
                mirror_methods,
                ["ensure_ready", "mark_running", "mark_succeeded"],
            )
        finally:
            repo.close()


if __name__ == "__main__":
    unittest.main()
