"""Dispatcher that upgrades legacy ``content_jobs`` rows into V2 runs.

Architectural Role:
    The dispatcher is a **driving adapter** that bridges the old system
    into the new one.  Legacy ``content_jobs`` documents (created by the
    admin UI) have a flat document shape.  The dispatcher scans for
    eligible documents, transactionally locks one, and delegates to
    ``bootstrap_from_content_job`` which creates the V2 job/run/queue
    structure.

Design Patterns:
    * **Claim-or-Skip** -- A Firestore transaction sets ``v2Locked``
      atomically so that exactly one dispatcher (across all workers)
      processes a given job.  This avoids both duplicate work and
      external locking infrastructure.
    * **Stale Lock Recovery** -- If a dispatcher crashes after locking
      but before completing the bootstrap, the lock times out after
      ``_DISPATCH_LOCK_TIMEOUT_SECONDS`` and another worker can reclaim.
    * **Fail-Fast Validation** -- Worker capability checks happen inside
      the transaction so jobs that can never succeed are immediately
      marked ``failed`` with a clear admin-visible error.

Key Dependencies:
    * ``bootstrap_from_content_job`` (bootstrap.py) -- converts the
      legacy document into V2 state and starts the first run.
    * ``load_stack_config`` / ``any_enabled_stack_supports_tts_model``
      -- reads the cluster's capability matrix to pre-validate jobs.

Consumed By:
    * ``WorkerMain.run_forever`` calls ``dispatch_next_content_job``
      once per tick when the worker has dispatch capability.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from firebase_admin import firestore
from firebase_admin import firestore as fs

from observability import get_logger
from companion.stack_config import (
    any_enabled_stack_supports_tts_model,
    load_stack_config,
)
from .bootstrap import bootstrap_from_content_job

logger = get_logger(__name__)

# Only these legacy statuses are eligible for V2 dispatch.
# "pending" = brand-new job, "publishing" = manual re-publish request.
_DISPATCH_STATUSES = ("pending", "publishing")

# How long a v2Locked flag can sit before another worker reclaims it.
# Guards against dispatchers that crash mid-bootstrap.
_DISPATCH_LOCK_TIMEOUT_SECONDS = max(
    15,
    int(os.getenv("V2_DISPATCH_LOCK_TIMEOUT_SECONDS", "60")),
)


def _coerce_datetime(value) -> datetime | None:
    """Normalise Firestore timestamp variants into a stdlib ``datetime``.

    Firestore can return native ``datetime``, proto ``DatetimeWithNanoseconds``,
    or JavaScript-style wrapper objects depending on the SDK version.
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


def _is_stale_dispatch_lock(data: dict) -> bool:
    """Return True when a ``v2Locked`` flag has exceeded its timeout.

    This is the self-healing mechanism for the dispatch lock: if a worker
    dies after setting ``v2Locked`` but before finishing the bootstrap,
    another worker will eventually see the lock as stale and reclaim it.
    """
    if not data.get("v2Locked"):
        return False

    dispatched_at = _coerce_datetime(data.get("v2DispatchedAt"))
    if dispatched_at is None:
        # Lock exists but no timestamp -- definitely stale.
        return True
    if dispatched_at.tzinfo is None:
        dispatched_at = dispatched_at.replace(tzinfo=timezone.utc)

    age_seconds = (datetime.now(timezone.utc) - dispatched_at).total_seconds()
    return age_seconds >= _DISPATCH_LOCK_TIMEOUT_SECONDS


def _is_cloud_job(data: dict) -> bool:
    """Cloud-backend jobs are not supported by V2 -- reject early."""
    return data.get("llmBackend") == "cloud" or data.get("ttsBackend") == "cloud"


def _has_active_v2_run(transaction, db, data: dict) -> bool:
    """Check whether a V2 run is already in progress for this job.

    This prevents dispatching a second run when one is already executing,
    which would cause conflicting state updates.
    """
    run_id = str(data.get("v2RunId") or "").strip()
    if not run_id:
        return False

    run_snap = db.collection("factory_job_runs").document(run_id).get(transaction=transaction)
    if not run_snap.exists:
        return False

    run_state = str((run_snap.to_dict() or {}).get("state") or "").strip().lower()
    return run_state == "running"


