"""Finite-state-machine guards for job and step lifecycle transitions.

Architectural Role:
    Domain Layer -- pure business logic with zero framework dependencies.
    This module is the **single source of truth** for which state
    transitions are legal. Every layer that wants to change a job or
    step state must pass through these guards first.

Design Patterns:
    * Finite State Machine (FSM) -- states and allowed transitions are
      encoded as adjacency-set dicts. Each key is a source state; its
      value is the set of states reachable from it. An empty set means
      the state is *terminal* (no outgoing edges).
    * Guard / Assertion pattern -- the ``validate_*`` functions act as
      **transition guards**. They do not perform the transition
      themselves; they only raise ``InvalidTransitionError`` if the
      caller is about to violate the contract. This separates "is it
      allowed?" from "do it", keeping the logic easy to test.

Key Dependencies:
    * ``entities.JobState``, ``entities.StepState`` -- the enum values
      that make up the FSM alphabets.
    * ``errors.InvalidTransitionError`` -- raised on illegal moves.

Consumed By:
    * ``application/orchestrator.py`` and ``application/commands.py`` --
      call the guards before persisting state changes.
    * ``infrastructure/lease_manager.py`` -- validates step transitions
      during lease acquisition and release.

State Diagrams (for quick visual reference):

    Job FSM::

        QUEUED ──> RUNNING ──> COMPLETED
          │           │  ↑          (terminal)
          │           │  │
          │           ↓  │
          │     AWAITING_APPROVAL ──> COMPLETED
          │           │
          │           ↓
          ├──────> CANCELLED        (terminal)
          │           ↑
          │           │
          └──(any)────┘
                      │
        FAILED ──> RUNNING          (retry path)
          │
          └──────> CANCELLED

    Step FSM::

        READY ──> LEASED ──> RUNNING ──> SUCCEEDED  (terminal)
                    │           │  │
                    │           │  └──> FAILED ──> RETRY_SCHEDULED
                    │           │         │              │  │
                    │           └────────>│              │  │
                    └─────────────────────┘              │  │
                                          ↓             │  │
                                     RETRY_SCHEDULED <──┘  │
                                          │                │
                                          ├──> READY       │
                                          └──> DEAD_LETTER (terminal)
"""

from __future__ import annotations

from .entities import JobState, StepState
from .errors import InvalidTransitionError


# ---------------------------------------------------------------------------
# Job-level transition table
# ---------------------------------------------------------------------------
# Each key maps to the set of states that are reachable from it.
# An empty set ``set()`` marks a terminal state -- the job cannot leave it.
# ---------------------------------------------------------------------------

_JOB_TRANSITIONS: dict[JobState, set[JobState]] = {
    # A queued job can start running or be cancelled before it starts.
    JobState.QUEUED: {JobState.RUNNING, JobState.CANCELLED},

    # A running job can pause for approval, finish, fail, or be cancelled.
    JobState.RUNNING: {
        JobState.AWAITING_APPROVAL,
        JobState.COMPLETED,
        JobState.FAILED,
        JobState.CANCELLED,
    },

    # After human approval the job resumes, completes, or gets cancelled.
    JobState.AWAITING_APPROVAL: {JobState.RUNNING, JobState.COMPLETED, JobState.CANCELLED},

    # COMPLETED is terminal -- no further transitions allowed.
    JobState.COMPLETED: set(),

    # FAILED is *not* fully terminal: the job can be retried (-> RUNNING)
    # or abandoned (-> CANCELLED). This is the retry path.
    JobState.FAILED: {JobState.RUNNING, JobState.CANCELLED},

    # CANCELLED is terminal -- no further transitions allowed.
    JobState.CANCELLED: set(),
}

# ---------------------------------------------------------------------------
# Step-level transition table
# ---------------------------------------------------------------------------
# Steps follow a lease-acquire-execute-release cycle:
#   READY -> LEASED -> RUNNING -> SUCCEEDED
# Failures branch into a retry loop that can ultimately dead-letter.
# ---------------------------------------------------------------------------

_STEP_TRANSITIONS: dict[StepState, set[StepState]] = {
    # A ready step can only be leased (claimed by a worker).
    StepState.READY: {StepState.LEASED},

    # A leased step starts running, or the lease expires / is revoked
    # and the step is scheduled for retry.
    StepState.LEASED: {StepState.RUNNING, StepState.RETRY_SCHEDULED},

    # A running step succeeds, fails, or is rescheduled (e.g. timeout).
    StepState.RUNNING: {StepState.SUCCEEDED, StepState.FAILED, StepState.RETRY_SCHEDULED},

    # A failed step can be retried or sent to the dead-letter queue
    # if max retries are exhausted.
    StepState.FAILED: {StepState.RETRY_SCHEDULED, StepState.DEAD_LETTER},

    # After a backoff period, a retry-scheduled step goes back to READY
    # to be leased again, or to DEAD_LETTER if retries are exhausted.
    StepState.RETRY_SCHEDULED: {StepState.READY, StepState.DEAD_LETTER},

    # SUCCEEDED is terminal.
    StepState.SUCCEEDED: set(),

    # DEAD_LETTER is terminal -- the step has permanently failed.
    StepState.DEAD_LETTER: set(),
}


# ---------------------------------------------------------------------------
# Transition guard functions
# ---------------------------------------------------------------------------


def validate_job_transition(current: JobState, target: JobState) -> None:
    """Check that moving from *current* to *target* is a legal job transition.

    This is a **guard function** -- it does not mutate any state. Call it
    *before* persisting the new state to Firestore so that an illegal
    transition is caught early and never written to the database.

    Args:
        current: The job's present state.
        target: The state the caller wants to move to.

    Raises:
        InvalidTransitionError: If *target* is not in the allowed set
            for *current*.
    """
    # .get(current, set()) handles the (unlikely) case of an unknown
    # state gracefully -- it will always raise because empty set
    # contains nothing.
    if target not in _JOB_TRANSITIONS.get(current, set()):
        raise InvalidTransitionError(f"Invalid job transition: {current.value} -> {target.value}")


def validate_step_transition(current: StepState, target: StepState) -> None:
    """Check that moving from *current* to *target* is a legal step transition.

    Same guard semantics as ``validate_job_transition`` but for the
    step-level FSM.

    Args:
        current: The step's present state.
        target: The state the caller wants to move to.

    Raises:
        InvalidTransitionError: If *target* is not in the allowed set
            for *current*.
    """
    allowed = _STEP_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidTransitionError(f"Invalid step transition: {current.value} -> {target.value}")
