"""Worker-status writers used by admin screens, watchdogs, and recovery code."""

from typing import Any

from firebase_admin import firestore as fs

import config


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
    """Write the worker heartbeat plus optional active-step details in one document."""
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
