"""Background recovery routines for stale leases, stuck steps, and missing fan transitions.

Architectural Role:
    The recovery manager is the **self-healing subsystem** of the V2
    pipeline.  It runs as a periodic sweep (every ~15 s from workers,
    continuously from the companion) and detects work that is stuck,
    orphaned, or lost due to crashes, then moves it onto a safe path.

Design Patterns:
    * **Self-Healing / Failure Recovery** -- The system never relies on
      a single worker staying alive.  If a worker dies mid-step, the
      recovery manager detects the missing heartbeat and either retries
      the step or marks it failed.
    * **Heartbeat Staleness Detection** -- A step is considered stuck
      when its owning worker has not updated its heartbeat within
      ``heartbeat_stale_seconds()`` or the step has exceeded its
      deadline.
    * **Graduated Retry Budget** -- Stuck steps get their own retry
      sequence (``stuck_retry_delays_seconds``), separate from the
      normal transient-error retries in ``ClaimLoop``.  This prevents
      infinite loops while still giving flaky infrastructure a second
      chance.
    * **Worker Recycler Hook** -- An optional callback lets the
      companion process terminate or restart a stuck worker's OS process
      before returning the step to the queue.

Key Dependencies:
    * ``step_watchdog`` -- provides heartbeat thresholds and the
      ``coerce_datetime`` helper.
    * ``Orchestrator`` -- called for fan-in/fan-out/upload/publish
      recovery on course jobs.
    * ``status_projection`` -- projects terminal failures back to the
      legacy ``content_jobs`` document.

Consumed By:
    * ``WorkerMain._run_recovery_tick`` (worker-level sweeps).
    * ``companion/coordinator.py`` (companion-level sweeps with
      broader responsibility including fan-out recovery).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from firebase_admin import firestore as fs

from observability import get_logger

from .status_projection import patch_failed_status
from .step_watchdog import (
    coerce_datetime,
    heartbeat_stale_seconds,
    stuck_retry_delays_seconds,
    watchdog_enabled,
)

logger = get_logger(__name__)


class RecoveryManager:
    """Periodic self-healing logic shared by workers and the companion process.

    Two entry points exist because workers and the companion have
    different scopes of responsibility:

    * ``recover_worker_tick`` -- lightweight pass run by every worker.
    * ``recover_companion_tick`` -- broader pass run only by the
      companion (includes fan-out recovery).

    Args:
        db: Firestore client instance.
        queue_repo: Repository for ``factory_step_queue`` documents.
        run_repo: Repository for ``factory_job_runs`` documents.
        orchestrator: Application-layer DAG coordinator.
        job_repo: Optional; needed to project failures to content_jobs.
        step_run_repo: Optional; needed for stuck-step transitions.
        event_repo: Optional; emits watchdog/recovery audit events.
        worker_recycler: Optional callback that can terminate/restart a
            stuck worker's OS process.  Provided by the companion.
    """

    def __init__(
        self,
        db,
        queue_repo,
        run_repo,
        orchestrator,
        *,
        job_repo=None,
        step_run_repo=None,
        event_repo=None,
        worker_recycler: Callable[[str, dict[str, Any]], dict[str, Any] | bool] | None = None,
    ):
        self.db = db
        self.job_repo = job_repo
        self.step_run_repo = step_run_repo
        self.queue_repo = queue_repo
        self.run_repo = run_repo
        self.event_repo = event_repo
        self.orchestrator = orchestrator
        self.worker_recycler = worker_recycler

    def _iter_running_course_jobs(self, limit: int):
        query = self.db.collection("factory_jobs").where("current_state", "==", "running").limit(limit)
        for doc in query.stream():
            data = doc.to_dict() or {}
            if str(data.get("job_type") or "").strip().lower() != "course":
                continue

            run_id = str(data.get("current_run_id") or "").strip()
            if not run_id:
                continue
            if self.run_repo.run_state(run_id) != "running":
                continue
            yield doc.id, run_id

    def recover_admin_cancelled_runs(self, limit: int = 25) -> int:
        """Reconcile V2 runs whose legacy doc was cancelled by an admin.

        When an admin clicks "Cancel" in the old UI, the ``content_jobs``
        doc gets ``status=failed, errorCode=cancelled_by_admin``, but the
        V2 run may still be ``running``.  This method detects the mismatch
        and cancels the V2 side.
        """
        recovered = 0
        query = self.db.collection("factory_jobs").where("current_state", "==", "running").limit(limit)
        for doc in query.stream():
            data = doc.to_dict() or {}
            run_id = str(data.get("current_run_id") or "").strip()
            if not run_id:
                continue
            if self.run_repo.run_state(run_id) != "running":
                continue

            request = data.get("request") or {}
            compat = request.get("compat") or {}
            content_job_id = str(compat.get("content_job_id") or "").strip()
            if not content_job_id:
                continue

            content_job_snap = self.db.collection("content_jobs").document(content_job_id).get()
            if not content_job_snap.exists:
                continue
            content_job = content_job_snap.to_dict() or {}
            status = str(content_job.get("status") or "").strip().lower()
            error_code = str(content_job.get("errorCode") or "").strip().lower()
            if status != "failed" or error_code != "cancelled_by_admin":
                continue

            self.orchestrator.cancel_run(
                doc.id,
                run_id,
                reason=str(content_job.get("error") or "").strip() or "Cancelled by admin",
                error_code="cancelled_by_admin",
            )
            recovered += 1

        return recovered

    def _worker_status(self, worker_id: str, cache: dict[str, dict | None]) -> dict | None:
        if worker_id in cache:
            return cache[worker_id]
        if not worker_id:
            cache[worker_id] = None
            return None
        snap = self.db.collection("worker_status").document(worker_id).get()
        cache[worker_id] = snap.to_dict() if snap.exists else None
        return cache[worker_id]

    @staticmethod
    def _worker_status_missing_or_stale(status: dict | None, now: datetime) -> bool:
        if not status:
            return True
        last_heartbeat = coerce_datetime(status.get("lastHeartbeat"))
        if last_heartbeat is None:
            return True
        return (now - last_heartbeat).total_seconds() > heartbeat_stale_seconds()

    def _stuck_reason(
        self,
        *,
        queue_id: str,
        payload: dict[str, Any],
        status: dict | None,
        now: datetime,
    ) -> str | None:
        """Determine why a leased/running step should be considered stuck.

        Returns a reason string (e.g. ``"deadline_exceeded"``,
        ``"missing_worker_status"``, ``"stale_step_heartbeat"``) or
        ``None`` if the step looks healthy.
        """
        deadline_at = coerce_datetime(payload.get("step_deadline_at"))
        if deadline_at is not None and deadline_at <= now:
            return "deadline_exceeded"

        owner = str(payload.get("lease_owner") or "").strip()
        if owner and self._worker_status_missing_or_stale(status, now):
            return "missing_worker_status"

        if status:
            current_queue_id = str(status.get("currentQueueId") or "").strip()
            if current_queue_id == queue_id:
                current_step_heartbeat_at = coerce_datetime(status.get("currentStepHeartbeatAt"))
                if current_step_heartbeat_at is None:
                    return "stale_step_heartbeat"
                if (now - current_step_heartbeat_at).total_seconds() > heartbeat_stale_seconds():
                    return "stale_step_heartbeat"

        return None

    def _clear_worker_active_step(self, worker_id: str, *, reason: str, queue_id: str, step_run_id: str) -> None:
        if not worker_id:
            return
        self.db.collection("worker_status").document(worker_id).set(
            {
                "currentQueueId": None,
                "currentStepRunId": None,
                "currentRunId": None,
                "currentStepName": None,
                "currentShardKey": None,
                "currentStepAttempt": None,
                "currentStepStartedAt": None,
                "currentStepHeartbeatAt": None,
                "currentStepDeadlineAt": None,
                "currentCapabilityKey": None,
                "currentRequiredTtsModel": None,
                "currentProgressDetail": None,
                "lastRecycleAt": fs.SERVER_TIMESTAMP,
                "lastRecycleReason": reason,
                "lastRecycleQueueId": queue_id,
                "lastRecycleStepRunId": step_run_id,
                "updatedAt": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def _record_watchdog_metrics(self, increments: dict[str, int]) -> None:
        watchdog_metrics: dict[str, Any] = {}
        for metric_name, value in increments.items():
            if value:
                watchdog_metrics[metric_name] = fs.Increment(int(value))
        if not watchdog_metrics:
            return
        self.db.collection("worker_stacks_status").document("local").set(
            {
                "watchdogMetrics": watchdog_metrics,
                "updatedAt": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def _transition_stuck_step(
        self,
        *,
        queue_id: str,
        payload: dict[str, Any],
        reason: str,
    ) -> dict[str, Any] | None:
        """Atomically convert a stuck queue item into either a retry or a terminal failure.

        Uses a Firestore transaction to ensure only one recovery pass
        operates on a given stuck step.  The decision between retry and
        failure is based on ``stuck_retry_count`` -- a budget separate
        from the normal transient-error retries in ``ClaimLoop``.

        Returns:
            A dict describing the action taken (``"retry"`` or
            ``"failed"``), or ``None`` if the step was no longer stuck.
        """
        if self.step_run_repo is None:
            return None

        queue_ref = self.db.collection("factory_step_queue").document(queue_id)
        step_run_id = str(payload.get("step_run_id") or "").strip()
        if not step_run_id:
            return None
        step_run_ref = self.db.collection("factory_step_runs").document(step_run_id)
        now = datetime.now(timezone.utc)
        tx = self.db.transaction()
        retry_delays = stuck_retry_delays_seconds()

        @fs.transactional
        def _tx_apply(transaction):
            queue_snap = queue_ref.get(transaction=transaction)
            if not queue_snap.exists:
                return None
            live_payload = queue_snap.to_dict() or {}
            live_state = str(live_payload.get("state") or "").strip().lower()
            if live_state not in {"leased", "running"}:
                return None

            retry_count = int(live_payload.get("retry_count") or 0)
            stuck_retry_count = int(live_payload.get("stuck_retry_count") or 0)
            step_name = str(live_payload.get("step_name") or "").strip()
            error_code = "stuck_timeout"
            error_message = f"Step '{step_name}' got stuck ({reason})."
            base_patch = {
                "error_code": error_code,
                "error_message": error_message,
                "lease_owner": None,
                "lease_expires_at": None,
                "last_step_heartbeat_at": None,
                "step_started_at": None,
                "step_deadline_at": None,
                "heartbeat_interval_sec": None,
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            }
            if stuck_retry_count < len(retry_delays):
                delay_seconds = retry_delays[stuck_retry_count]
                available_at = now + timedelta(seconds=delay_seconds)
                transaction.update(
                    queue_ref,
                    {
                        **base_patch,
                        "state": "ready",
                        "retry_count": fs.Increment(1),
                        "stuck_retry_count": fs.Increment(1),
                        "available_at": available_at,
                    },
                )
                transaction.set(
                    step_run_ref,
                    {
                        "state": "retry_scheduled",
                        "error_code": error_code,
                        "error_message": error_message,
                        "next_attempt": retry_count + 2,
                        "retry_delay_seconds": delay_seconds,
                        "watchdog_state": "retry_scheduled",
                        "updated_at": fs.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )
                return {
                    "action": "retry",
                    "delay_seconds": delay_seconds,
                    "next_attempt": retry_count + 2,
                    "error_code": error_code,
                    "error_message": error_message,
                }

            transaction.update(
                queue_ref,
                {
                    **base_patch,
                    "state": "failed",
                },
            )
            transaction.set(
                step_run_ref,
                {
                    "state": "failed",
                    "error_code": error_code,
                    "error_message": error_message,
                    "watchdog_state": "failed",
                    "ended_at": fs.SERVER_TIMESTAMP,
                    "updated_at": fs.SERVER_TIMESTAMP,
                },
                merge=True,
            )
            return {
                "action": "failed",
                "error_code": error_code,
                "error_message": error_message,
            }

        return _tx_apply(tx)

    def _emit_watchdog_events(
        self,
        *,
        queue_id: str,
        payload: dict[str, Any],
        reason: str,
        transition: dict[str, Any],
        recycled: bool,
    ) -> None:
        if self.event_repo is None:
            return

        job_id = str(payload.get("job_id") or "").strip()
        run_id = str(payload.get("run_id") or "").strip()
        step_name = str(payload.get("step_name") or "").strip()
        step_run_id = str(payload.get("step_run_id") or "").strip()
        worker_id = str(payload.get("lease_owner") or "").strip()
        attempt = int(payload.get("retry_count") or 0) + 1

        if recycled:
            self.event_repo.emit(
                "worker_recycled_for_stuck_step",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                    "worker_id": worker_id,
                    "stuck_reason": reason,
                },
            )

        if transition["action"] == "retry":
            self.event_repo.emit(
                "step_watchdog_retry_scheduled",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                    "worker_id": worker_id,
                    "stuck_reason": reason,
                    "attempt": attempt,
                    "next_attempt": transition["next_attempt"],
                    "delay_seconds": transition["delay_seconds"],
                    "error_code": transition["error_code"],
                },
            )
            return

        self.event_repo.emit(
            "step_watchdog_failed",
            job_id,
            run_id,
            {
                "queue_id": queue_id,
                "step_run_id": step_run_id,
                "step_name": step_name,
                "worker_id": worker_id,
                "stuck_reason": reason,
                "attempt": attempt,
                "error_code": transition["error_code"],
            },
        )

    def recover_stuck_steps(self, max_docs: int = 100) -> dict[str, int]:
        """Find stuck leased/running steps and move them back onto a safe path.

        The algorithm:
        1. Fetch all queue items in ``leased`` or ``running`` state.
        2. For each, check the owning worker's heartbeat status.
        3. Determine a ``stuck_reason`` (deadline exceeded, stale
           heartbeat, missing worker).
        4. If stuck *and* the worker appears terminated, transition
           the step (retry with backoff or fail permanently).
        5. If stuck but the worker still looks alive, leave it alone
           and let the next sweep re-evaluate.
        """
        recovered = {
            "stuck_detected": 0,
            "watchdog_retries": 0,
            "watchdog_failures": 0,
            "worker_recycles": 0,
        }
        if not watchdog_enabled():
            return recovered

        now = datetime.now(timezone.utc)
        worker_status_cache: dict[str, dict | None] = {}
        queue_docs = self.queue_repo.fetch_docs_by_states(("leased", "running"), max_docs)

        for doc in queue_docs:
            payload = doc.to_dict() or {}
            queue_id = doc.id
            run_id = str(payload.get("run_id") or "").strip()
            if run_id and self.run_repo.run_state(run_id) != "running":
                continue

            owner = str(payload.get("lease_owner") or "").strip()
            status = self._worker_status(owner, worker_status_cache)
            reason = self._stuck_reason(queue_id=queue_id, payload=payload, status=status, now=now)
            if not reason:
                continue

            recovered["stuck_detected"] += 1
            terminated = self._worker_status_missing_or_stale(status, now)
            recycled = False
            if self.worker_recycler is not None and owner:
                try:
                    recycle_result = self.worker_recycler(owner, payload)
                except Exception as exc:
                    logger.warning(
                        "V2 worker recycle failed",
                        extra={"worker_id": owner, "queue_id": queue_id, "error": str(exc)},
                    )
                    recycle_result = {"terminated": False, "recycled": False}
                if isinstance(recycle_result, dict):
                    terminated = bool(recycle_result.get("terminated", terminated))
                    recycled = bool(recycle_result.get("recycled"))
                else:
                    terminated = bool(recycle_result)
                    recycled = bool(recycle_result)

            if not terminated:
                # The worker still looks healthy -- leave the step alone and
                # give the watchdog more time to observe another heartbeat.
                # This prevents premature recovery from stealing work that
                # is actually progressing.
                continue
            if owner:
                self._clear_worker_active_step(
                    owner,
                    reason=reason,
                    queue_id=queue_id,
                    step_run_id=str(payload.get("step_run_id") or "").strip(),
                )

            transition = self._transition_stuck_step(queue_id=queue_id, payload=payload, reason=reason)
            if not transition:
                continue

            logger.warning(
                "V2 recovered stuck step",
                extra={
                    "queue_id": queue_id,
                    "job_id": str(payload.get("job_id") or "").strip(),
                    "run_id": run_id,
                    "step_name": str(payload.get("step_name") or "").strip(),
                    "worker_id": owner or None,
                    "stuck_reason": reason,
                    "action": transition["action"],
                },
            )
            self._emit_watchdog_events(
                queue_id=queue_id,
                payload=payload,
                reason=reason,
                transition=transition,
                recycled=recycled,
            )
            if recycled:
                recovered["worker_recycles"] += 1

            if transition["action"] == "retry":
                recovered["watchdog_retries"] += 1
                continue

            recovered["watchdog_failures"] += 1
            if self.job_repo is not None:
                try:
                    job = self.job_repo.get(str(payload.get("job_id") or "").strip())
                except Exception:
                    job = None
                if job:
                    request = job.get("request") or {}
                    compat = request.get("compat") or {}
                    content_job_id = str(compat.get("content_job_id") or "").strip()
                    patch_failed_status(
                        self.job_repo,
                        content_job_id,
                        run_id,
                        str(payload.get("step_name") or "").strip(),
                        error_msg=transition["error_message"],
                        error_code=transition["error_code"],
                    )
            self.orchestrator.on_step_failed(
                str(payload.get("job_id") or "").strip(),
                run_id,
                str(payload.get("step_name") or "").strip(),
                transition["error_code"],
            )

        self._record_watchdog_metrics(
            {
                "stuckDetectedCount": recovered["stuck_detected"],
                "watchdogRetryScheduledCount": recovered["watchdog_retries"],
                "watchdogFailedCount": recovered["watchdog_failures"],
                "workerRecycleCount": recovered["worker_recycles"],
            }
        )
        return recovered

    def recover_worker_tick(self) -> dict[str, int]:
        """Recovery pass used by normal workers.

        Workers focus on the fixes they are most likely to notice quickly while
        processing jobs: stale leases, stuck steps, and course fan-in/upload/publish.
        """
        recovered = {
            "stale_leases": self.queue_repo.recover_stale_leases(),
            "stuck_detected": 0,
            "watchdog_retries": 0,
            "watchdog_failures": 0,
            "worker_recycles": 0,
            "fan_in": 0,
            "upload": 0,
            "publish": 0,
            "admin_cancelled": 0,
        }
        recovered.update(self.recover_stuck_steps())
        for job_id, run_id in self._iter_running_course_jobs(limit=25):
            recovered["fan_in"] += self.orchestrator.recover_course_audio_fan_in_if_ready(job_id, run_id)
            if self.orchestrator.recover_course_upload_if_ready(job_id, run_id):
                recovered["upload"] += 1
            if self.orchestrator.recover_course_publish_if_ready(job_id, run_id):
                recovered["publish"] += 1
        recovered["admin_cancelled"] += self.recover_admin_cancelled_runs(limit=25)
        return recovered

    def recover_companion_tick(self) -> dict[str, int]:
        """Recovery pass used by the companion/coordinator process.

        The companion has broader responsibility, so it also repairs missing
        course fan-out work in addition to the worker-level checks.
        """
        recovered = {
            "stale_leases": self.queue_repo.recover_stale_leases(),
            "stuck_detected": 0,
            "watchdog_retries": 0,
            "watchdog_failures": 0,
            "worker_recycles": 0,
            "fan_out": 0,
            "fan_in": 0,
            "upload": 0,
            "publish": 0,
            "admin_cancelled": 0,
        }
        recovered.update(self.recover_stuck_steps())
        for job_id, run_id in self._iter_running_course_jobs(limit=50):
            recovered["fan_out"] += self.orchestrator.recover_course_audio_fan_out_if_ready(job_id, run_id)
            recovered["fan_in"] += self.orchestrator.recover_course_audio_fan_in_if_ready(job_id, run_id)
            if self.orchestrator.recover_course_upload_if_ready(job_id, run_id):
                recovered["upload"] += 1
            if self.orchestrator.recover_course_publish_if_ready(job_id, run_id):
                recovered["publish"] += 1
        recovered["admin_cancelled"] += self.recover_admin_cancelled_runs(limit=50)
        return recovered
