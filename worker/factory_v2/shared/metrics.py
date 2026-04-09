"""Daily aggregate metric writers for completed or failed factory jobs.

Architectural Role:
    After each job finishes (success or failure), this module increments
    counters in a per-day ``factory_metrics`` Firestore document.  The
    admin dashboard reads these documents to render throughput charts,
    failure-rate graphs, and latency histograms.

    Metrics are bucketed by UTC date (``YYYY-MM-DD``).  Each document
    accumulates:
        - ``completed_total`` / ``failed_total`` -- raw counts
        - ``completed_by_type.*`` / ``failed_by_type.*`` -- per content type
        - ``failed_by_stage.*`` -- which pipeline step failed
        - ``duration_sec_sum`` / ``duration_sec_count`` -- for average latency
        - ``queue_latency_sec_sum`` / ``queue_latency_sec_count``
        - Timing breakdown fields when ``timingStatus == "exact"``

Key Dependencies:
    - firebase_admin.firestore  -- Firestore SDK (atomic ``Increment``)

Consumed By:
    - factory_v2 job completion / failure handlers
    - Admin metrics dashboard
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from firebase_admin import firestore as fs

from observability import get_logger

logger = get_logger(__name__)


def _coerce_datetime(value: Any) -> datetime | None:
    """Convert a Firestore timestamp (or Python datetime) to a datetime.

    Firestore can return timestamps as native ``datetime`` objects or as
    proprietary ``DatetimeWithNanoseconds`` objects.  This helper handles
    both, plus the older ``toDate()`` path used by some SDK versions.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if hasattr(value, "to_datetime"):
        return value.to_datetime()
    if hasattr(value, "toDate"):
        return value.toDate()
    return None


def record_job_metric(
    db,
    job_id: str,
    job_data: dict,
    outcome: str,
    stage: str | None = None,
    error: str | None = None,
) -> None:
    """Increment the per-day metrics document for one finished job outcome.

    Uses Firestore's atomic ``Increment`` transform so that concurrent
    workers updating the same day's document do not lose writes.

    Two timing paths are supported:
        1. **Exact** (``timingStatus == "exact"``): uses pre-computed timing
           fields from the lineage system (effective elapsed, worker time,
           reuse credits, wasted time, queue latency).
        2. **Approximate** (fallback): derives timing from ``createdAt``,
           ``startedAt``, and ``completedAt`` timestamps.

    The entire function is wrapped in a try/except so that a metrics
    write failure never blocks the main pipeline.
    """
    try:
        content_type = job_data.get("contentType", "unknown")
        date_key = datetime.now(timezone.utc).date().isoformat()
        doc_ref = db.collection("factory_metrics").document(date_key)

        updates: dict[str, Any] = {
            "lastUpdatedAt": fs.SERVER_TIMESTAMP,
        }

        if outcome == "completed":
            updates["completed_total"] = fs.Increment(1)
            updates[f"completed_by_type.{content_type}"] = fs.Increment(1)
        else:
            updates["failed_total"] = fs.Increment(1)
            updates[f"failed_by_type.{content_type}"] = fs.Increment(1)
            if stage:
                updates[f"failed_by_stage.{stage}"] = fs.Increment(1)
            if error:
                updates["last_error"] = error

        timing_status = str(job_data.get("timingStatus") or "").strip().lower()
        if timing_status == "exact":
            effective_elapsed_ms = float(job_data.get("effectiveElapsedMs") or 0)
            effective_worker_ms = float(job_data.get("effectiveWorkerMs") or 0)
            reuse_credit_ms = float(job_data.get("reuseCreditMs") or 0)
            wasted_worker_ms = float(job_data.get("wastedWorkerMs") or 0)
            queue_latency_ms = float(job_data.get("queueLatencyMs") or 0)

            if effective_elapsed_ms > 0:
                updates["effective_elapsed_sec_sum"] = fs.Increment(effective_elapsed_ms / 1000.0)
                updates["effective_elapsed_sec_count"] = fs.Increment(1)
            if effective_worker_ms > 0:
                updates["effective_worker_sec_sum"] = fs.Increment(effective_worker_ms / 1000.0)
                updates["effective_worker_sec_count"] = fs.Increment(1)
            if reuse_credit_ms > 0:
                updates["reuse_credit_sec_sum"] = fs.Increment(reuse_credit_ms / 1000.0)
            if wasted_worker_ms > 0:
                updates["wasted_worker_sec_sum"] = fs.Increment(wasted_worker_ms / 1000.0)
            if queue_latency_ms > 0:
                updates["queue_latency_sec_sum"] = fs.Increment(queue_latency_ms / 1000.0)
                updates["queue_latency_sec_count"] = fs.Increment(1)
        elif outcome == "completed":
            started_at = _coerce_datetime(
                job_data.get("startedAt")
                or job_data.get("ttsPendingAt")
                or job_data.get("createdAt")
            )
            completed_at = _coerce_datetime(job_data.get("completedAt"))
            if completed_at is None:
                completed_at = datetime.now(timezone.utc)

            if started_at and completed_at:
                duration_sec = max(0.0, (completed_at - started_at).total_seconds())
                updates["duration_sec_sum"] = fs.Increment(duration_sec)
                updates["duration_sec_count"] = fs.Increment(1)

            created_at = _coerce_datetime(job_data.get("createdAt"))
            if created_at and started_at:
                queue_latency_sec = max(0.0, (started_at - created_at).total_seconds())
                updates["queue_latency_sec_sum"] = fs.Increment(queue_latency_sec)
                updates["queue_latency_sec_count"] = fs.Increment(1)

        doc_ref.set(updates, merge=True)

    except Exception as exc:
        logger.exception(
            "Failed to record job metrics",
            extra={"job_id": job_id, "outcome": outcome, "error": str(exc)},
        )
