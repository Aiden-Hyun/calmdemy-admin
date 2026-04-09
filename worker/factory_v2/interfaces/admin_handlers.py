"""Admin command handlers for the Content Factory V2 pipeline.

Architectural Role:
    This module is a **driving adapter** that translates admin UI actions
    (retry, cancel, approve-publish) into application-layer commands.
    It sits at the boundary between external triggers (HTTP endpoints,
    Cloud Functions, or direct calls) and the domain logic.

Design Patterns:
    * **Command Handler / Facade** -- Each public method accepts a
      simple ``job_id`` string, wraps it in a typed command object
      (``RetryJobCommand``, ``CancelJobCommand``, etc.), and delegates
      to the ``CommandService``.  This keeps the interface surface
      minimal and decouples callers from the command internals.
    * **Thin Adapter** -- The class intentionally contains no business
      logic.  All validation, state transitions, and side effects live
      inside ``CommandService`` (application layer).

Key Dependencies:
    * ``CommandService`` (application/commands.py) -- orchestrates the
      actual retry/cancel/publish workflows.
    * Typed command dataclasses (``RetryJobCommand``, etc.) -- enforce
      the shape of each request at the type level.

Consumed By:
    * Admin API endpoints or Cloud Function triggers that need to
      programmatically control pipeline jobs.
"""

from __future__ import annotations

from ..application.commands import (
    ApprovePublishCommand,
    CancelJobCommand,
    CommandService,
    RetryJobCommand,
)


class AdminHandlers:
    """Thin adapter that maps admin actions to application-layer commands.

    Each method is a one-liner that constructs the appropriate command
    object and delegates to ``CommandService``.  This keeps the public
    API surface simple and lets the application layer own all logic.

    Args:
        command_service: The application-layer service that executes
            retry, cancel, and publish workflows.
    """

    def __init__(self, command_service: CommandService):
        self.command_service = command_service

    def retry_job(self, job_id: str) -> str:
        """Retry a failed job by starting a new V2 run.

        Returns:
            The new run ID.
        """
        return self.command_service.retry_job(RetryJobCommand(job_id=job_id))

    def cancel_job(self, job_id: str) -> None:
        """Cancel a running job and all its active steps."""
        self.command_service.cancel_job(CancelJobCommand(job_id=job_id))

    def approve_publish(self, job_id: str) -> str:
        """Approve a completed job for publishing.

        Returns:
            The new run ID for the publish pipeline.
        """
        return self.command_service.approve_publish(ApprovePublishCommand(job_id=job_id))
