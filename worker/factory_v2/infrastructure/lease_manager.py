"""Helpers for interpreting lease timestamps in queue / recovery code.

Architectural Role
------------------
Infrastructure Layer -- small utility consumed by the queue repository
and the stale-lease recovery routine.

Design Patterns
---------------
* **Optimistic locking via time-limited leases** -- Instead of
  traditional database locks, the queue uses *leases*: a worker writes
  a ``lease_expires_at`` timestamp when it claims work.  If the worker
  dies before finishing, the lease eventually expires and another worker
  can reclaim the item.  This module provides the predicate that
  answers "has the lease expired?"

* **Compare-and-swap (CAS) semantics** -- The actual CAS happens in
  ``FirestoreQueueRepo.claim_ready_doc`` (a Firestore transaction that
  reads state, checks it is ``ready``, then writes ``leased``).  This
  module only evaluates the *time* component; the transactional state
  check lives in the queue repo.

Key Dependencies
----------------
* Python ``datetime`` (stdlib) -- no external packages needed.

Consumed By
-----------
* ``queue_repo.FirestoreQueueRepo.recover_stale_leases``
* Recovery / watchdog background tasks.
"""

from __future__ import annotations

from datetime import datetime, timezone


def lease_expired(lease_expires_at) -> bool:
    """Return ``True`` when a queue lease is missing, invalid, or past due.

    The input may be a Python ``datetime``, a Firestore ``DatetimeWithNanoseconds``
    (which exposes ``.timestamp()``), or ``None``.  Any unrecognized type
    is treated as expired so that recovery errs on the side of releasing
    stuck work rather than leaving it orphaned.

    Args:
        lease_expires_at: The lease expiry value read from Firestore.
            Can be ``None``, a ``datetime``, or a Firestore timestamp
            proto wrapper.

    Returns:
        ``True`` if the lease should be considered expired (or absent).
    """
    # No lease recorded at all -- treat as expired.
    if lease_expires_at is None:
        return True

    # Firestore timestamps are ``DatetimeWithNanoseconds`` which have a
    # ``.timestamp()`` method but are not plain ``datetime`` instances.
    # We normalise to a tz-aware UTC datetime for a clean comparison.
    if hasattr(lease_expires_at, "timestamp"):
        value = datetime.fromtimestamp(lease_expires_at.timestamp(), tz=timezone.utc)
    elif isinstance(lease_expires_at, datetime):
        # Ensure we compare apples-to-apples (tz-aware datetimes).
        value = lease_expires_at if lease_expires_at.tzinfo else lease_expires_at.replace(tzinfo=timezone.utc)
    else:
        # Unknown type -- safe default is "expired".
        return True

    return value <= datetime.now(timezone.utc)
