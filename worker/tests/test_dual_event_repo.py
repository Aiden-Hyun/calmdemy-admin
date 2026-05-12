"""Tests for DualEventRepo + MirrorDispatcher.

The Dual repo composes a primary (e.g. SQLite) and a mirror (e.g.
Firestore). These tests use thread-safe in-memory fakes so they run
fast and deterministically without touching either real backend —
that lets us pin the *behavior* of the dual-write contract independent
of which storage implementations are plugged in.

What's pinned:
  - emit() returns the PRIMARY's id (callers depend on this — the
    mirror's id is invisible to them).
  - Primary write is synchronous (visible to direct reads of the
    primary immediately after emit() returns).
  - Mirror write happens asynchronously (doesn't block the caller).
  - Mirror failures don't propagate — primary keeps working,
    dispatcher metrics tick up.
  - Mirror ordering is preserved (FIFO across the dispatcher queue).
  - Queue overflow drops OLDEST (the dispatcher's policy choice).
  - close() flushes pending writes.
  - Slow mirror doesn't slow the primary path (the whole point of
    async mirror — pinned with a timing assertion).
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


# ---------------- thread-safe in-memory fake repos ----------------

class _RecordingEventRepo:
    """Thread-safe fake. Records every emit() call. Optionally raises
    on the next ``fail_count`` calls (to simulate mirror failures)."""

    def __init__(self, fail_count: int = 0, slow_seconds: float = 0.0):
        self.events: list[tuple[str, str, str, str, dict]] = []
        self.fail_count = fail_count
        self.slow_seconds = slow_seconds
        self._lock = threading.Lock()
        self._counter = 0

    def emit(self, event_type, job_id, run_id, payload):
        if self.slow_seconds:
            time.sleep(self.slow_seconds)
        with self._lock:
            if self.fail_count > 0:
                self.fail_count -= 1
                raise RuntimeError("simulated emit failure")
            self._counter += 1
            event_id = f"evt-{self._counter}"
            self.events.append((event_id, event_type, job_id, run_id, payload))
            return event_id


class _BlockingMirror:
    """A mirror whose emit() blocks until ``release`` is set. Used to
    artificially fill the dispatcher's queue and test overflow."""

    def __init__(self):
        self.release = threading.Event()
        self.calls: list[tuple[str, str, str, str, dict]] = []
        self._lock = threading.Lock()

    def emit(self, event_type, job_id, run_id, payload):
        self.release.wait()
        with self._lock:
            self.calls.append((event_type, job_id, run_id, "x", payload))
            return f"mirror-{len(self.calls)}"


# ---------------- tests ----------------


