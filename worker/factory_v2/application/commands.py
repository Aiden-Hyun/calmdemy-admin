"""Admin command objects and the thin service layer that turns UI actions into runs.

Architectural Role:
    Application / Service Layer -- sits between the admin API handlers (presentation
    layer) and the Orchestrator (workflow coordination).  This module owns the
    *intent* of admin actions; it does NOT own the workflow logic itself.

Design Patterns:
    * **Command pattern** -- each admin action is represented as an immutable
      dataclass (RetryJobCommand, CancelJobCommand, ApprovePublishCommand).
      Separating intent from execution keeps the API handlers thin and makes it
      trivial to add audit logging, undo support, or async dispatch later.
    * **Application Service / Facade** -- ``CommandService`` is a thin
      orchestration layer that validates the command, updates the repository,
      and delegates the real workflow logic to the Orchestrator.

Key Dependencies:
    * ``Orchestrator``   -- drives the job/run/step lifecycle (see orchestrator.py).
    * ``job_repo``       -- Firestore-backed repository for job aggregate roots.

Consumed By:
    * Admin API route handlers (e.g. retry, cancel, and approve-publish endpoints).
"""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Command objects
# ---------------------------------------------------------------------------
# Each command is a simple value object (dataclass with slots) that captures
# exactly the data needed to describe one admin intent.  Having dedicated
# classes instead of raw dicts makes type-checking easy and documents the
# valid inputs in a single place.
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class RetryJobCommand:
    """Request to start a brand-new run for an existing job.

    The previous run may have failed or been cancelled.  A retry creates a
    fresh run record and replays the workflow from the first step.
    """

    job_id: str


@dataclass(slots=True)
class CancelJobCommand:
    """Request to halt a job and mark its active run as cancelled.

    Downstream queue items that have not yet been picked up by a worker will
    also be cancelled by the orchestrator's recovery logic.
    """

    job_id: str


@dataclass(slots=True)
class ApprovePublishCommand:
    """Request to resume a job directly at its publish step.

    Used when an admin reviews a completed draft and approves it for
    publishing -- skips regeneration entirely and jumps straight to the
    terminal publish step.
    """

    job_id: str


# ---------------------------------------------------------------------------
# Application service (Facade)
# ---------------------------------------------------------------------------

class CommandService:
    """Thin application-service facade consumed by admin-facing API handlers.

    Responsibilities:
        1. Accept a validated command object.
        2. Perform any necessary state-marking in the repository.
        3. Delegate workflow orchestration to the ``Orchestrator``.

    This class intentionally contains *no* workflow logic -- it only
    translates admin intent into repository writes and orchestrator calls.
    """

    def __init__(self, orchestrator, job_repo):
        # The orchestrator coordinates the full run lifecycle.
        self.orchestrator = orchestrator
        # The job repo provides read/write access to the job aggregate root.
        self.job_repo = job_repo

    def retry_job(self, command: RetryJobCommand) -> str:
        """Record the retry request, then let the orchestrator create the new run.

        Args:
            command: Carries the ``job_id`` of the job to retry.

        Returns:
            The newly created run ID (e.g. ``"job123-r2"``).
        """
        # First, persist the retry intent so the job shows "retry requested"
        # in the admin UI even before the new run record exists.
        self.job_repo.mark_retry_requested(command.job_id)
        # Delegate actual run creation and first-step enqueuing to the orchestrator.
        return self.orchestrator.start_new_run(command.job_id, trigger="retry")

    def cancel_job(self, command: CancelJobCommand) -> None:
        """Mark the job as cancelled; recovery/orchestration will stop queued work.

        Args:
            command: Carries the ``job_id`` of the job to cancel.
        """
        # The repository write is the *source of truth* for cancellation.
        # The orchestrator's recovery loop will notice this flag and
        # cancel any pending queue items on its next sweep.
        self.job_repo.mark_cancelled(command.job_id)

    def approve_publish(self, command: ApprovePublishCommand) -> str:
        """Resume a completed draft job at its publish step without redoing generation.

        Args:
            command: Carries the ``job_id`` of the job to approve.

        Returns:
            The newly created run ID for the publish-only run.
        """
        # Optimistically mark the job as running before we know the run_id;
        # start_new_run will overwrite with the real run_id shortly after.
        self.job_repo.mark_running(command.job_id, run_id=None)
        job = self.job_repo.get(command.job_id)

        # Determine the correct terminal publish step based on job type.
        # Courses and single content use different publish step names.
        first_step = "publish_content"
        if (job.get("job_type") or "").strip().lower() == "course":
            first_step = "publish_course"

        # start_new_run's ``first_step`` parameter lets us jump mid-pipeline,
        # skipping all generation steps and starting directly at publish.
        return self.orchestrator.start_new_run(
            command.job_id,
            trigger="manual_publish",
            first_step=first_step,
        )
