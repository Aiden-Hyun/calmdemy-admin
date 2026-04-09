"""Domain Event carrier for workflow lifecycle notifications.

Architectural Role:
    Domain Layer -- defines the **Domain Event** data shape. Domain
    events capture "something meaningful happened" in the workflow
    (e.g. a job started, a step failed, a run completed). They are
    created inside the domain / application layers and then handed off
    to infrastructure for persistence or pub/sub delivery.

Design Patterns:
    * Domain Event pattern -- instead of tightly coupling the code that
      *causes* a state change to the code that *reacts* to it, we emit
      a small, immutable event record. Consumers (loggers, analytics,
      notification services) subscribe independently, keeping the
      producing code simple and testable.
    * Normalized envelope -- every event shares the same top-level
      fields (event_type, job_id, run_id, emitted_at) so generic
      infrastructure (event store, pub/sub router) can route or index
      events without understanding their payloads.

Key Dependencies:
    None beyond the standard library.

Consumed By:
    * ``application/orchestrator.py`` -- creates events when jobs or
      steps change state.
    * ``infrastructure/firestore_repos.py`` -- persists events to an
      event log collection.
    * ``interfaces/status_projection.py`` -- reads events to build
      real-time progress views.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class DomainEvent:
    """Normalized envelope for a single domain event.

    This is a **Value Object**: two events with identical fields are
    considered equal. It carries no behavior -- it is purely a data
    transfer object that crosses layer boundaries.

    Attributes:
        event_type: Machine-readable discriminator string such as
            ``"job.started"``, ``"step.failed"``, or ``"run.completed"``.
            Consumers use this to filter which events they care about.
        job_id: The job this event belongs to. Always present so every
            event can be correlated back to a job.
        run_id: The specific run within the job, or ``None`` for
            job-level events that are not tied to a single run
            (e.g. cancellation).
        payload: Arbitrary event-specific data. Kept as a plain dict
            so the domain layer does not need to define a separate
            dataclass for every possible event type.
        emitted_at: UTC timestamp of when the event was created.
            Set by the producer at emission time, not by the consumer.
    """

    event_type: str
    job_id: str
    run_id: str | None
    payload: dict[str, Any]
    emitted_at: datetime
