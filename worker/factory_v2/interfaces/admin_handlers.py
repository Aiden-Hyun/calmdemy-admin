from __future__ import annotations

from ..application.commands import (
    ApprovePublishCommand,
    CancelJobCommand,
    CommandService,
    RetryJobCommand,
)


class AdminHandlers:
    """Thin wrapper used by future admin endpoints/UI actions."""

    def __init__(self, command_service: CommandService):
        self.command_service = command_service

    def retry_job(self, job_id: str) -> str:
        return self.command_service.retry_job(RetryJobCommand(job_id=job_id))

    def cancel_job(self, job_id: str) -> None:
        self.command_service.cancel_job(CancelJobCommand(job_id=job_id))

    def approve_publish(self, job_id: str) -> str:
        return self.command_service.approve_publish(ApprovePublishCommand(job_id=job_id))
