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
    """Subscribe to pending jobs and trigger ensure_running without polling."""
    query = (
        db.collection("content_jobs")
        .where("status", "in", ["pending", "publishing"])
    )

    last_trigger_ts = 0.0

    def on_snapshot(docs, changes, _read_time):
        nonlocal last_trigger_ts
        triggered = False
        for change in changes:
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
            now = time.time()
            if now - last_trigger_ts < debounce_sec:
                return
            last_trigger_ts = now
            try:
                ensure_running(force_immediate_start)
            except Exception as exc:
                logger.exception("Listener ensure_running failed", extra={"error": str(exc)})

    listener = query.on_snapshot(on_snapshot)
    logger.info("Job listener started", extra={"listener": True})
    return listener
