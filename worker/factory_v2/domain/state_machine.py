"""Transition guards that keep job and step states moving through valid paths."""

from __future__ import annotations

from .entities import JobState, StepState
from .errors import InvalidTransitionError


_JOB_TRANSITIONS: dict[JobState, set[JobState]] = {
    JobState.QUEUED: {JobState.RUNNING, JobState.CANCELLED},
    JobState.RUNNING: {
        JobState.AWAITING_APPROVAL,
        JobState.COMPLETED,
        JobState.FAILED,
        JobState.CANCELLED,
    },
    JobState.AWAITING_APPROVAL: {JobState.RUNNING, JobState.COMPLETED, JobState.CANCELLED},
    JobState.COMPLETED: set(),
    JobState.FAILED: {JobState.RUNNING, JobState.CANCELLED},
    JobState.CANCELLED: set(),
}

_STEP_TRANSITIONS: dict[StepState, set[StepState]] = {
    StepState.READY: {StepState.LEASED},
    StepState.LEASED: {StepState.RUNNING, StepState.RETRY_SCHEDULED},
    StepState.RUNNING: {StepState.SUCCEEDED, StepState.FAILED, StepState.RETRY_SCHEDULED},
    StepState.FAILED: {StepState.RETRY_SCHEDULED, StepState.DEAD_LETTER},
    StepState.RETRY_SCHEDULED: {StepState.READY, StepState.DEAD_LETTER},
    StepState.SUCCEEDED: set(),
    StepState.DEAD_LETTER: set(),
}


def validate_job_transition(current: JobState, target: JobState) -> None:
    """Raise if the requested job-state transition would break the workflow contract."""
    if target not in _JOB_TRANSITIONS.get(current, set()):
        raise InvalidTransitionError(f"Invalid job transition: {current.value} -> {target.value}")


def validate_step_transition(current: StepState, target: StepState) -> None:
    """Raise if the requested step-state transition is not allowed."""
    allowed = _STEP_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidTransitionError(f"Invalid step transition: {current.value} -> {target.value}")
