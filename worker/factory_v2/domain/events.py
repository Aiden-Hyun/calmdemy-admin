"""Small event record used when emitting workflow lifecycle events."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class DomainEvent:
    """Normalized shape for domain events before they are persisted or published."""

    event_type: str
    job_id: str
    run_id: str | None
    payload: dict[str, Any]
    emitted_at: datetime
