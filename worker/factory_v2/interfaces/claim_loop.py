"""Worker-side loop that claims queue items, executes steps, and projects results.

Architectural Role:
    The claim loop is the **execution engine** of an individual worker
    process.  It sits on the driving side of hexagonal architecture,
    receiving work from the Firestore queue (an external trigger) and
    delegating to step executors in the application layer.

Design Patterns:
    * **Lease-Based Work Distribution** -- Instead of push-based message
      delivery (e.g. Pub/Sub), workers compete for queue items by
      atomically setting a ``lease_owner`` field in Firestore.  Leases
      expire after a configurable timeout so that work automatically
      returns to the pool if a worker dies.
    * **Heartbeat + Watchdog** -- While a step executes, a background
      ``StepExecutionWatchdog`` thread extends the lease and publishes
      heartbeat timestamps.  The ``RecoveryManager`` watches these
      heartbeats to detect stuck steps.
    * **Retry with Exponential Backoff** -- Transient failures
      (timeouts, Firestore errors, LLM/TTS errors) are retried up to
      ``max_step_retries`` with ``5 * 2^n`` second delays, capped at
      300 s.  Retry scheduling lives here (not inside executors) so
      every step gets the same backoff policy.
    * **Supersession Guard** -- Before writing results, the loop checks
      that the run is still the active one.  If a newer run has taken
      over the job, the stale step is marked ``superseded`` instead of
      projecting outdated data.

Key Dependencies:
    * ``QueueScheduler`` (queue_policy.py) -- capability-aware ranking
      of ready queue items.
    * ``StepExecutionWatchdog`` (step_watchdog.py) -- background
      heartbeat thread for lease extension.
    * ``get_executor`` (steps/registry.py) -- registry lookup that maps
      step names to their executor functions.
    * ``Orchestrator`` -- notified on step success/failure to advance
      the pipeline DAG.

Consumed By:
    * ``WorkerMain.run_forever`` calls ``ClaimLoop.run_once`` every tick.
"""

from __future__ import annotations

from typing import Any

from firebase_admin import firestore as fs

from observability import get_logger
from factory_v2.shared.error_codes import classify_error
from factory_v2.shared.lineage_timing import (
    build_artifact_updates,
    compute_live_run_elapsed_ms,
    copy_artifacts,
    merge_artifacts,
)
from factory_v2.shared.course_tts_progress import (
    build_course_tts_progress,
    format_course_tts_progress_label,
)
from factory_v2.shared.worker_status import update_worker_status

from ..steps.base import StepContext
from ..steps.registry import get_executor
from ..shared.queue_capabilities import capability_key_for_payload
from .queue_policy import QueueScheduler
from .status_projection import patch_failed_status, patch_running_status
from .step_watchdog import StepExecutionWatchdog

logger = get_logger(__name__)


