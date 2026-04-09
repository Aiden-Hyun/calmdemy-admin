"""Worker heartbeat and status writers.

Architectural Role:
    Each worker process periodically writes its status to the
    ``worker_status`` Firestore collection.  The admin dashboard reads
    these documents to show which workers are alive, what step they are
    currently executing, and when they last checked in.  The recovery
    watchdog also uses the ``lastHeartbeat`` field to detect stale workers
    and reassign their queue items.

Key Dependencies:
    - firebase_admin.firestore  -- Firestore SDK
    - config.POLL_INTERVAL_SECONDS -- default heartbeat cadence

Consumed By:
    - factory_v2 worker loop (heartbeat on every poll iteration)
    - Admin dashboard (real-time worker monitoring)
    - Recovery watchdog (dead-worker detection)
"""

from typing import Any

from firebase_admin import firestore as fs

import config


# Fields that describe the step a worker is currently executing.
# When ``clear_current_step=True`` these are all set to ``None`` to signal
# the worker is idle and polling for new work.
_ACTIVE_STEP_FIELDS = (
    "jobId",
    "currentQueueId",
    "currentStepRunId",
    "currentRunId",
    "currentStepName",
    "currentShardKey",
    "currentStepAttempt",
    "currentStepStartedAt",
    "currentStepHeartbeatAt",
    "currentStepDeadlineAt",
    "currentCapabilityKey",
    "currentRequiredTtsModel",
    "currentProgressDetail",
)


def update_worker_status(
    db,
    worker_id: str,
    worker_type: str,
    *,
    poll_interval_sec: float | None = None,
    stack_id: str | None = None,
    pid: int | None = None,
    capability_keys: list[str] | None = None,
    current_step: dict[str, Any] | None = None,
    clear_current_step: bool = False,
    extra_patch: dict[str, Any] | None = None,
) -> None:
    """Write the worker heartbeat plus optional active-step details in one document.

    Called on every poll iteration so the admin dashboard and recovery
    watchdog can see that the worker is alive and what it is doing.

    Args:
        db: Firestore client.
        worker_id: Unique identifier for this worker process.
        worker_type: E.g. ``"tts"``, ``"llm"``, ``"general"``.
        current_step: Dict of active-step fields to merge into the doc.
        clear_current_step: If True, null out all active-step fields
            (worker is idle / between jobs).
        extra_patch: Arbitrary extra fields to merge (e.g. version info).
    """
    payload: dict[str, Any] = {
        "workerId": worker_id,
        "workerType": worker_type,
        "stackId": stack_id or worker_id,
        "pid": pid,
        "capabilityKeys": list(capability_keys or []),
        "lastHeartbeat": fs.SERVER_TIMESTAMP,
        "updatedAt": fs.SERVER_TIMESTAMP,
        "pollIntervalSec": poll_interval_sec if poll_interval_sec is not None else config.POLL_INTERVAL_SECONDS,
    }
    if current_step:
        payload.update(current_step)
    elif clear_current_step:
        for field_name in _ACTIVE_STEP_FIELDS:
            payload[field_name] = None
    if extra_patch:
        payload.update(extra_patch)
    db.collection("worker_status").document(worker_id).set(payload, merge=True)
