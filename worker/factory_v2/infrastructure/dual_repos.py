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


# ----------------------- factory functions -----------------------
# These let the composition root (worker_main.py / local_companion.py)
# pick a backend per collection via env var without knowing about each
# implementation. Adding a new mode is a one-line change.

import os


def make_event_repo(db, storage_mode: str | None = None):
    """Construct the events repo according to ``FACTORY_STORAGE_EVENTS``.

    Modes:
      - ``firestore`` (default): the legacy ``FirestoreEventRepo``. No
        change from pre-migration behavior — this is what every worker
        does today.
      - ``sqlite``: SqliteEventRepo only, no Firestore mirror. Admin UI
        loses the events feed; useful only for offline / dev.
      - ``dual``: ``DualEventRepo`` wrapping SQLite primary + Firestore
        mirror. Worker reads/writes hit SQLite (fast, consistent),
        Firestore continues receiving the same writes asynchronously so
        the admin UI keeps working.

    Args:
        db: Firestore client. Required for ``firestore`` and ``dual``
            modes; ignored for ``sqlite``.
        storage_mode: Override the env var. Mainly for tests.

    Returns:
        An object implementing ``emit(event_type, job_id, run_id, payload)
        -> str``. Caller doesn't need to know which backend.
    """
    # Lazy imports keep this module importable even on workers that
    # don't have firebase_admin installed (e.g. a future pure-SQLite
    # stack).
    if storage_mode is None:
        storage_mode = os.getenv("FACTORY_STORAGE_EVENTS", "firestore").strip().lower()

    if storage_mode == "sqlite":
        from .sqlite_repos import SqliteEventRepo
        logger.info("events repo: sqlite-only (no Firestore mirror)")
        return SqliteEventRepo()

    if storage_mode == "dual":
        from .firestore_repos import FirestoreEventRepo
        from .sqlite_repos import SqliteEventRepo
        logger.info("events repo: dual (SQLite primary + Firestore mirror)")
        return DualEventRepo(
            primary=SqliteEventRepo(),
            mirror=FirestoreEventRepo(db),
        )

    # Default / unknown values fall through to Firestore-only with a
    # log line. "Unknown" is intentionally not a hard error — if a
    # plist had a typo, we'd rather keep the worker running than crash
    # at startup.
    if storage_mode != "firestore":
        logger.warning(
            "unrecognized FACTORY_STORAGE_EVENTS=%r; defaulting to firestore",
            storage_mode,
        )
    from .firestore_repos import FirestoreEventRepo
    return FirestoreEventRepo(db)


# ---------------------------------------------------------------------------
# Step-run repository (Phase 2)
# ---------------------------------------------------------------------------