class ClaimLoop:
    """One worker process's execution engine for V2 queue items.

    Each call to ``run_once`` performs exactly one claim-execute-project
    cycle.  The caller (``WorkerMain``) decides how often to call it and
    what to do when no work is found (sleep).

    Args:
        db: Firestore client instance.
        worker_id: Unique identifier for the owning worker process.
        job_repo: Repository for ``factory_jobs`` documents.
        run_repo: Repository for ``factory_job_runs`` documents.
        step_run_repo: Repository for ``factory_step_runs`` documents.
        queue_repo: Repository for ``factory_step_queue`` documents.
        event_repo: Append-only event log repository.
        orchestrator: Application-layer DAG coordinator.
        accept_non_tts_steps: Whether this stack handles non-TTS work.
        supported_tts_models: TTS model names this stack can execute.
        extra_capability_keys: Additional capability keys for claiming.
        max_step_retries: Retry budget per step for transient errors.
        claim_candidate_limit: Max queue docs fetched per claim attempt.
        tts_per_job_soft_limit: Soft cap on concurrent TTS steps per job.
        worker_type: ``"local"`` or ``"cloud"`` deployment flavour.
        poll_interval_sec: Used for worker status heartbeat interval.
        stack_id: Logical stack this process belongs to.
        process_id: OS PID for admin observability.
        capability_keys: Pre-computed capability key list.
    """

    def __init__(
        self,
        *,
        db,
        worker_id: str,
        job_repo,
        run_repo,
        step_run_repo,
        queue_repo,
        event_repo,
        orchestrator,
        accept_non_tts_steps: bool,
        supported_tts_models: set[str] | None,
        extra_capability_keys: set[str] | None,
        max_step_retries: int,
        claim_candidate_limit: int,
        tts_per_job_soft_limit: int,
        worker_type: str,
        poll_interval_sec: float,
        stack_id: str,
        process_id: int | None,
        capability_keys: list[str],
    ):
        self.db = db
        self.worker_id = worker_id
        self.job_repo = job_repo
        self.run_repo = run_repo
        self.step_run_repo = step_run_repo
        self.queue_repo = queue_repo
        self.event_repo = event_repo
        self.orchestrator = orchestrator
        self.accept_non_tts_steps = bool(accept_non_tts_steps)
        self.supported_tts_models = (
            {str(model).strip().lower() for model in supported_tts_models if str(model).strip()}
            if supported_tts_models is not None
            else None
        )
        self.extra_capability_keys = {
            str(value).strip().lower()
            for value in (extra_capability_keys or set())
            if str(value).strip()
        }
        self.max_step_retries = max(0, int(max_step_retries))
        self.claim_candidate_limit = max(20, int(claim_candidate_limit))
        self.tts_per_job_soft_limit = max(0, int(tts_per_job_soft_limit))
        self.worker_type = worker_type
        self.poll_interval_sec = float(poll_interval_sec)
        self.stack_id = stack_id
        self.process_id = process_id
        self.capability_keys = list(capability_keys)
        self.queue_scheduler = QueueScheduler(queue_repo)

    # ------------------------------------------------------------------
    # Retry policy -- centralised so every step gets the same backoff
    # ------------------------------------------------------------------

    @staticmethod
    def _is_retryable(error_code: str) -> bool:
        """Return True for transient error classes that are worth retrying.

        Non-retryable errors (e.g. ``validation_error``) fail immediately
        because retrying them would just waste time.
        """
        return error_code in {
            "timeout",
            "firestore_error",
            "llm_error",
            "tts_error",
            "image_error",
        }

    @staticmethod
    def _retry_delay_seconds(retry_count: int) -> int:
        """Compute exponential backoff: 5s, 10s, 20s, ... capped at 300s."""
        return min(300, 5 * (2 ** max(0, retry_count)))

    def _step_log_fields(
        self,
        payload: dict[str, Any],
        *,
        queue_id: str,
        attempt: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build a structured-log dict for consistent step-level logging."""
        fields: dict[str, Any] = {
            "queue_id": queue_id,
            "job_id": str(payload.get("job_id") or "").strip(),
            "run_id": str(payload.get("run_id") or "").strip(),
            "step_name": str(payload.get("step_name") or "").strip(),
            "worker_id": self.worker_id,
            "capability_key": capability_key_for_payload(payload),
            "required_tts_model": str(payload.get("required_tts_model") or "").strip().lower() or None,
            "shard_key": str(payload.get("shard_key") or "root"),
        }
        if attempt is not None:
            fields["attempt"] = attempt
        if extra:
            fields.update(extra)
        return fields

    def _patch_course_tts_progress(
        self,
        *,
        job_id: str,
        run_id: str,
        step_name: str,
        content_job_id: str,
        updated_job: dict[str, Any],
    ) -> None:
        """Refresh the user-facing course TTS progress snapshot after shard updates."""
        if not content_job_id:
            return
        if str(updated_job.get("job_type") or "").strip() != "course":
            return
        if step_name not in {"synthesize_course_audio_chunk", "synthesize_course_audio"}:
            return

        succeeded_chunk_shards = self.step_run_repo.succeeded_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio_chunk",
        )
        tts_progress = build_course_tts_progress(
            updated_job,
            succeeded_chunk_shards=succeeded_chunk_shards,
        )
        if not tts_progress:
            return

        patch: dict[str, Any] = {"ttsProgress": tts_progress}
        course_progress = format_course_tts_progress_label(tts_progress)
        if course_progress:
            patch["courseProgress"] = course_progress
        self.job_repo.patch_compat_content_job_for_run(content_job_id, run_id, patch)

    # ------------------------------------------------------------------
    # Core claim-execute-project cycle
    # ------------------------------------------------------------------

    def run_once(self) -> bool:
        """Claim at most one queue item, execute it, and project the outcome.

        This is the single-step-per-tick workhorse.  The lifecycle is:

        1. **Claim** -- ``QueueScheduler.claim_next`` atomically leases a
           ready queue doc.  If nothing is available, return ``False``.
        2. **Guard** -- verify the parent job and run still exist and are
           in a valid state (not superseded, not cancelled).
        3. **Execute** -- look up the step executor from the registry,
           build a ``StepContext``, and run it under a heartbeat watchdog.
        4. **Project** -- on success, write results to repos, update the
           compatibility ``content_jobs`` doc, record artifacts, and tell
           the orchestrator to enqueue the next step(s).  On failure,
           decide between retry and terminal failure.

        Returns:
            ``True`` if work was performed (success, retry, or failure
            projection), ``False`` if the queue was empty.
        """
        # ---- 1. Claim ----
        claimed = self.queue_scheduler.claim_next(
            worker_id=self.worker_id,
            accept_non_tts_steps=self.accept_non_tts_steps,
            supported_tts_models=self.supported_tts_models,
            extra_capability_keys=self.extra_capability_keys,
            candidate_limit=self.claim_candidate_limit,
            tts_per_job_soft_limit=self.tts_per_job_soft_limit,
        )
        if not claimed:
            return False  # Queue is empty for our capability set.

        # ---- 2. Unpack payload and look up the parent job ----
        queue_id, payload = claimed
        job_id = str(payload.get("job_id") or "").strip()
        run_id = str(payload.get("run_id") or "").strip()
        step_name = str(payload.get("step_name") or "").strip()
        shard_key = str(payload.get("shard_key") or "root")
        raw_step_input = payload.get("step_input")
        step_input = dict(raw_step_input) if isinstance(raw_step_input, dict) else {}
        retry_count = int(payload.get("retry_count") or 0)
        attempt = retry_count + 1
        step_run_id = payload.get("step_run_id") or self.step_run_repo.make_step_run_id(
            run_id,
            step_name,
            shard_key,
        )

        try:
            claimed_job = self.job_repo.get(job_id)
        except Exception as lookup_exc:
            lookup_error = f"{type(lookup_exc).__name__}: {lookup_exc}"
            self.step_run_repo.mark_failed(step_run_id, "job_lookup_failed", lookup_error)
            self.queue_repo.mark_failed(queue_id, "job_lookup_failed", lookup_error)
            self.event_repo.emit(
                "step_failed",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                    "error_code": "job_lookup_failed",
                    "attempt": attempt,
                },
            )
            logger.exception(
                "V2 failed to load job for claimed queue item",
                extra=self._step_log_fields(
                    payload,
                    queue_id=queue_id,
                    attempt=attempt,
                    extra={"step_run_id": step_run_id, "error": lookup_error},
                ),
            )
            return True

        active_run_id = str(claimed_job.get("current_run_id") or "").strip()
        if active_run_id and active_run_id != run_id:
            # A newer run has taken over this job, so this queue item must not
            # write stale results back into the compatibility projection.
            superseded_error = f"Run '{run_id}' superseded by active run '{active_run_id}'"
            self.step_run_repo.mark_failed(step_run_id, "superseded_run", superseded_error)
            self.queue_repo.mark_failed(queue_id, "superseded_run", superseded_error)
            self.event_repo.emit(
                "step_superseded",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                    "active_run_id": active_run_id,
                    "worker_id": self.worker_id,
                },
            )
            logger.info(
                "V2 skipped superseded step",
                extra=self._step_log_fields(
                    payload,
                    queue_id=queue_id,
                    attempt=attempt,
                    extra={"step_run_id": step_run_id, "active_run_id": active_run_id},
                ),
            )
            return True

        run_state_before_step = self.run_repo.run_state(run_id)
        if run_state_before_step != "running":
            # This guard catches runs that were cancelled/failed between the time
            # the queue item became ready and the time a worker actually claimed it.
            superseded_error = f"Run '{run_id}' is not running (state={run_state_before_step or 'missing'})"
            self.step_run_repo.mark_failed(step_run_id, "superseded_run", superseded_error)
            self.queue_repo.mark_failed(queue_id, "superseded_run", superseded_error)
            self.event_repo.emit(
                "step_superseded",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                    "run_state": run_state_before_step,
                    "worker_id": self.worker_id,
                },
            )
            logger.info(
                "V2 skipped step for non-running run",
                extra=self._step_log_fields(
                    payload,
                    queue_id=queue_id,
                    attempt=attempt,
                    extra={"step_run_id": step_run_id, "run_state": run_state_before_step},
                ),
            )
            return True

        # ---- 3. Project "running" status and start heartbeat watchdog ----
        request = claimed_job.get("request") or {}
        compat = request.get("compat") or {}
        content_job_id = str(compat.get("content_job_id") or "").strip()
        # Update the legacy content_jobs doc so the admin UI shows progress.
        patch_running_status(self.job_repo, content_job_id, run_id, step_name)
        capability_key = capability_key_for_payload(payload)
        required_tts_model = str(payload.get("required_tts_model") or "").strip().lower() or None
        # The watchdog runs on a background thread, extending the lease and
        # writing heartbeat timestamps until the step finishes or times out.
        watchdog = StepExecutionWatchdog(
            queue_repo=self.queue_repo,
            step_run_repo=self.step_run_repo,
            status_writer=self._write_worker_status,
            worker_id=self.worker_id,
            job_id=job_id,
            content_job_id=content_job_id,
            run_id=run_id,
            step_name=step_name,
            queue_id=queue_id,
            step_run_id=step_run_id,
            shard_key=shard_key,
            attempt=attempt,
            capability_key=capability_key,
            required_tts_model=required_tts_model,
        )
        self.queue_repo.mark_running(
            queue_id,
            self.worker_id,
            lease_seconds=watchdog.lease_extension_sec,
            started_at=watchdog.started_at,
            deadline_at=watchdog.deadline_at,
            heartbeat_interval_sec=watchdog.heartbeat_interval_sec,
        )
        self.step_run_repo.mark_running(
            step_run_id,
            queue_id,
            self.worker_id,
            attempt=attempt,
            started_at=watchdog.started_at,
            deadline_at=watchdog.deadline_at,
        )
        self.event_repo.emit(
            "step_started",
            job_id,
            run_id,
            {
                "queue_id": queue_id,
                "step_run_id": step_run_id,
                "step_name": step_name,
                "worker_id": self.worker_id,
                "attempt": attempt,
                "deadline_at": watchdog.deadline_at,
            },
        )
        logger.info(
            "V2 step running",
            extra=self._step_log_fields(
                payload,
                queue_id=queue_id,
                attempt=attempt,
                extra={"step_run_id": step_run_id},
            ),
        )

        # ---- 4. Execute the step under the watchdog ----
        try:
            watchdog.start()
            try:
                # Resolve the step name to its executor function via the registry.
                executor = get_executor(step_name)
                ctx = StepContext(
                    db=self.db,
                    job=claimed_job,
                    run_id=run_id,
                    step_name=step_name,
                    worker_id=self.worker_id,
                    shard_key=shard_key,
                    step_input=step_input,
                    progress_callback=watchdog.progress,
                )
                result = executor(ctx)
            finally:
                watchdog.stop()

            run_state_after_step = self.run_repo.run_state(run_id)
            if run_state_after_step != "running":
                superseded_error = (
                    f"Run '{run_id}' changed state to '{run_state_after_step or 'missing'}' "
                    "before success projection."
                )
                self.step_run_repo.mark_failed(step_run_id, "superseded_run", superseded_error)
                self.queue_repo.mark_failed(queue_id, "superseded_run", superseded_error)
                self.event_repo.emit(
                    "step_superseded",
                    job_id,
                    run_id,
                    {
                        "queue_id": queue_id,
                        "step_run_id": step_run_id,
                        "step_name": step_name,
                        "run_state": run_state_after_step,
                        "worker_id": self.worker_id,
                    },
                )
                logger.info(
                    "V2 skipped success projection for non-running run",
                    extra=self._step_log_fields(
                        payload,
                        queue_id=queue_id,
                        attempt=attempt,
                        extra={"step_run_id": step_run_id, "run_state": run_state_after_step},
                    ),
                )
                return True

            if result.requeue_after_seconds:
                # Some steps are intentionally long-lived watchers. They update
                # runtime/summary state now, then reschedule themselves later.
                delay_seconds = max(1, int(result.requeue_after_seconds))
                self.job_repo.patch_runtime(job_id, result.runtime_patch)
                self.job_repo.patch_summary(job_id, result.summary_patch)
                try:
                    self.job_repo.patch_compat_content_job_for_run(
                        content_job_id,
                        run_id,
                        result.compat_content_job_patch,
                    )
                except Exception:
                    pass  # Compat patch is best-effort
                self.step_run_repo.mark_waiting(step_run_id, delay_seconds)
                self.queue_repo.schedule_continuation(queue_id, delay_seconds)
                self.event_repo.emit(
                    "step_waiting",
                    job_id,
                    run_id,
                    {
                        "queue_id": queue_id,
                        "step_run_id": step_run_id,
                        "step_name": step_name,
                        "delay_seconds": delay_seconds,
                    },
                )
                return True

            # ---- 5a. Project success ----
            self.step_run_repo.mark_succeeded(step_run_id, result.output)
            self.queue_repo.mark_done(queue_id)
            self.event_repo.emit(
                "step_succeeded",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                },
            )

            self.job_repo.patch_runtime(job_id, result.runtime_patch)
            self.job_repo.patch_summary(job_id, result.summary_patch)
            try:
                self.job_repo.patch_compat_content_job_for_run(
                    content_job_id,
                    run_id,
                    result.compat_content_job_patch,
                )
            except Exception as compat_exc:
                logger.warning(
                    "Compat content_job patch failed (non-fatal)",
                    extra=self._step_log_fields(
                        payload,
                        queue_id=queue_id,
                        attempt=attempt,
                        extra={"error": str(compat_exc)},
                    ),
                )
            updated_job = self.job_repo.get(job_id)
            self._patch_course_tts_progress(
                job_id=job_id,
                run_id=run_id,
                step_name=step_name,
                content_job_id=content_job_id,
                updated_job=updated_job,
            )
            artifact_updates = build_artifact_updates(
                before_job=claimed_job,
                after_job=updated_job,
                run_id=run_id,
                step_name=step_name,
                shard_key=shard_key,
                step_input=step_input,
                step_output=result.output,
            )
            if artifact_updates:
                # Artifacts are stored separately from the step output so later
                # observability code can answer "which step produced this file?"
                self.job_repo.patch_runtime(
                    job_id,
                    {
                        "artifacts": merge_artifacts(
                            copy_artifacts(updated_job),
                            artifact_updates,
                        )
                    },
                )
            active_run_elapsed_ms = compute_live_run_elapsed_ms(self.db, job_id, run_id)
            try:
                self.job_repo.patch_compat_content_job_for_run(
                    content_job_id,
                    run_id,
                    {"activeRunElapsedMs": active_run_elapsed_ms},
                )
            except Exception:
                pass  # Elapsed-time compat patch is best-effort
            self.orchestrator.on_step_success(job_id, run_id, step_name, shard_key=shard_key)
            return True

        except Exception as exc:
            # ---- 5b. Project failure (retry or terminal) ----
            error_msg = f"{type(exc).__name__}: {exc}"
            error_code = classify_error(exc)
            retryable = self._is_retryable(error_code)
            logger.exception(
                "V2 step failed",
                extra=self._step_log_fields(
                    payload,
                    queue_id=queue_id,
                    attempt=attempt,
                    extra={"step_run_id": step_run_id, "error_code": error_code, "retryable": retryable},
                ),
            )

            if retryable and retry_count < self.max_step_retries:
                # Retry scheduling happens here instead of inside step executors so
                # we get one consistent backoff policy across the entire engine.
                delay_seconds = self._retry_delay_seconds(retry_count)
                next_attempt = retry_count + 2
                self.step_run_repo.mark_retry_scheduled(
                    step_run_id,
                    error_code,
                    error_msg,
                    next_attempt=next_attempt,
                    delay_seconds=delay_seconds,
                )
                self.queue_repo.schedule_retry(
                    queue_id,
                    error_code,
                    error_msg,
                    delay_seconds=delay_seconds,
                )
                self.event_repo.emit(
                    "step_retry_scheduled",
                    job_id,
                    run_id,
                    {
                        "queue_id": queue_id,
                        "step_run_id": step_run_id,
                        "step_name": step_name,
                        "error_code": error_code,
                        "attempt": attempt,
                        "next_attempt": next_attempt,
                        "delay_seconds": delay_seconds,
                    },
                )
                return True

            self.step_run_repo.mark_failed(step_run_id, error_code, error_msg)
            self.queue_repo.mark_failed(queue_id, error_code, error_msg)
            self.event_repo.emit(
                "step_failed",
                job_id,
                run_id,
                {
                    "queue_id": queue_id,
                    "step_run_id": step_run_id,
                    "step_name": step_name,
                    "error_code": error_code,
                    "attempt": attempt,
                },
            )
            patch_failed_status(
                self.job_repo,
                content_job_id,
                run_id,
                step_name,
                error_msg=error_msg,
                error_code=error_code,
            )
            active_run_elapsed_ms = compute_live_run_elapsed_ms(self.db, job_id, run_id)
            self.job_repo.patch_compat_content_job_for_run(
                content_job_id,
                run_id,
                {"activeRunElapsedMs": active_run_elapsed_ms},
            )
            self.orchestrator.on_step_failed(job_id, run_id, step_name, error_code)
            return True

    def _write_worker_status(self, current_step: dict[str, Any] | None) -> None:
        """Callback invoked by the watchdog to publish active-step info.

        Passing ``None`` clears the current step, signalling that the
        worker is idle and ready for the next claim.
        """
        update_worker_status(
            self.db,
            self.worker_id,
            self.worker_type,
            poll_interval_sec=self.poll_interval_sec,
            stack_id=self.stack_id,
            pid=self.process_id,
            capability_keys=self.capability_keys,
            current_step=current_step,
            clear_current_step=current_step is None,
        )
