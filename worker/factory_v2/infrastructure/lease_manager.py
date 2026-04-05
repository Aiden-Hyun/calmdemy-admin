"""Small helpers for interpreting lease timestamps in queue/recovery code."""

from __future__ import annotations

from datetime import datetime, timezone


def lease_expired(lease_expires_at) -> bool:
    """Return `True` when a queue lease is missing, invalid, or already expired."""
    if lease_expires_at is None:
        return True

    if hasattr(lease_expires_at, "timestamp"):
        value = datetime.fromtimestamp(lease_expires_at.timestamp(), tz=timezone.utc)
    elif isinstance(lease_expires_at, datetime):
        value = lease_expires_at if lease_expires_at.tzinfo else lease_expires_at.replace(tzinfo=timezone.utc)
    else:
        return True

    return value <= datetime.now(timezone.utc)
