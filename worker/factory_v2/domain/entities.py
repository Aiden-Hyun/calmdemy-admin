"""Domain entities and value objects for the Content Factory V2 workflow.

Architectural Role:
    Domain Layer -- the innermost ring in hexagonal (ports-and-adapters)
    architecture. These classes define the **core data shapes** that every
    other layer depends on but that themselves depend on nothing outside
    the Python standard library.

Design Patterns:
    * Entity pattern -- FactoryJob, JobRun, StepRun, and Artifact each
      carry an ``id`` that gives them a unique identity across their
      lifecycle. Two entities with the same field values but different ids
      are considered distinct.
    * Value Object pattern -- JobState and StepState are value objects
      implemented as ``str``-based enums. They have no identity of their
      own; equality is purely by value.
    * Immutable-ish dataclasses -- ``slots=True`` prevents accidental
      attribute creation. Fields are still mutable by design (the
      infrastructure layer hydrates them from Firestore), but the intent
      is to treat them as snapshots: read, decide, persist.

Key Dependencies:
    None beyond the standard library (dataclasses, datetime, enum, typing).
    This is intentional -- the domain must stay framework-free so it can
    be unit-tested without Firestore, Flask, or any network dependency.

Consumed By:
    * ``domain/state_machine.py`` -- validates transitions using the
      enums defined here.
    * ``infrastructure/firestore_repos.py`` -- serializes / deserializes
      these entities to and from Firestore documents.
    * ``application/`` commands and ``interfaces/`` entry points use
      these types to pass structured data between layers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Value Objects -- state enums
# ---------------------------------------------------------------------------
# These enums inherit from ``str`` so their values serialize cleanly to
# JSON / Firestore without a custom encoder. Each member maps 1-to-1 with
# a Firestore document field value (e.g. "queued", "running").
# ---------------------------------------------------------------------------


class JobState(str, Enum):
    """High-level lifecycle states for a factory job run as a whole.

    The allowed transitions between these states are enforced separately
    in ``state_machine.py``. Terminal states (COMPLETED, FAILED,
    CANCELLED) are the only ones from which no further transition is
    possible -- except FAILED, which allows a retry back to RUNNING.
    """

    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"  # Paused for human review
    COMPLETED = "completed"  # Terminal -- success
    FAILED = "failed"  # Terminal-ish -- retryable back to RUNNING
    CANCELLED = "cancelled"  # Terminal -- hard stop


class StepState(str, Enum):
    """Lifecycle states for a single workflow step execution.

    A step follows a lease-based execution model:
        READY -> LEASED -> RUNNING -> SUCCEEDED
    with failure / retry branches handled by FAILED, RETRY_SCHEDULED,
    and DEAD_LETTER (permanent failure after max retries).
    """

    READY = "ready"  # Eligible to be claimed by a worker
    LEASED = "leased"  # Claimed; lease has an expiry
    RUNNING = "running"  # Actively executing
    SUCCEEDED = "succeeded"  # Terminal -- success
    FAILED = "failed"  # Can retry or go to dead letter
    RETRY_SCHEDULED = "retry_scheduled"  # Waiting for backoff before retry
    DEAD_LETTER = "dead_letter"  # Terminal -- exhausted retries


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------
# Each entity corresponds to a Firestore document (or sub-collection
# document). The ``@dataclass(slots=True)`` decorator generates
# ``__slots__`` for memory efficiency and prevents typos like
# ``job.staet = ...`` from silently creating a new attribute.
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class FactoryJob:
    """Durable snapshot of a job plus the mutable runtime/summary projections.

    This is the **aggregate root** of the job workflow.  All mutations
    to runs, steps, and artifacts are logically "owned" by this entity.

    Attributes:
        id: Unique job identifier (typically a Firestore doc ID).
        job_type: Discriminator for which pipeline to run
            (e.g. "single_content", "course").
        request: Arbitrary caller-supplied parameters for the pipeline.
        state: Current lifecycle state (see ``JobState``).
        current_run_id: Points to the active ``JobRun``, if any.
        created_at: Timestamp when the job was first persisted.
        updated_at: Timestamp of the last state mutation.
        summary: Projection dict that accumulates human-readable
            progress info (step counts, durations, etc.).
    """

    id: str
    job_type: str
    request: dict[str, Any]
    state: JobState = JobState.QUEUED
    current_run_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    summary: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class JobRun:
    """One concrete execution attempt for a job.

    A single ``FactoryJob`` may have multiple ``JobRun`` records when
    the job is retried after failure.  ``run_number`` is a monotonically
    increasing counter (1-based) that distinguishes retries.

    Attributes:
        id: Unique run identifier.
        job_id: Back-reference to the parent ``FactoryJob``.
        run_number: 1-based ordinal of this attempt.
        state: Mirrors the job-level ``JobState`` for this attempt.
        trigger: What initiated the run (e.g. "api", "retry", "admin").
        started_at: When execution began.
        ended_at: When execution finished (success or failure).
    """

    id: str
    job_id: str
    run_number: int
    state: JobState
    trigger: str
    started_at: datetime | None = None
    ended_at: datetime | None = None


@dataclass(slots=True)
class StepRun:
    """Audit record for one step execution, including retries and sharded steps.

    Steps use a **lease-based concurrency** model: a worker must acquire
    a lease (setting ``lease_owner`` and ``lease_expires_at``) before it
    can transition the step to RUNNING. If the lease expires before the
    step completes, another worker can reclaim it.

    Attributes:
        id: Unique step-run identifier.
        job_id: Back-reference to the parent job.
        run_id: Back-reference to the parent ``JobRun``.
        step_name: Logical name of the pipeline step (e.g. "generate_script").
        state: Current lifecycle state (see ``StepState``).
        attempt: 1-based retry counter for this step.
        shard_key: Optional key for parallel fan-out steps (e.g. a
            chapter index). ``None`` for non-sharded steps.
        lease_owner: Identifier of the worker holding the lease.
        lease_expires_at: When the current lease expires.
        input_ref: Storage path or artifact ID that fed this step.
        output_ref: Storage path or artifact ID this step produced.
        error_code: Machine-readable error code on failure.
        error_message: Human-readable error detail on failure.
        started_at: When the step began executing.
        ended_at: When the step finished.
    """

    id: str
    job_id: str
    run_id: str
    step_name: str
    state: StepState
    attempt: int = 1
    shard_key: str | None = None  # Non-None for fan-out / parallel steps
    lease_owner: str | None = None
    lease_expires_at: datetime | None = None
    input_ref: str | None = None  # Pointer to upstream artifact
    output_ref: str | None = None  # Pointer to produced artifact
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


@dataclass(slots=True)
class Artifact:
    """Metadata about an output produced by a step and tracked in runtime lineage.

    Artifacts form the **data lineage graph** of a pipeline run.  Each
    artifact knows which step produced it (``producer_step_run_id``),
    making it possible to trace any output back through the chain of
    steps that created it.

    Attributes:
        id: Unique artifact identifier.
        job_id: Back-reference to the parent job.
        run_id: Back-reference to the parent run.
        kind: Type discriminator (e.g. "script", "audio", "image").
        producer_step_run_id: The ``StepRun.id`` that created this artifact.
        payload: Flexible dict holding artifact-specific data (storage
            paths, durations, metadata, etc.).
    """

    id: str
    job_id: str
    run_id: str
    kind: str
    producer_step_run_id: str
    payload: dict[str, Any] = field(default_factory=dict)
