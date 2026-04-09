"""Firestore snapshot listener for real-time worker wake-ups.

Architectural Role:
    Instead of polling Firestore on a timer, this module uses the
    Observer pattern via Firestore's ``on_snapshot`` API.  Firestore
    maintains a persistent gRPC stream to the server; when a document
    matching the query changes, the server pushes a snapshot to the
    client and our callback fires.

    Flow:
        1. ``start_job_listener`` registers a query on ``content_jobs``
           where ``status in ["pending", "publishing"]``.
        2. Firestore calls ``on_snapshot`` whenever a document is added
           or modified to match that query.
        3. The callback deduplicates the job_id (via ``WakeDeduper``),
           applies a short debounce, then calls ``ensure_running`` to
           spin up workers if none are active.

    This gives near-instant reaction to new jobs without burning CPU
    in a tight poll loop.

Key Dependencies:
    - firebase_admin.firestore -- provides ``on_snapshot`` for the
      push-based listener.
    - dedupe.WakeDeduper -- prevents duplicate wake-ups when the same
      job triggers multiple snapshot events.

Consumed By:
    - control_loop.py -- calls ``start_job_listener`` once at startup.
"""

import time
from typing import Callable

from firebase_admin import firestore

from observability import get_logger

logger = get_logger(__name__)


def start_job_listener(
    db,
    deduper,
    ensure_running: Callable[[bool], None],
    force_immediate_start: bool,
    debounce_sec: float = 0.15,
):
    """Subscribe to pending/publishing jobs and trigger ``ensure_running``.

    Uses Firestore ``on_snapshot`` (server-push) instead of polling, so
    new jobs are detected within milliseconds.

    Args:
        db: Firestore client instance.
        deduper: A ``WakeDeduper`` to suppress duplicate wake signals.
        ensure_running: Callback that starts workers.  Receives a single
            bool indicating whether to force an immediate subprocess
            spawn (True) or just update desired state (False).
        force_immediate_start: Passed through to ``ensure_running``.
        debounce_sec: Minimum interval between consecutive wake triggers.
            Prevents a burst of snapshot events from calling
            ``ensure_running`` many times in rapid succession.

    Returns:
        The Firestore listener handle (can be used to ``unsubscribe()``).
    """
    # Watch for jobs that need processing -- "pending" (queued) or
    # "publishing" (in-flight but may need a worker to resume).
    query = (
        db.collection("content_jobs")
        .where("status", "in", ["pending", "publishing"])
    )

    # Mutable timestamp shared with the closure below for debounce logic.
    last_trigger_ts = 0.0

    def on_snapshot(docs, changes, _read_time):
        """Firestore callback -- invoked on the snapshot-listener thread.

        ``changes`` contains only the documents that actually changed
        since the last snapshot, so we iterate those rather than the
        full ``docs`` list.
        """
        nonlocal last_trigger_ts
        triggered = False
        for change in changes:
            # REMOVED changes mean a job left the query (e.g. status
            # changed to "completed") -- nothing for us to do.
            if change.type.name not in ("ADDED", "MODIFIED"):
                continue
            doc = change.document
            data = doc.to_dict() or {}
            status = data.get("status")
            if status not in ("pending", "publishing"):
                continue
            job_id = doc.id
            if deduper.is_duplicate(job_id):
                logger.debug("Listener wake ignored duplicate", extra={"job_id": job_id})
                continue
            triggered = True

        if triggered:
            # Debounce: if we already woke workers very recently, skip.
            now = time.time()
            if now - last_trigger_ts < debounce_sec:
                return
            last_trigger_ts = now
            try:
                ensure_running(force_immediate_start)
            except Exception as exc:
                logger.exception("Listener ensure_running failed", extra={"error": str(exc)})

    # on_snapshot returns a handle; keep it alive so the listener is not
    # garbage-collected.  The caller stores this in the control-loop state.
    listener = query.on_snapshot(on_snapshot)
    logger.info("Job listener started", extra={"listener": True})
    return listener