def _claim_for_v2(
    db,
    doc_ref,
    worker_id: str,
    stack_defs: list[dict],
) -> Optional[tuple[dict, bool]]:
    """Atomically lock one eligible legacy job so exactly one dispatcher boots it.

    The Firestore transaction reads the current document state, applies a
    series of eligibility guards, and -- only if everything passes -- sets
    ``v2Locked = True``.  This is an optimistic-concurrency pattern:
    if two workers race, only the first writer wins; the second sees the
    lock and bails out.

    Returns:
        ``(job_data, recovered_stale_lock)`` on success, or ``None`` if
        the job was ineligible or already claimed.
    """
    tx = db.transaction()

    @firestore.transactional
    def _tx_claim(transaction):
        snap = doc_ref.get(transaction=transaction)
        if not snap.exists:
            return None

        data = snap.to_dict() or {}
        # --- Eligibility guards (evaluated inside the transaction) ---
        if data.get("status") not in _DISPATCH_STATUSES:
            return None
        if data.get("deleteRequested"):
            return None
        if _is_cloud_job(data):
            transaction.update(
                doc_ref,
                {
                    "status": "failed",
                    "error": "Unsupported backend: cloud",
                    "errorCode": "unsupported_backend",
                    "failedStage": "pending",
                    "lastRunStatus": "failed",
                    "runEndedAt": fs.SERVER_TIMESTAMP,
                    "updatedAt": fs.SERVER_TIMESTAMP,
                },
            )
            return None
        if data.get("status") == "pending":
            # We validate worker capability before bootstrapping the run so jobs
            # fail fast with a clear admin-visible message instead of stalling.
            if not any(
                stack.get("enabled", True) and stack.get("acceptNonTtsSteps", True)
                for stack in stack_defs
            ):
                message = (
                    "No enabled worker stack can execute non-TTS steps. "
                    "Enable a primary stack and retry."
                )
                transaction.update(
                    doc_ref,
                    {
                        "status": "failed",
                        "error": message,
                        "errorCode": "no_capable_stack",
                        "failedStage": "pending",
                        "lastRunStatus": "failed",
                        "runEndedAt": fs.SERVER_TIMESTAMP,
                        "v2DispatchError": message,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    },
                )
                return None
            required_tts_model = str(data.get("ttsModel") or "").strip().lower() or "qwen3-base"
            if not any_enabled_stack_supports_tts_model(stack_defs, required_tts_model):
                message = (
                    f"No enabled worker stack supports ttsModel '{required_tts_model}'. "
                    "Enable a capable stack and retry."
                )
                transaction.update(
                    doc_ref,
                    {
                        "status": "failed",
                        "error": message,
                        "errorCode": "no_capable_stack",
                        "failedStage": "tts_converting",
                        "lastRunStatus": "failed",
                        "runEndedAt": fs.SERVER_TIMESTAMP,
                        "v2DispatchError": message,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    },
                )
                return None
        if _has_active_v2_run(transaction, db, data):
            return None
        # Allow reclaiming a lock only when it has exceeded its timeout.
        recovered_stale_lock = _is_stale_dispatch_lock(data)
        if data.get("v2Locked") and not recovered_stale_lock:
            return None

        # --- All guards passed -- acquire the dispatch lock ---
        transaction.update(
            doc_ref,
            {
                "engine": "v2",
                "v2Locked": True,
                "v2DispatchError": None,
                "v2DispatchedBy": worker_id,
                "v2DispatchedAt": fs.SERVER_TIMESTAMP,
                "updatedAt": fs.SERVER_TIMESTAMP,
            },
        )
        return data, recovered_stale_lock

    return _tx_claim(tx)


def dispatch_next_content_job(db, worker_id: str) -> Optional[tuple[str, str]]:
    """Claim one eligible content job and bootstrap a V2 run.

    Iterates over each dispatch-eligible status (``pending`` first, then
    ``publishing``), scans up to 25 candidate docs per status ordered by
    creation time, and attempts to claim each via ``_claim_for_v2``.
    The first successful claim triggers the bootstrap and returns.

    Returns:
        ``(content_job_id, run_id)`` on success, or ``None`` if no
        eligible job was found.
    """
    jobs = db.collection("content_jobs")
    # Load the current stack capability matrix so we can fail-fast inside
    # the transaction when no worker can handle the requested TTS model.
    stack_defs = load_stack_config()

    for status in _DISPATCH_STATUSES:
        query = jobs.where("status", "==", status).order_by("createdAt").limit(25)
        for doc in query.stream():
            claimed = _claim_for_v2(db, doc.reference, worker_id, stack_defs)
            if claimed is None:
                continue
            claimed_data, recovered_stale_lock = claimed

            content_job_id = doc.id
            if recovered_stale_lock:
                logger.warning(
                    "Recovered stale V2 dispatch lock",
                    extra={
                        "content_job_id": content_job_id,
                        "worker_id": worker_id,
                    },
                )
            try:
                run_id = bootstrap_from_content_job(db, content_job_id, claimed_data)
                doc.reference.update(
                    {
                        "v2Locked": False,
                        "v2RunId": run_id,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    }
                )
                logger.info(
                    "V2 bootstrap dispatched",
                    extra={
                        "content_job_id": content_job_id,
                        "run_id": run_id,
                        "worker_id": worker_id,
                    },
                )
                return content_job_id, run_id
            except Exception as exc:
                logger.exception(
                    "V2 bootstrap failed",
                    extra={"content_job_id": content_job_id, "error": str(exc)},
                )
                doc.reference.update(
                    {
                        "v2Locked": False,
                        "v2DispatchError": f"{type(exc).__name__}: {exc}",
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    }
                )

    return None
