"""Dual-write repository wrappers (SQLite primary + Firestore mirror).

Part of the incremental Firestore → SQLite migration. See
``worker/LOCAL_STORAGE_MIGRATION.md`` for the full plan.

Design:
- Each Dual repo composes one *primary* and one *mirror* backend.
- Writes go to the primary synchronously (transactional, source of
  truth) and to the mirror asynchronously via a bounded background
  queue (best-effort, for admin-UI visibility).
- Reads (when needed) come from the primary.
- Mirror failures are logged but never crash the worker — the audit
  trail / admin display might miss some rows, but the pipeline keeps
  moving.

Why async mirror:
- The whole point of moving to SQLite is to stop paying Firestore
  latency on every write. A synchronous mirror would defeat that.
- For events specifically: ordering matters across the audit log, but
  a single background consumer preserves it (FIFO queue + single
  consumer thread).
- For higher-stakes collections in later phases (step_runs, queue):
  same MirrorDispatcher applies, semantics still work because each
  collection has its own dispatcher with its own ordering.

Failure modes handled:
- Mirror raises: caught + counted + logged, primary unaffected.
- Mirror is unreachable for long stretches: queue grows up to its
  bounded cap, then drops oldest on overflow (newer events are
  usually more useful for debugging than old ones).
- Worker SIGTERM'd: daemon thread auto-dies. Last few in-flight
  mirror writes are lost. Acceptable for audit-only data; future
  phases for state-bearing collections will revisit.
- Process clean shutdown (tests, graceful stop): call ``close()``
  to flush the queue (with timeout) and join the thread.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Callable


logger = logging.getLogger(__name__)


class MirrorDispatcher:
    """Background thread + bounded queue for fire-and-forget mirror writes.

    Generic so each Dual repo type (events, step_runs, queue, …) can
    compose its own instance. One dispatcher = one queue = one
    consumer thread; ordering is preserved within the queue.

    Producer-side methods (``submit``, ``metrics``, ``close``) are
    thread-safe. Multiple producer threads can submit concurrently.
    """

    def __init__(self, name: str, max_queue: int = 10_000):
        self._name = name
        self._queue: queue.Queue[Callable[[], None]] = queue.Queue(maxsize=max_queue)
        self._stop = threading.Event()
        # Counters are integer reads/writes — atomic in CPython. No lock needed.
        self._drops = 0
        self._failures = 0
        self._success = 0
        # daemon=True so the thread auto-dies on process exit (SIGTERM
        # under launchd). Audit log can lose the last few events; that's
        # the right tradeoff vs blocking shutdown on a slow Firestore.
        self._thread = threading.Thread(
            target=self._run,
            daemon=True,
            name=f"mirror-{name}",
        )
        self._thread.start()

    def submit(self, fn: Callable[[], None]) -> None:
        """Enqueue a mirror operation. Non-blocking.

        On overflow, drops the OLDEST queued operation (not the new
        one). Rationale: when Firestore is slow, the newest events
        usually carry the most diagnostic value — what's happening
        *right now*. Losing stale old events from a backlog is the
        less-bad outcome.
        """
        try:
            self._queue.put_nowait(fn)
            return
        except queue.Full:
            pass
        # Drop the oldest pending op to make room. There's a small
        # race where the consumer drains an item between our two
        # operations — that's fine, fewer drops needed.
        try:
            self._queue.get_nowait()
            self._drops += 1
        except queue.Empty:
            pass
        try:
            self._queue.put_nowait(fn)
        except queue.Full:
            # Another producer raced us; rather than loop, just drop
            # this op. Rare in practice.
            self._drops += 1

    def _run(self) -> None:
        """Consumer loop. Stops when ``_stop`` is set AND the queue is empty
        so that ``close()`` can flush pending writes."""
        while not self._stop.is_set() or not self._queue.empty():
            try:
                fn = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                fn()
                self._success += 1
            except Exception as exc:
                self._failures += 1
                logger.warning(
                    "mirror dispatch failed",
                    extra={
                        "dispatcher": self._name,
                        "error": f"{type(exc).__name__}: {exc}",
                    },
                )

    def flush(self, timeout: float = 5.0) -> bool:
        """Block until the queue drains, or timeout elapses.

        Returns ``True`` if the queue fully drained, ``False`` on
        timeout. Used by tests and by graceful shutdown paths that
        want to wait for the mirror to catch up before continuing.
        """
        deadline = time.time() + timeout
        while True:
            if self._queue.empty():
                return True
            if time.time() > deadline:
                return False
            time.sleep(0.01)

    def metrics(self) -> dict[str, int]:
        """Snapshot of dispatcher state. Cheap; safe to call frequently."""
        return {
            "queue_size": self._queue.qsize(),
            "drops": self._drops,
            "failures": self._failures,
            "success": self._success,
        }

    def close(self, timeout: float = 5.0) -> None:
        """Signal stop, wait for queue to drain (up to ``timeout``), join thread."""
        # Drain first so ``_stop`` doesn't cut off in-flight work.
        self.flush(timeout=timeout)
        self._stop.set()
        self._thread.join(timeout=timeout)


class DualEventRepo:
    """SQLite-primary + Firestore-mirror events log.

    Matches the ``emit(event_type, job_id, run_id, payload) -> str``
    signature of both backends. Writes go:
      1. Synchronously to the primary (SQLite). The returned id is
         the primary's id — that's what callers receive.
      2. Asynchronously to the mirror (Firestore) via the dispatcher.
         The mirror generates its own id; we don't try to make them
         match. If admins ever need to cross-reference, we can add a
         ``mirror_id`` column later.

    Failure semantics:
      - Primary failure: raises (the worker treats it as a real error).
      - Mirror failure: silent, counted in dispatcher metrics.
    """

    def __init__(
        self,
        primary,
        mirror,
        *,
        max_queue: int = 10_000,
        _dispatcher: MirrorDispatcher | None = None,
    ):
        if primary is None:
            raise ValueError("DualEventRepo requires a primary backend")
        if mirror is None:
            raise ValueError(
                "DualEventRepo requires a mirror backend; "
                "if you want primary-only, use the primary directly"
            )
        self._primary = primary
        self._mirror = mirror
        # Allow injecting a shared / pre-built dispatcher for tests.
        self._dispatcher = _dispatcher or MirrorDispatcher(
            name="events", max_queue=max_queue,
        )

    def emit(self, event_type: str, job_id: str, run_id: str, payload: dict) -> str:
        """Write to primary synchronously, schedule mirror asynchronously."""
        event_id = self._primary.emit(event_type, job_id, run_id, payload)
        # Capture by value into the closure so later mutations of the
        # arguments (unlikely but defensive) don't affect the mirror write.
        et, jid, rid, pl = event_type, job_id, run_id, payload
        mirror = self._mirror
        self._dispatcher.submit(lambda: mirror.emit(et, jid, rid, pl))
        return event_id

    def metrics(self) -> dict[str, int]:
        """Mirror dispatcher metrics — useful for monitoring + tests."""
        return self._dispatcher.metrics()

    def flush(self, timeout: float = 5.0) -> bool:
        """Wait for pending mirror writes to drain."""
        return self._dispatcher.flush(timeout=timeout)

    def close(self) -> None:
        """Stop the dispatcher. Does NOT close the underlying primary or
        mirror — the composition root owns those lifecycles."""
        self._dispatcher.close()
