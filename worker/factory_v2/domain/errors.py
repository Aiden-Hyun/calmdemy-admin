"""Domain-specific exception hierarchy for the Content Factory V2 workflow.

Architectural Role:
    Domain Layer -- these exceptions express **business rule violations**
    rather than infrastructure failures (network timeouts, Firestore
    errors, etc.). Keeping them in the domain lets application and
    interface layers catch domain problems separately from technical ones.

Design Patterns:
    * Exception Hierarchy -- a single base class (``FactoryV2Error``)
      lets callers write broad ``except FactoryV2Error`` handlers when
      they want to catch *any* workflow problem, while subclasses allow
      fine-grained handling of specific failure modes.
    * Fail-Fast Validation -- ``InvalidTransitionError`` is raised by the
      state machine *before* any persistence happens, ensuring the
      domain model stays consistent even if the caller forgets to check.

Key Dependencies:
    None -- only built-in ``Exception``.

Consumed By:
    * ``domain/state_machine.py`` -- raises ``InvalidTransitionError``.
    * ``infrastructure/lease_manager.py`` -- raises ``LeaseUnavailableError``.
    * ``interfaces/claim_loop.py`` and ``steps/`` executors -- raise or
      catch ``StepExecutionError``.
    * Any layer can catch ``FactoryV2Error`` as a blanket domain-error
      handler.
"""


# ---------------------------------------------------------------------------
# Base exception
# ---------------------------------------------------------------------------
# All domain exceptions inherit from this class so that higher layers can
# distinguish "the workflow said no" from "Firestore timed out" with a
# single ``except FactoryV2Error`` clause.
# ---------------------------------------------------------------------------


class FactoryV2Error(Exception):
    """Base exception for all Content Factory V2 domain errors.

    Catch this at the boundary between the domain and the outside world
    (e.g. in an HTTP handler or the worker main loop) to handle any
    business-rule violation uniformly.
    """


# ---------------------------------------------------------------------------
# State-machine errors
# ---------------------------------------------------------------------------


class InvalidTransitionError(FactoryV2Error):
    """Raised when the state machine receives an illegal transition.

    Example:
        Attempting to move a job from COMPLETED -> RUNNING would trigger
        this because COMPLETED is a terminal state with no outgoing edges
        in the transition graph (see ``state_machine._JOB_TRANSITIONS``).
    """


# ---------------------------------------------------------------------------
# Lease / concurrency errors
# ---------------------------------------------------------------------------


class LeaseUnavailableError(FactoryV2Error):
    """Raised when a worker cannot acquire a lease on a step.

    This typically means another worker already holds the lease and its
    expiry has not yet passed. The caller should back off and retry or
    move on to the next available step.
    """


# ---------------------------------------------------------------------------
# Step execution errors
# ---------------------------------------------------------------------------


class StepExecutionError(FactoryV2Error):
    """Raised when a step executor encounters a non-recoverable failure.

    The claim loop catches this to transition the step to FAILED (and
    potentially schedule a retry). Wrapping the original cause preserves
    the traceback chain for debugging::

        raise StepExecutionError("TTS failed") from original_exc
    """
