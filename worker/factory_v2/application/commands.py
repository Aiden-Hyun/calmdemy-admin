"""Admin command objects and the thin service layer that turns UI actions into runs."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class RetryJobCommand:
    """Explicit request to start a fresh run for an existing job."""

    job_id: str


@dataclass(slots=True)
class CancelJobCommand:
    """Explicit request to stop a job and mark its active run as cancelled."""

    job_id: str


@dataclass(slots=True)
class ApprovePublishCommand:
    """Explicit request to resume a job directly at its publish step."""

    job_id: str


class CommandService:
    """Small application-service facade used by admin-facing handlers."""

    def __init__(self, orchestrator, job_repo):
        self.orchestrator = orchestrator
        self.job_repo = job_repo

    def retry_job(self, command: RetryJobCommand) -> str:
        """Record the retry request, then let the orchestrator create the new run."""
        self.job_repo.mark_retry_requested(command.job_id)
        return self.orchestrator.start_new_run(command.job_id, trigger="retry")

    def cancel_job(self, command: CancelJobCommand) -> None:
        """Mark the job as cancelled; recovery/orchestration will stop queued work."""
        self.job_repo.mark_cancelled(command.job_id)

    def approve_publish(self, command: ApprovePublishCommand) -> str:
        """Resume a completed draft job at the publish step without redoing generation."""
        self.job_repo.mark_running(command.job_id, run_id=None)
        job = self.job_repo.get(command.job_id)
        first_step = "publish_content"
        if (job.get("job_type") or "").strip().lower() == "course":
            first_step = "publish_course"
        return self.orchestrator.start_new_run(
            command.job_id,
            trigger="manual_publish",
            first_step=first_step,
        )