class DualEventRepoTests(unittest.TestCase):
    def _make_repo(self, primary=None, mirror=None, max_queue: int = 10_000):
        from factory_v2.infrastructure.dual_repos import DualEventRepo
        primary = primary or _RecordingEventRepo()
        mirror = mirror or _RecordingEventRepo()
        return DualEventRepo(primary, mirror, max_queue=max_queue), primary, mirror

    # ----- primary semantics -----

    def test_emit_returns_primary_id(self):
        """Callers see the primary's id — the mirror's id is hidden."""
        repo, primary, _mirror = self._make_repo()
        try:
            event_id = repo.emit("step_started", "job-1", "job-1-r1", {"x": 1})
            self.assertEqual(event_id, "evt-1")
            self.assertEqual(len(primary.events), 1)
        finally:
            repo.close()

    def test_primary_write_is_synchronous(self):
        """After emit() returns, primary contains the row. No flush needed."""
        repo, primary, _mirror = self._make_repo()
        try:
            for i in range(5):
                repo.emit("t", "j", "r", {"i": i})
            # Read primary BEFORE flush — must already be there.
            self.assertEqual(len(primary.events), 5)
        finally:
            repo.close()

    def test_primary_failure_propagates(self):
        """Primary errors are real errors — callers must see them."""
        primary = _RecordingEventRepo(fail_count=1)
        repo, _, _ = self._make_repo(primary=primary)
        try:
            with self.assertRaises(RuntimeError):
                repo.emit("t", "j", "r", {})
        finally:
            repo.close()

    # ----- mirror semantics -----

    def test_mirror_write_happens_eventually(self):
        repo, primary, mirror = self._make_repo()
        try:
            repo.emit("t", "j", "r", {"i": 1})
            repo.emit("t", "j", "r", {"i": 2})
            self.assertTrue(repo.flush(timeout=2.0), "flush timed out")
            self.assertEqual(len(mirror.events), 2)
            self.assertEqual(len(primary.events), 2)
        finally:
            repo.close()

    def test_mirror_failure_does_not_propagate(self):
        """Mirror raises -> primary keeps working, dispatcher metrics
        record the failure, caller never sees it."""
        mirror = _RecordingEventRepo(fail_count=10)
        repo, primary, _ = self._make_repo(mirror=mirror)
        try:
            for i in range(10):
                # Must NOT raise even though mirror always fails.
                repo.emit("t", "j", "r", {"i": i})
            self.assertEqual(len(primary.events), 10)
            self.assertTrue(repo.flush(timeout=2.0))
            metrics = repo.metrics()
            self.assertEqual(metrics["failures"], 10)
            self.assertEqual(metrics["success"], 0)
        finally:
            repo.close()

    def test_mirror_ordering_preserved(self):
        """FIFO queue + single consumer thread => mirror sees events in
        the same order they were submitted. Important for audit-log
        readability even though the worker doesn't depend on it."""
        repo, _, mirror = self._make_repo()
        try:
            for i in range(50):
                repo.emit("t", "j", "r", {"i": i})
            self.assertTrue(repo.flush(timeout=3.0))
            seen = [payload["i"] for (_id, _t, _j, _r, payload) in mirror.events]
            self.assertEqual(seen, list(range(50)))
        finally:
            repo.close()

    # ----- dispatcher policy -----

    def test_queue_overflow_drops_oldest(self):
        """When the queue fills and a new submit arrives, the OLDEST
        pending mirror op gets dropped — preserving the freshest events
        (which are usually the most diagnostically valuable)."""
        mirror = _BlockingMirror()
        # max_queue=2: queue holds 2 pending + 1 in-flight on consumer.
        repo, primary, _ = self._make_repo(mirror=mirror, max_queue=2)
        try:
            # Submit 10. Consumer pulls first one and blocks on
            # mirror.release. Subsequent submissions fill queue +
            # trigger drops.
            for i in range(10):
                repo.emit("t", "j", "r", {"i": i})

            # Wait briefly so dispatcher has time to pull the first item
            # into the in-flight slot.
            time.sleep(0.05)

            metrics = repo.metrics()
            self.assertGreater(metrics["drops"], 0, "expected some drops with max_queue=2")
            self.assertEqual(len(primary.events), 10, "primary always accepts every write")

            # Now release the mirror and let everything drain.
            mirror.release.set()
            self.assertTrue(repo.flush(timeout=3.0))

            # Mirror received FEWER events than were submitted (some dropped).
            self.assertLess(
                len(mirror.calls), 10,
                f"expected fewer than 10 mirror calls, got {len(mirror.calls)}",
            )
            # The newest submission (i=9) survived to the mirror — that's
            # the whole point of drop-OLDEST.
            payloads = [c[4]["i"] for c in mirror.calls]
            self.assertIn(9, payloads, "newest event must always reach the mirror")
        finally:
            repo.close()

    def test_metrics_track_success_failure_drops(self):
        mirror = _RecordingEventRepo(fail_count=3)
        repo, _, _ = self._make_repo(mirror=mirror)
        try:
            for _ in range(5):
                repo.emit("t", "j", "r", {})
            self.assertTrue(repo.flush(timeout=2.0))
            metrics = repo.metrics()
            self.assertEqual(metrics["success"], 2, "5 total - 3 failures = 2 successes")
            self.assertEqual(metrics["failures"], 3)
            self.assertEqual(metrics["drops"], 0, "no overflow, no drops")
        finally:
            repo.close()

    # ----- async-ness -----

    def test_slow_mirror_does_not_slow_primary_path(self):
        """The whole point of async mirror: emit() returns fast even if
        mirror writes are slow. This pin protects against a future
        refactor that accidentally awaits the mirror write."""
        mirror = _RecordingEventRepo(slow_seconds=0.5)  # 500ms per mirror write
        repo, _, _ = self._make_repo(mirror=mirror)
        try:
            start = time.time()
            for _ in range(5):
                repo.emit("t", "j", "r", {})
            elapsed = time.time() - start
            # 5 emits should take <100ms total — primary writes are
            # in-memory, mirror runs in the background. If we
            # accidentally awaited the mirror, this would be >2.5s.
            self.assertLess(
                elapsed, 0.2,
                f"emit() blocked on mirror; took {elapsed:.3f}s for 5 calls",
            )
        finally:
            repo.close()

    # ----- lifecycle -----

    def test_close_flushes_pending_writes(self):
        repo, _, mirror = self._make_repo()
        # Don't try-finally because close() is what we're testing.
        for i in range(20):
            repo.emit("t", "j", "r", {"i": i})
        repo.close()
        # Without flush in close(), some writes would still be in-flight
        # when the thread joined.
        self.assertEqual(len(mirror.events), 20)

    def test_constructor_rejects_none_primary_or_mirror(self):
        """Pinned: a Dual repo needs both backends. If you only need
        one, use that backend directly — don't wrap it."""
        from factory_v2.infrastructure.dual_repos import DualEventRepo
        with self.assertRaises(ValueError):
            DualEventRepo(None, _RecordingEventRepo())
        with self.assertRaises(ValueError):
            DualEventRepo(_RecordingEventRepo(), None)


class MirrorDispatcherTests(unittest.TestCase):
    """Tests for the generic MirrorDispatcher independent of any repo.
    These will matter when later phases compose it for step_runs etc."""

    def test_submit_runs_function_in_background(self):
        from factory_v2.infrastructure.dual_repos import MirrorDispatcher
        d = MirrorDispatcher(name="test")
        called = threading.Event()
        try:
            d.submit(lambda: called.set())
            self.assertTrue(called.wait(timeout=2.0), "submitted fn never ran")
        finally:
            d.close()

    def test_failures_do_not_kill_consumer(self):
        """If one mirror op raises, subsequent ones must still execute."""
        from factory_v2.infrastructure.dual_repos import MirrorDispatcher
        d = MirrorDispatcher(name="test")
        ok_calls = []

        def fails():
            raise RuntimeError("boom")

        def ok():
            ok_calls.append(1)

        try:
            d.submit(fails)
            d.submit(ok)
            d.submit(fails)
            d.submit(ok)
            self.assertTrue(d.flush(timeout=2.0))
            metrics = d.metrics()
            self.assertEqual(metrics["failures"], 2)
            self.assertEqual(metrics["success"], 2)
            self.assertEqual(len(ok_calls), 2)
        finally:
            d.close()


if __name__ == "__main__":
    unittest.main()
