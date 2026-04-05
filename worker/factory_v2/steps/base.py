"""Shared step input/output containers used by every executor in the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable
from typing import Any


@dataclass(slots=True)
class StepContext:
    """Everything a step executor needs to do its work.

    Think of this as the per-step "request object": it carries the Firestore
    handle, the persisted job snapshot, shard metadata, and a progress hook.
    """

    db: Any
    job: dict
    run_id: str
    step_name: str
    worker_id: str
    shard_key: str = "root"
    step_input: dict[str, Any] = field(default_factory=dict)
    progress_callback: Callable[[str | None], None] | None = None

    def progress(self, detail: str | None = None) -> None:
        """Report a human-readable progress string back to the watchdog/UI layer."""
        if self.progress_callback is not None:
            self.progress_callback(detail)


@dataclass(slots=True)
class StepResult:
    """Structured return value from a step executor.

    Steps do not write directly to every collection themselves. Instead they
    return patches describing what changed, and the claim loop applies those
    patches in a consistent order after execution succeeds.
    """

    output: dict[str, Any] = field(default_factory=dict)
    runtime_patch: dict[str, Any] = field(default_factory=dict)
    summary_patch: dict[str, Any] = field(default_factory=dict)
    compat_content_job_patch: dict[str, Any] = field(default_factory=dict)
    requeue_after_seconds: int | None = None