class DualStepRunRepo:
    """SQLite-primary + Firestore-mirror step-run repository.

    **Key difference from DualEventRepo**: step_runs are *read* by the
    worker, not just written. The whole point of routing the migration
    through SQLite is strong read-after-write consistency for the
    orchestrator's hot read paths (``succeeded_shard_keys``,
    ``failed_shard_keys``, ``state``, ``has_succeeded``). Those reads
    MUST come from the primary (SQLite) — if they routed to the mirror
    (Firestore) we'd be back to the eventual-consistency race that
    43f4e7b9 patched surgically.

    Pattern:
      - **Writes** go to SQLite synchronously (transactional, source of
        truth) AND to Firestore asynchronously via the same
        ``MirrorDispatcher`` Phase 1 introduced. The mirror keeps the
        admin UI's view of step state alive without changing the JS
        SDK.
      - **Reads** route to SQLite only. Strong consistency, zero
        Firestore round-trips on the hot path.

    Mirror failure semantics (same as DualEventRepo):
      - SQLite write failure → propagates (worker treats as real error).
      - Firestore mirror write failure → logged + counted, never raised.
      - Mirror queue overflow → drops OLDEST (newer state matters more).

    Caveat: this repo is intentionally NOT a drop-in replacement for
    ``FirestoreStepRunRepo`` when there's no SQLite primary. Construct
    via ``make_step_run_repo`` so the composition root picks the right
    backend based on ``FACTORY_STORAGE_STEP_RUNS``.
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
            raise ValueError("DualStepRunRepo requires a primary backend")
        if mirror is None:
            raise ValueError(
                "DualStepRunRepo requires a mirror backend; "
                "if you want primary-only, use the primary directly"
            )
        self._primary = primary
        self._mirror = mirror
        # Reuse the Phase 1 MirrorDispatcher unchanged. Per-collection
        # name so log lines distinguish events vs step_runs failures.
        self._dispatcher = _dispatcher or MirrorDispatcher(
            name="step_runs", max_queue=max_queue,
        )

    # ------------- read methods: primary only ----------------
    #
    # These never touch the mirror. The orchestrator depends on
    # read-after-write consistency for fan-in correctness; routing
    # reads to the mirror would reintroduce the very race we're
    # migrating to fix.

    def state(self, run_id: str, step_name: str, shard_key: str = "root") -> str | None:
        return self._primary.state(run_id, step_name, shard_key)

    def has_succeeded(self, job_id: str, run_id: str, step_name: str) -> bool:
        return self._primary.has_succeeded(job_id, run_id, step_name)

    def succeeded_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set:
        return self._primary.succeeded_shard_keys(job_id, run_id, step_name)

    def failed_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set:
        return self._primary.failed_shard_keys(job_id, run_id, step_name)

    @staticmethod
    def make_step_run_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
        # Pure helper; deterministic; identical format across backends.
        # Keep on the class for callers that import the type directly.
        return f"{run_id}__{step_name}__{shard_key}"

    # ------------- write methods: primary sync, mirror async ----------------

    def ensure_ready(self, job_id: str, run_id: str, step_name: str, shard_key: str = "root") -> str:
        step_run_id = self._primary.ensure_ready(job_id, run_id, step_name, shard_key)
        # Closure args bound now to defend against mutation by caller.
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.ensure_ready(job_id, run_id, step_name, shard_key)
        )
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
        self._primary.mark_running(
            step_run_id, queue_id, worker_id, attempt,
            started_at=started_at, deadline_at=deadline_at,
        )
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.mark_running(
                step_run_id, queue_id, worker_id, attempt,
                started_at=started_at, deadline_at=deadline_at,
            )
        )

    def heartbeat(
        self,
        step_run_id: str,
        worker_id: str,
        *,
        deadline_at,
        progress_detail: str | None = None,
    ) -> None:
        self._primary.heartbeat(
            step_run_id, worker_id, deadline_at=deadline_at, progress_detail=progress_detail,
        )
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.heartbeat(
                step_run_id, worker_id, deadline_at=deadline_at, progress_detail=progress_detail,
            )
        )

    def mark_succeeded(self, step_run_id: str, output: dict) -> None:
        self._primary.mark_succeeded(step_run_id, output)
        mirror = self._mirror
        self._dispatcher.submit(lambda: mirror.mark_succeeded(step_run_id, output))

    def mark_succeeded_from_checkpoint(self, step_run_id: str, output: dict) -> None:
        self._primary.mark_succeeded_from_checkpoint(step_run_id, output)
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.mark_succeeded_from_checkpoint(step_run_id, output)
        )

    def batch_mark_succeeded_from_checkpoint(
        self,
        entries: list[tuple[str, str, str, str, dict]],
    ) -> None:
        # Snapshot entries — caller might reuse the list after we return.
        entries_copy = list(entries)
        self._primary.batch_mark_succeeded_from_checkpoint(entries_copy)
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.batch_mark_succeeded_from_checkpoint(entries_copy)
        )

    def mark_failed(self, step_run_id: str, error_code: str, error_message: str) -> None:
        self._primary.mark_failed(step_run_id, error_code, error_message)
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.mark_failed(step_run_id, error_code, error_message)
        )

    def mark_retry_scheduled(
        self,
        step_run_id: str,
        error_code: str,
        error_message: str,
        next_attempt: int,
        delay_seconds: int,
    ) -> None:
        self._primary.mark_retry_scheduled(
            step_run_id, error_code, error_message, next_attempt, delay_seconds,
        )
        mirror = self._mirror
        self._dispatcher.submit(
            lambda: mirror.mark_retry_scheduled(
                step_run_id, error_code, error_message, next_attempt, delay_seconds,
            )
        )

    def mark_waiting(self, step_run_id: str, delay_seconds: int) -> None:
        self._primary.mark_waiting(step_run_id, delay_seconds)
        mirror = self._mirror
        self._dispatcher.submit(lambda: mirror.mark_waiting(step_run_id, delay_seconds))

    def delete(self, step_run_id: str) -> None:
        self._primary.delete(step_run_id)
        mirror = self._mirror
        self._dispatcher.submit(lambda: mirror.delete(step_run_id))

    # ------------- lifecycle / observability ----------------

    def metrics(self) -> dict[str, int]:
        return self._dispatcher.metrics()

    def flush(self, timeout: float = 5.0) -> bool:
        return self._dispatcher.flush(timeout=timeout)

    def close(self) -> None:
        """Stop the dispatcher. Does NOT close the underlying primary or
        mirror — the composition root owns those lifecycles."""
        self._dispatcher.close()
