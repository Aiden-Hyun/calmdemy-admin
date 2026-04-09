"""Shared step input/output containers used by every executor in the pipeline.

Architectural Role:
    Pipeline Step -- this module defines the *contract* between the claim-loop
    orchestrator (``factory_v2.claim_loop``) and every concrete step executor.

Design Patterns:
    * **Template Method (data side)** -- ``StepContext`` is the standardized
      input that the orchestrator populates before calling any step, and
      ``StepResult`` is the standardized output every step must return.  The
      orchestrator never inspects step-specific internals; it only reads these
      two containers.  This decoupling lets you add new steps without touching
      the orchestrator.
    * **Command Object** -- each (StepContext -> StepResult) call is a
      self-contained unit of work that can be retried, checkpointed, or
      distributed to a different worker.

Key Dependencies:
    None -- intentionally zero internal imports so every other module can
    import ``StepContext`` and ``StepResult`` without circular-dependency risk.

Consumed By:
    * ``factory_v2.steps.registry`` -- type-alias ``StepExecutor``
    * Every concrete step module (``single_content``, ``course_*``, ``subject``)
    * ``factory_v2.claim_loop`` -- constructs ``StepContext``, reads ``StepResult``
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable
from typing import Any


# ---------------------------------------------------------------------------
# StepContext -- the "request envelope" every step receives
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class StepContext:
    """Everything a step executor needs to do its work.

    Think of this as the per-step "request object": it carries the Firestore
    handle, the persisted job snapshot, shard metadata, and a progress hook.

    Attributes:
        db: Firestore client instance for reading/writing collections.
        job: Full snapshot of the ``factory_jobs`` document at claim time.
        run_id: Unique identifier for *this* execution attempt (used for
            idempotency guards and checkpoint tagging).
        step_name: The registry key that resolved to this executor, e.g.
            ``"generate_script"`` or ``"synthesize_course_audio_chunk"``.
        worker_id: Identifier of the worker process that claimed this step.
        shard_key: For fan-out steps, identifies which slice of work this
            invocation owns (e.g. ``"M2P"`` for a course session, or
            ``"M2P:2"`` for chunk 2 of that session).  Defaults to ``"root"``
            for non-sharded steps.
        step_input: Arbitrary key-value bag the orchestrator may populate
            with shard-specific metadata (chunk indexes, session codes, etc.).
        progress_callback: Optional hook the claim loop injects so the step
            can push human-readable status strings to the admin UI in real time.
    """

    db: Any
    job: dict
    run_id: str
    step_name: str
    worker_id: str
    # "root" means this is the primary (non-sharded) invocation of the step.
    shard_key: str = "root"
    step_input: dict[str, Any] = field(default_factory=dict)
    progress_callback: Callable[[str | None], None] | None = None

    def progress(self, detail: str | None = None) -> None:
        """Report a human-readable progress string back to the watchdog/UI layer."""
        if self.progress_callback is not None:
            self.progress_callback(detail)


# ---------------------------------------------------------------------------
# StepResult -- the "response envelope" every step returns
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class StepResult:
    """Structured return value from a step executor.

    Steps do not write directly to every collection themselves. Instead they
    return patches describing what changed, and the claim loop applies those
    patches in a consistent order after execution succeeds.

    Attributes:
        output: Step-specific data surfaced to downstream steps via the DAG.
        runtime_patch: Merged into ``factory_jobs.runtime`` -- the mutable
            accumulator that carries artifacts (scripts, audio paths, plans)
            from one step to the next across the entire pipeline.
        summary_patch: Lightweight progress data merged into
            ``factory_jobs.summary`` (shown in the admin dashboard).
        compat_content_job_patch: Fields written to the legacy
            ``content_jobs`` collection so the existing admin UI stays in
            sync during the V1-to-V2 migration period.
        requeue_after_seconds: When set, the claim loop will schedule
            another execution of this *same* step after the given delay.
            Used by polling steps like ``watch_subject_children`` that need
            to periodically re-check child job progress.
    """

    output: dict[str, Any] = field(default_factory=dict)
    runtime_patch: dict[str, Any] = field(default_factory=dict)
    summary_patch: dict[str, Any] = field(default_factory=dict)
    compat_content_job_patch: dict[str, Any] = field(default_factory=dict)
    # Non-None means "run me again later" -- the claim loop treats this as a
    # self-requeue signal rather than a terminal completion.
    requeue_after_seconds: int | None = None
