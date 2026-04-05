"""Step heartbeat/watchdog helpers for long-running queue executions."""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from observability import get_logger

logger = get_logger(__name__)

DEFAULT_STEP_TIMEOUT_SECONDS = 20 * 60
STEP_TIMEOUT_SECONDS_BY_NAME = {
    "generate_script": 15 * 60,
    "format_script": 10 * 60,
    "generate_image": 20 * 60,
    "synthesize_audio": 15 * 60,
    "post_process_audio": 10 * 60,
    "upload_audio": 10 * 60,
    "publish_content": 10 * 60,
    "generate_course_plan": 20 * 60,
    "generate_course_thumbnail": 20 * 60,
    "generate_course_scripts": 25 * 60,
    "format_course_scripts": 15 * 60,
    "synthesize_course_audio_chunk": 10 * 60,
    "synthesize_course_audio": 60 * 60,
    "upload_course_audio": 5 * 60,
    "publish_course": 15 * 60,
}


def watchdog_enabled() -> bool:
    return os.getenv("V2_STEP_WATCHDOG_ENABLED", "false").lower() == "true"


def heartbeat_interval_seconds() -> int:
    return max(5, int(float(os.getenv("V2_STEP_HEARTBEAT_INTERVAL_SEC", "30"))))


def lease_extension_seconds() -> int:
    return max(30, int(float(os.getenv("V2_STEP_LEASE_EXTENSION_SEC", "120"))))


def heartbeat_stale_seconds() -> int:
    return max(30, int(float(os.getenv("V2_STEP_HEARTBEAT_STALE_SEC", "90"))))


def step_timeout_seconds(step_name: str) -> int:
    multiplier = max(0.1, float(os.getenv("V2_STEP_TIMEOUT_MULTIPLIER", "1.0")))
    base = STEP_TIMEOUT_SECONDS_BY_NAME.get(str(step_name or "").strip(), DEFAULT_STEP_TIMEOUT_SECONDS)
    return max(30, int(base * multiplier))


def stuck_retry_delays_seconds() -> tuple[int, ...]:
    raw = os.getenv("V2_STUCK_RETRY_DELAYS_SEC", "30,120")
    parsed: list[int] = []
    for part in raw.split(","):
        stripped = part.strip()
        if not stripped:
            continue
        try:
            parsed.append(max(1, int(stripped)))
        except ValueError:
            continue
    if not parsed:
        return (30, 120)
    return tuple(parsed)


def coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if hasattr(value, "timestamp"):
        return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)
    return None


class StepExecutionWatchdog:
    """Background heartbeat helper for one running step.

    The worker thread does the actual step work. This helper keeps the queue
    lease alive, updates step-run heartbeat fields, and surfaces progress text
    so recovery logic can tell the difference between "busy" and "stuck".
    """

    def __init__(
        self,
        *,
        queue_repo,
        step_run_repo,
        status_writer: Callable[[dict[str, Any] | None], None],
        worker_id: str,
        job_id: str,
        run_id: str,
        step_name: str,
        queue_id: str,
        step_run_id: str,
        shard_key: str,
        attempt: int,
        capability_key: str,
        required_tts_model: str | None,
    ):
        self.queue_repo = queue_repo
        self.step_run_repo = step_run_repo
        self.status_writer = status_writer
        self.worker_id = worker_id
        self.job_id = job_id
        self.run_id = run_id
        self.step_name = step_name
        self.queue_id = queue_id
        self.step_run_id = step_run_id
        self.shard_key = shard_key
        self.attempt = attempt
        self.capability_key = capability_key
        self.required_tts_model = required_tts_model

        self.started_at = datetime.now(timezone.utc)
        self.deadline_at = self.started_at + timedelta(seconds=step_timeout_seconds(step_name))
        self.heartbeat_interval_sec = heartbeat_interval_seconds()
        self.lease_extension_sec = lease_extension_seconds()

        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._progress_lock = threading.Lock()
        self._pending_progress_detail: str | None = None
        self._last_progress_detail: str | None = None

    def _active_step_payload(self, *, heartbeat_at: datetime) -> dict[str, Any]:
        """Build the worker-status payload shown in admin/recovery views."""
        return {
            "jobId": self.job_id,
            "currentQueueId": self.queue_id,
            "currentStepRunId": self.step_run_id,
            "currentRunId": self.run_id,
            "currentStepName": self.step_name,
            "currentShardKey": self.shard_key,
            "currentStepAttempt": self.attempt,
            "currentStepStartedAt": self.started_at,
            "currentStepHeartbeatAt": heartbeat_at,
            "currentStepDeadlineAt": self.deadline_at,
            "currentCapabilityKey": self.capability_key,
            "currentRequiredTtsModel": self.required_tts_model,
            "currentProgressDetail": self._last_progress_detail,
        }

    def _consume_progress_detail(self) -> str | None:
        with self._progress_lock:
            detail = self._pending_progress_detail
            self._pending_progress_detail = None
        if detail:
            self._last_progress_detail = detail
        return detail

    def _heartbeat(self) -> None:
        """Refresh queue, step-run, and worker-status heartbeats in one place."""
        heartbeat_at = datetime.now(timezone.utc)
        progress_detail = self._consume_progress_detail()
        try:
            self.queue_repo.heartbeat_running(
                self.queue_id,
                self.worker_id,
                lease_seconds=self.lease_extension_sec,
                deadline_at=self.deadline_at,
                heartbeat_interval_sec=self.heartbeat_interval_sec,
                progress_detail=progress_detail,
            )
            self.step_run_repo.heartbeat(
                self.step_run_id,
                self.worker_id,
                deadline_at=self.deadline_at,
                progress_detail=progress_detail,
            )
            self.status_writer(self._active_step_payload(heartbeat_at=heartbeat_at))
        except Exception as exc:
            logger.warning(
                "V2 step heartbeat failed",
                extra={
                    "worker_id": self.worker_id,
                    "queue_id": self.queue_id,
                    "step_run_id": self.step_run_id,
                    "step_name": self.step_name,
                    "error": str(exc),
                },
            )

    def _run(self) -> None:
        while not self._stop_event.wait(self.heartbeat_interval_sec):
            self._heartbeat()

    def start(self) -> None:
        self._heartbeat()
        self._thread = threading.Thread(
            target=self._run,
            name=f"step-watchdog-{self.queue_id}",
            daemon=True,
        )
        self._thread.start()

    def progress(self, detail: str | None = None) -> None:
        """Record the latest human-readable progress detail for the next heartbeat."""
        if not detail:
            return
        with self._progress_lock:
            self._pending_progress_detail = detail
        logger.info(
            "V2 step progress",
            extra={
                "worker_id": self.worker_id,
                "job_id": self.job_id,
                "run_id": self.run_id,
                "step_name": self.step_name,
                "queue_id": self.queue_id,
                "step_run_id": self.step_run_id,
                "shard_key": self.shard_key,
                "attempt": self.attempt,
                "progress_detail": detail,
            },
        )

    def stop(self) -> None:
        """Stop the heartbeat thread and clear the worker's active-step snapshot."""
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        try:
            self.status_writer(None)
        except Exception as exc:
            logger.warning(
                "V2 step heartbeat teardown failed",
                extra={
                    "worker_id": self.worker_id,
                    "queue_id": self.queue_id,
                    "step_run_id": self.step_run_id,
                    "step_name": self.step_name,
                    "error": str(exc),
                },
            )
