"""Firestore-backed queue primitives used by workers and recovery routines.

Architectural Role
------------------
Infrastructure Layer -- implements a durable work queue on top of a
single Firestore collection (``factory_step_queue``).  This is a
"poor-man's message queue" that trades throughput for simplicity: every
queue item is a Firestore document whose ``state`` field drives a
state machine.

Design Patterns
---------------
* **Repository** -- all Firestore access for queue documents is
  encapsulated here; callers never touch raw document references.
* **Lease-based concurrency** -- instead of deleting items on claim,
  workers *lease* them for a bounded duration.  If the worker crashes
  the lease expires and recovery returns the item to ``ready``.
* **Idempotent enqueue** -- deterministic document IDs
  (``run__step__shard``) mean duplicate enqueues are harmless.
* **Capability routing** -- each queue item carries a ``capability_key``
  (e.g. ``tts:qwen3``, ``image``, ``default``) so heterogeneous workers
  can poll only for work they can handle.

Queue State Machine
-------------------
::

    ready -> leased -> running -> succeeded
                             \\-> failed
                             \\-> ready  (retry / continuation)
          \\-> failed (cancelled)

* ``ready``     -- eligible for claim once ``available_at`` is in the past.
* ``leased``    -- a worker has claimed it; ``lease_expires_at`` is set.
* ``running``   -- executor work has actually started.
* ``succeeded`` -- terminal success.
* ``failed``    -- terminal failure (or cancelled).

Key Dependencies
----------------
* ``firebase_admin.firestore`` -- transactions, server timestamps,
  ``Increment`` sentinel, ``AlreadyExists``.
* ``queue_capabilities`` -- translates step names into capability keys.

Consumed By
-----------
* Worker poll loops (``fetch_ready_by_capability`` + ``claim_ready_doc``).
* Step executors (``mark_running``, ``heartbeat_running``, ``mark_done``).
* Orchestrator (``enqueue``, ``schedule_retry``, ``cancel_ready_for_run``).
* Recovery cron (``recover_stale_leases``).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from google.api_core.exceptions import AlreadyExists
from firebase_admin import firestore as fs

from ..shared.queue_capabilities import capability_key_for_step


class FirestoreQueueRepo:
    """Low-level queue operations over the ``factory_step_queue`` collection."""

    def __init__(self, db):
        self.db = db

    @staticmethod
    def make_queue_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
        """Build a deterministic queue document ID.

        Deterministic IDs are central to idempotent enqueue: calling
        ``enqueue()`` twice for the same work simply hits the same
        document, so duplicate messages are impossible by construction.
        """
        return f"{run_id}__{step_name}__{shard_key}"

    def state(self, run_id: str, step_name: str, shard_key: str = "root") -> str | None:
        """Return the current state of a queue item, or ``None`` if absent."""
        snap = self.db.collection("factory_step_queue").document(
            self.make_queue_id(run_id, step_name, shard_key)
        ).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        state = str(data.get("state") or "").strip()
        return state or None

    def enqueue(
        self,
        job_id: str,
        run_id: str,
        step_name: str,
        step_run_id: str,
        shard_key: str = "root",
        step_input: dict | None = None,
        available_at: datetime | None = None,
        required_tts_model: str | None = None,
    ) -> str:
        """Create a ready queue item for one run/step/shard combination.

        Queue ids are deterministic, so enqueueing the same work twice is safe
        and behaves like an idempotent "ensure exists" operation.
        """
        queue_id = self.make_queue_id(run_id, step_name, shard_key)
        doc_ref = self.db.collection("factory_step_queue").document(queue_id)
        normalized_tts_model = str(required_tts_model or "").strip().lower()
        payload = {
            "job_id": job_id,
            "run_id": run_id,
            "step_name": step_name,
            "step_run_id": step_run_id,
            "shard_key": shard_key,
            "step_input": dict(step_input or {}),
            "state": "ready",
            # Items with a future ``available_at`` are invisible to poll
            # queries until that moment -- used for delayed retries.
            "available_at": available_at or datetime.now(timezone.utc),
            "retry_count": 0,
            "stuck_retry_count": 0,
            # capability_key lets workers filter for work they can do
            # (e.g. a GPU worker polls for "tts:qwen3" items).
            "capability_key": capability_key_for_step(step_name, normalized_tts_model),
            "created_at": fs.SERVER_TIMESTAMP,
            "updated_at": fs.SERVER_TIMESTAMP,
        }
        if normalized_tts_model:
            payload["required_tts_model"] = normalized_tts_model
        try:
            # create() fails with AlreadyExists if the doc is already
            # present -- exactly the idempotency guarantee we want.
            doc_ref.create(payload)
        except AlreadyExists:
            pass
        return queue_id

    def fetch_ready(
        self,
        available_before: datetime,
        limit: int,
    ) -> list[Any]:
        """Return up to ``limit`` queue docs that are ready for claiming.

        Results are ordered oldest-first (FIFO) so starvation-free.
        """
        query = (
            self.db.collection("factory_step_queue")
            .where("state", "==", "ready")
            .where("available_at", "<=", available_before)
            .order_by("available_at")
            .limit(limit)
        )
        return list(query.stream())

    def fetch_ready_by_capability(
        self,
        capability_key: str,
        available_before: datetime,
        limit: int,
    ) -> list[Any]:
        """Like ``fetch_ready`` but filtered to a single capability key.

        Workers with specialised hardware (GPU, specific TTS model) call
        this so they only see work they are equipped to handle.
        """
        query = (
            self.db.collection("factory_step_queue")
            .where("state", "==", "ready")
            .where("capability_key", "==", capability_key)
            .where("available_at", "<=", available_before)
            .order_by("available_at")
            .limit(limit)
        )
        return list(query.stream())

    def fetch_payloads_by_states(
        self,
        states: Iterable[str],
        limit: int,
    ) -> list[dict]:
        """Fetch decoded payload dicts for items in any of ``states``.

        Firestore does not support ``WHERE state IN (...)`` with
        composite indexes well, so we issue one query per state.
        """
        payloads: list[dict] = []
        for state in states:
            query = self.db.collection("factory_step_queue").where("state", "==", state).limit(limit)
            for doc in query.stream():
                payload = doc.to_dict() or {}
                if payload:
                    payloads.append(payload)
        return payloads

    def fetch_docs_by_states(
        self,
        states: Iterable[str],
        limit: int,
    ) -> list[Any]:
        """Like ``fetch_payloads_by_states`` but returns raw Firestore
        document snapshots (needed when callers must access ``.reference``).
        """
        docs: list[Any] = []
        for state in states:
            query = self.db.collection("factory_step_queue").where("state", "==", state).limit(limit)
            docs.extend(list(query.stream()))
        return docs

    def claim_ready_doc(
        self,
        doc_ref,
        worker_id: str,
        lease_seconds: int = 300,
        payload_validator: Callable[[dict], bool] | None = None,
    ) -> dict | None:
        """Atomically move a ``ready`` doc into ``leased`` for one worker.

        This is the **compare-and-swap (CAS) heart of the queue**.
        Inside a Firestore transaction we:

        1. Read the document (Firestore takes a read lock).
        2. Verify ``state == "ready"`` -- if another worker already
           claimed it, we bail out (returns ``None``).
        3. Optionally run ``payload_validator`` for caller-defined
           eligibility checks (e.g. capability matching).
        4. Write ``state = "leased"`` with an expiry timestamp.

        Because the read and write happen in a single Firestore
        transaction, exactly one worker wins even under contention.

        Args:
            doc_ref: Firestore document reference for the queue item.
            worker_id: Identifier of the claiming worker (for debugging).
            lease_seconds: How long the lease is valid.
            payload_validator: Optional predicate; return ``False`` to
                skip this item without claiming it.

        Returns:
            The original payload dict on success, or ``None`` if the
            item was already claimed or ineligible.
        """
        now = datetime.now(timezone.utc)
        tx = self.db.transaction()

        @fs.transactional
        def _claim(transaction):
            snap = doc_ref.get(transaction=transaction)
            if not snap.exists:
                return None
            data = snap.to_dict() or {}
            # CAS guard: only claim items that are still "ready".
            if data.get("state") != "ready":
                return None
            if payload_validator and not payload_validator(data):
                return None
            transaction.update(
                doc_ref,
                {
                    "state": "leased",
                    "lease_owner": worker_id,
                    # Lease expiry = now + lease_seconds.  Recovery will
                    # reclaim items whose lease_expires_at is in the past.
                    "lease_expires_at": datetime.fromtimestamp(
                        now.timestamp() + lease_seconds,
                        tz=timezone.utc,
                    ),
                    "updated_at": fs.SERVER_TIMESTAMP,
                },
            )
            return data

        return _claim(tx)

    def recover_stale_leases(self, max_docs: int = 50) -> int:
        """Reset expired ``leased`` / ``running`` queue items back to ``ready``.

        This is the **lease-recovery safety net**.  A background cron
        calls this periodically.  For each candidate it opens a
        transaction to re-check the state and expiry (double-check
        pattern) before resetting, because the initial query result may
        be stale by the time we act on it.

        Returns:
            Number of items successfully recovered.
        """
        now = datetime.now(timezone.utc)
        recovered = 0

        for state in ("leased", "running"):
            query = (
                self.db.collection("factory_step_queue")
                .where("state", "==", state)
                .where("lease_expires_at", "<=", now)
                .limit(max_docs)
            )
            for doc in query.stream():
                tx = self.db.transaction()

                @fs.transactional
                def _recover(transaction):
                    # Re-read inside the transaction -- the query
                    # snapshot could be seconds old by now.
                    snap = doc.reference.get(transaction=transaction)
                    if not snap.exists:
                        return False
                    data = snap.to_dict() or {}
                    live_state = str(data.get("state") or "")
                    if live_state not in ("leased", "running"):
                        return False

                    lease_expires_at = data.get("lease_expires_at")
                    if lease_expires_at is None:
                        return False

                    # Normalise the Firestore timestamp to a tz-aware
                    # datetime for a safe comparison (same logic as
                    # lease_manager.lease_expired).
                    lease_ts = (
                        datetime.fromtimestamp(lease_expires_at.timestamp(), tz=timezone.utc)
                        if hasattr(lease_expires_at, "timestamp")
                        else lease_expires_at
                    )
                    if isinstance(lease_ts, datetime) and lease_ts.tzinfo is None:
                        lease_ts = lease_ts.replace(tzinfo=timezone.utc)
                    if not isinstance(lease_ts, datetime) or lease_ts > now:
                        return False

                    # Reset to "ready" and clear all worker/heartbeat
                    # metadata so the item looks brand-new to the next
                    # worker that picks it up.
                    transaction.update(
                        doc.reference,
                        {
                            "state": "ready",
                            "lease_owner": None,
                            "lease_expires_at": None,
                            "available_at": now,
                            "last_step_heartbeat_at": None,
                            "step_started_at": None,
                            "step_deadline_at": None,
                            "heartbeat_interval_sec": None,
                            "progress_detail": None,
                            "updated_at": fs.SERVER_TIMESTAMP,
                        },
                    )
                    return True

                if _recover(tx):
                    recovered += 1

        return recovered

    def mark_running(
        self,
        queue_id: str,
        worker_id: str,
        *,
        lease_seconds: int = 300,
        started_at: datetime | None = None,
        deadline_at: datetime | None = None,
        heartbeat_interval_sec: int | None = None,
    ) -> None:
        """Promote a ``leased`` item to ``running`` once work begins.

        The lease is *extended* here because claiming and starting may
        not be instantaneous (model loading, etc.).
        """
        now = datetime.now(timezone.utc)
        self.db.collection("factory_step_queue").document(queue_id).update(
            {
                "state": "running",
                "lease_owner": worker_id,
                "lease_expires_at": datetime.fromtimestamp(
                    now.timestamp() + max(1, int(lease_seconds)),
                    tz=timezone.utc,
                ),
                "error_code": None,
                "error_message": None,
                "step_started_at": started_at or now,
                "last_step_heartbeat_at": started_at or now,
                "step_deadline_at": deadline_at,
                "heartbeat_interval_sec": heartbeat_interval_sec,
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            }
        )

    def heartbeat_running(
        self,
        queue_id: str,
        worker_id: str,
        *,
        lease_seconds: int,
        deadline_at: datetime,
        heartbeat_interval_sec: int | None = None,
        progress_detail: str | None = None,
    ) -> None:
        """Refresh lease and heartbeat while the worker is still alive.

        Each heartbeat pushes ``lease_expires_at`` forward, preventing
        the recovery routine from reclaiming in-progress work.
        """
        now = datetime.now(timezone.utc)
        payload: dict[str, Any] = {
            "state": "running",
            "lease_owner": worker_id,
            "lease_expires_at": datetime.fromtimestamp(
                now.timestamp() + max(1, int(lease_seconds)),
                tz=timezone.utc,
            ),
            "last_step_heartbeat_at": now,
            "step_deadline_at": deadline_at,
            "updated_at": fs.SERVER_TIMESTAMP,
        }
        if heartbeat_interval_sec is not None:
            payload["heartbeat_interval_sec"] = heartbeat_interval_sec
        if progress_detail:
            payload["progress_detail"] = progress_detail
        self.db.collection("factory_step_queue").document(queue_id).update(payload)

    def mark_done(self, queue_id: str) -> None:
        """Terminal success -- clears all lease/heartbeat metadata."""
        self.db.collection("factory_step_queue").document(queue_id).update(
            {
                "state": "succeeded",
                "lease_owner": None,
                "lease_expires_at": None,
                "last_step_heartbeat_at": None,
                "step_started_at": None,
                "step_deadline_at": None,
                "heartbeat_interval_sec": None,
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            }
        )

    def mark_failed(self, queue_id: str, error_code: str, error_message: str) -> None:
        """Terminal failure -- records the error and releases the lease."""
        self.db.collection("factory_step_queue").document(queue_id).update(
            {
                "state": "failed",
                "error_code": error_code,
                "error_message": error_message,
                "lease_owner": None,
                "lease_expires_at": None,
                "last_step_heartbeat_at": None,
                "step_started_at": None,
                "step_deadline_at": None,
                "heartbeat_interval_sec": None,
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            }
        )

    def schedule_retry(
        self,
        queue_id: str,
        error_code: str,
        error_message: str,
        delay_seconds: int,
    ) -> None:
        """Return the item to ``ready`` with a future ``available_at``.

        The ``fs.Increment(1)`` sentinel atomically bumps ``retry_count``
        on the server, avoiding read-modify-write races when multiple
        retries overlap.
        """
        available_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + max(1, delay_seconds),
            tz=timezone.utc,
        )
        self.db.collection("factory_step_queue").document(queue_id).update(
            {
                "state": "ready",
                "error_code": error_code,
                "error_message": error_message,
                "retry_count": fs.Increment(1),
                "available_at": available_at,
                "lease_owner": None,
                "lease_expires_at": None,
                "last_step_heartbeat_at": None,
                "step_started_at": None,
                "step_deadline_at": None,
                "heartbeat_interval_sec": None,
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            }
        )

    def schedule_continuation(
        self,
        queue_id: str,
        delay_seconds: int,
    ) -> None:
        """Re-enqueue for a non-error continuation (e.g. polling for an
        async result).  Unlike ``schedule_retry`` this does *not*
        increment ``retry_count`` and clears error fields.
        """
        available_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + max(1, delay_seconds),
            tz=timezone.utc,
        )
        self.db.collection("factory_step_queue").document(queue_id).update(
            {
                "state": "ready",
                "error_code": None,
                "error_message": None,
                "available_at": available_at,
                "lease_owner": None,
                "lease_expires_at": None,
                "last_step_heartbeat_at": None,
                "step_started_at": None,
                "step_deadline_at": None,
                "heartbeat_interval_sec": None,
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            }
        )

    def cancel_ready_for_run(
        self,
        run_id: str,
        step_name: str | None = None,
        error_code: str = "run_failed",
        error_message: str = "Run failed; pending work cancelled.",
    ) -> int:
        """Cancel queued work for a run that should no longer continue.

        Only ``ready`` / ``leased`` items are cancelled; ``running``
        items are left alone because their executors check run-state
        guards and will self-terminate.

        Each cancellation runs inside its own transaction so that a
        concurrent claim does not conflict -- either the claim wins
        (and the item is no longer ``ready``) or the cancel wins.

        Returns:
            Number of items successfully cancelled.
        """
        query = self.db.collection("factory_step_queue").where("run_id", "==", run_id)
        if step_name:
            query = query.where("step_name", "==", step_name)
        docs = list(query.stream())

        cancelled = 0
        for doc in docs:
            tx = self.db.transaction()

            @fs.transactional
            def _cancel(transaction):
                # Re-read inside the transaction for consistency.
                snap = doc.reference.get(transaction=transaction)
                if not snap.exists:
                    return False
                data = snap.to_dict() or {}
                state = str(data.get("state") or "")
                # Only cancel items that haven't started executing yet.
                if state not in {"ready", "leased"}:
                    return False
                if str(data.get("run_id") or "") != run_id:
                    return False
                if step_name and str(data.get("step_name") or "") != step_name:
                    return False

                transaction.update(
                    doc.reference,
                    {
                        "state": "failed",
                        "error_code": error_code,
                        "error_message": error_message,
                        "lease_owner": None,
                        "lease_expires_at": None,
                        "updated_at": fs.SERVER_TIMESTAMP,
                    },
                )
                return True

            if _cancel(tx):
                cancelled += 1

        return cancelled
