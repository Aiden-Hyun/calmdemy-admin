"""Typed domain records for the state persisted in Firestore collections."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class JobState(str, Enum):
    """High-level lifecycle states for a factory job run as a whole."""

    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StepState(str, Enum):
    """Lifecycle states for a single workflow step execution."""

    READY = "ready"
    LEASED = "leased"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    RETRY_SCHEDULED = "retry_scheduled"
    DEAD_LETTER = "dead_letter"


@dataclass(slots=True)
class FactoryJob:
    """Durable snapshot of a job plus the mutable runtime/summary projections."""

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
    """One concrete execution attempt for a job."""

    id: str
    job_id: str
    run_number: int
    state: JobState
    trigger: str
    started_at: datetime | None = None
    ended_at: datetime | None = None


@dataclass(slots=True)
class StepRun:
    """Audit record for one step execution, including retries and sharded steps."""

    id: str
    job_id: str
    run_id: str
    step_name: str
    state: StepState
    attempt: int = 1
    shard_key: str | None = None
    lease_owner: str | None = None
    lease_expires_at: datetime | None = None
    input_ref: str | None = None
    output_ref: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


@dataclass(slots=True)
class Artifact:
    """Metadata about an output produced by a step and tracked in runtime lineage."""

    id: str
    job_id: str
    run_id: str
    kind: str
    producer_step_run_id: str
    payload: dict[str, Any] = field(default_factory=dict)
