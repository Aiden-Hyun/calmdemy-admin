"""Dispatcher that upgrades legacy `content_jobs` rows into V2 runs."""

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

_DISPATCH_STATUSES = ("pending", "publishing")
_DISPATCH_LOCK_TIMEOUT_SECONDS = max(
    15,
    int(os.getenv("V2_DISPATCH_LOCK_TIMEOUT_SECONDS", "60")),
)


def _coerce_datetime(value) -> datetime | None:
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
    if not data.get("v2Locked"):
        return False

    dispatched_at = _coerce_datetime(data.get("v2DispatchedAt"))
    if dispatched_at is None:
        return True
    if dispatched_at.tzinfo is None:
        dispatched_at = dispatched_at.replace(tzinfo=timezone.utc)

    age_seconds = (datetime.now(timezone.utc) - dispatched_at).total_seconds()
    return age_seconds >= _DISPATCH_LOCK_TIMEOUT_SECONDS


def _is_cloud_job(data: dict) -> bool:
    return data.get("llmBackend") == "cloud" or data.get("ttsBackend") == "cloud"


def _has_active_v2_run(transaction, db, data: dict) -> bool:
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
    """Atomically lock one eligible legacy job so exactly one dispatcher boots it."""
    tx = db.transaction()

    @firestore.transactional
    def _tx_claim(transaction):
        snap = doc_ref.get(transaction=transaction)
        if not snap.exists:
            return None

        data = snap.to_dict() or {}
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
            required_tts_model = str(data.get("ttsModel") or "").strip().lower() or "dms"
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
        recovered_stale_lock = _is_stale_dispatch_lock(data)
        if data.get("v2Locked") and not recovered_stale_lock:
            return None

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
    """Claim one eligible content job and bootstrap a V2 run."""
    jobs = db.collection("content_jobs")
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
