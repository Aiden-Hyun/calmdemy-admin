"""Firestore-backed repositories for factory jobs, runs, steps, and events.

Architectural Role
------------------
Infrastructure Layer -- "driven" (right-hand) side of hexagonal architecture.
These classes are the *only* code that knows about Firestore collection names
and document schemas. Domain / application code depends on abstract
behaviour, never on ``google.cloud.firestore`` directly.

Design Patterns
---------------
* **Repository** -- each class owns one Firestore collection and exposes
  intent-revealing methods (``mark_running``, ``emit``, ...) instead of
  raw CRUD.  This keeps persistence details out of the domain layer.
* **Transactional guard** -- ``patch_compat_content_job_for_run`` uses a
  Firestore transaction to implement optimistic concurrency: a patch is
  only applied when the run that requested it is still the active run.

Key Dependencies
----------------
* ``firebase_admin.firestore`` -- Firestore SDK (server timestamps,
  transactions, ``AlreadyExists`` sentinel).

Consumed By
-----------
* ``factory_v2.application`` orchestrators that coordinate job / run /
  step lifecycle transitions.
* Recovery & watchdog routines that query step-run state.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from google.api_core.exceptions import AlreadyExists
from firebase_admin import firestore as fs


# ---------------------------------------------------------------------------
# Job Repository
# ---------------------------------------------------------------------------

class FirestoreJobRepo:
    """Repository for the ``factory_jobs`` collection.

    A *Job* is the top-level unit of work (e.g. "generate a meditation
    session").  This repo tracks the job's current lifecycle state and
    provides compatibility patches for the legacy ``content_jobs``
    collection that the admin front-end still reads.

    State machine (simplified)::

        created -> running -> completed
                          \\-> failed -> retry_requested
                          \\-> cancelled
    """

    def __init__(self, db):
        self.db = db

    def get(self, job_id: str) -> dict:
        """Fetch a single job document by ID, raising ``KeyError`` if absent."""
        snap = self.db.collection("factory_jobs").document(job_id).get()
        if not snap.exists:
            raise KeyError(f"Job not found: {job_id}")
        # Merge the Firestore doc ID into the returned dict so callers
        # always have it available without a second round-trip.
        return {"id": snap.id, **(snap.to_dict() or {})}

    def mark_running(self, job_id: str, run_id: str | None) -> None:
        """Transition the job to ``running`` and record which run owns it.

        Uses ``set(..., merge=True)`` so that fields not listed here are
        preserved -- this is the Firestore equivalent of a partial update.
        ``fs.SERVER_TIMESTAMP`` lets the server clock set the timestamp,
        avoiding client-clock skew across distributed workers.
        """
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "current_state": "running",
                "current_run_id": run_id,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_completed(self, job_id: str, run_id: str) -> None:
        """Transition to ``completed`` and snapshot run info into ``summary``.

        The ``summary`` sub-document is a denormalized view consumed by the
        admin dashboard so it can display status without joining to the
        runs collection.
        """
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "current_state": "completed",
                "current_run_id": run_id,
                "updated_at": fs.SERVER_TIMESTAMP,
                "summary": {
                    "lastRunStatus": "completed",
                    "lastRunId": run_id,
                },
            },
            merge=True,
        )

    def mark_failed(
        self,
        job_id: str,
        run_id: str,
        failed_step: str,
        error_code: str,
    ) -> None:
        """Transition to ``failed``, recording which step and error caused it."""
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "current_state": "failed",
                "current_run_id": run_id,
                "updated_at": fs.SERVER_TIMESTAMP,
                "summary": {
                    "lastRunStatus": "failed",
                    "lastRunId": run_id,
                    "failedStep": failed_step,
                    "errorCode": error_code,
                },
            },
            merge=True,
        )

    def mark_retry_requested(self, job_id: str) -> None:
        """Flag the job so the next poll loop picks it up for a fresh run."""
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "retry_requested": True,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_cancelled(self, job_id: str) -> None:
        """Terminal state -- the job will not be retried or resumed."""
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "current_state": "cancelled",
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def patch_runtime(self, job_id: str, patch: dict) -> None:
        """Patch only the runtime subdocument so step executors can update incrementally."""
        if not patch:
            return
        payload = {"updated_at": fs.SERVER_TIMESTAMP}
        # Firestore dot-notation (e.g. "runtime.voice_id") lets us update
        # nested map fields without overwriting sibling keys.
        for key, value in patch.items():
            payload[f"runtime.{key}"] = value
        self.db.collection("factory_jobs").document(job_id).update(payload)

    def patch_summary(self, job_id: str, patch: dict) -> None:
        """Patch only the summary subdocument used by admin views and quick status cards."""
        if not patch:
            return
        payload = {"updated_at": fs.SERVER_TIMESTAMP}
        # Same dot-notation trick as patch_runtime -- only touches the
        # keys inside ``summary.*`` without clobbering others.
        for key, value in patch.items():
            payload[f"summary.{key}"] = value
        self.db.collection("factory_jobs").document(job_id).update(payload)

    def patch_compat_content_job(self, content_job_id: str, patch: dict) -> None:
        """Write to the legacy ``content_jobs`` collection for backward compat.

        The admin UI still reads ``content_jobs`` for some views. This
        bridge method keeps both collections in sync until the migration
        is complete.  Note the camelCase ``updatedAt`` -- it matches the
        legacy schema, not the snake_case convention in ``factory_jobs``.
        """
        if not content_job_id or not patch:
            return
        payload = dict(patch)
        payload["updatedAt"] = fs.SERVER_TIMESTAMP
        self.db.collection("content_jobs").document(content_job_id).set(payload, merge=True)

    def patch_compat_content_job_for_run(
        self,
        content_job_id: str,
        run_id: str,
        patch: dict,
    ) -> bool:
        """Patch ``content_jobs`` only when *this* run is still active.

        Returns ``True`` when the patch was applied, ``False`` when
        skipped because a newer run has already superseded this one.

        This is an **optimistic-concurrency guard**: inside a Firestore
        transaction we read the current ``v2RunId`` and only write if it
        still matches the caller's ``run_id``.  If another worker has
        started a newer run in the meantime, the write is silently
        skipped, preventing stale data from overwriting fresh data.
        """
        if not content_job_id or not patch:
            return False

        transaction = self.db.transaction()
        doc_ref = self.db.collection("content_jobs").document(content_job_id)
        payload = dict(patch)
        payload["updatedAt"] = fs.SERVER_TIMESTAMP

        @fs.transactional
        def _tx_apply(tx) -> bool:
            # Read-before-write inside the transaction -- Firestore will
            # abort and retry if the document changes between read and commit.
            snap = doc_ref.get(transaction=tx)
            if not snap.exists:
                return False
            data = snap.to_dict() or {}
            active_run_id = str(data.get("v2RunId") or "").strip()
            # If another run has taken ownership, bail out.
            if active_run_id and active_run_id != run_id:
                return False
            tx.set(doc_ref, payload, merge=True)
            return True

        return bool(_tx_apply(transaction))


# ---------------------------------------------------------------------------
# Run Repository
# ---------------------------------------------------------------------------

class FirestoreRunRepo:
    """Repository for the ``factory_job_runs`` collection.

    A *Run* is one execution attempt of a Job.  Jobs can be retried, so
    there may be multiple runs per job, each identified by a monotonically
    increasing ``run_number``.

    State machine::

        running -> completed
               \\-> failed
    """

    def __init__(self, db):
        self.db = db

    def next_run_number(self, job_id: str) -> int:
        """Return the next sequential run number for a job.

        Queries the highest existing ``run_number`` and increments by one.
        The ``limit(1)`` + descending sort makes this O(1) in Firestore
        reads regardless of how many past runs exist.
        """
        query = (
            self.db.collection("factory_job_runs")
            .where("job_id", "==", job_id)
            .order_by("run_number", direction=fs.Query.DESCENDING)
            .limit(1)
        )
        docs = list(query.stream())
        if not docs:
            return 1
        return int((docs[0].to_dict() or {}).get("run_number", 0)) + 1

    def create(
        self,
        run_id: str,
        job_id: str,
        run_number: int,
        trigger: str,
        started_at: datetime,
    ) -> None:
        """Insert a new run document in the ``running`` state.

        Args:
            run_id: Globally unique ID for this run.
            job_id: Parent job this run belongs to.
            run_number: Monotonic attempt counter (1-based).
            trigger: What initiated the run (e.g. ``"api"``, ``"retry"``).
            started_at: Caller-supplied start time (usually ``utcnow``).
        """
        self.db.collection("factory_job_runs").document(run_id).set(
            {
                "job_id": job_id,
                "run_number": run_number,
                "state": "running",
                "trigger": trigger,
                "started_at": started_at,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_completed(self, run_id: str) -> None:
        """Transition run to ``completed`` and stamp ``ended_at``."""
        self.db.collection("factory_job_runs").document(run_id).set(
            {
                "state": "completed",
                "ended_at": fs.SERVER_TIMESTAMP,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_failed(self, run_id: str, failed_step: str, error_code: str) -> None:
        """Transition run to ``failed``, capturing which step blew up."""
        self.db.collection("factory_job_runs").document(run_id).set(
            {
                "state": "failed",
                "failed_step": failed_step,
                "error_code": error_code,
                "ended_at": fs.SERVER_TIMESTAMP,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def run_state(self, run_id: str) -> str | None:
        """Return the current state string, or ``None`` if the run doc is missing."""
        snap = self.db.collection("factory_job_runs").document(run_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        state = str(data.get("state") or "").strip()
        return state or None


# ---------------------------------------------------------------------------
# Step-Run Repository
# ---------------------------------------------------------------------------

class FirestoreStepRunRepo:
    """Repository for the ``factory_step_runs`` collection.

    A *StepRun* is one execution of a single pipeline step within a Run.
    Steps can be **sharded** (e.g. one shard per audio chapter), so the
    composite key is ``(run_id, step_name, shard_key)``.

    The ``watchdog_state`` field mirrors ``state`` but is consumed by the
    heartbeat / deadline watchdog to detect stuck workers.

    State machine::

        ready -> running -> succeeded
                        \\-> failed
                        \\-> retry_scheduled -> (re-enqueued as ready)
                        \\-> waiting         -> (re-enqueued as ready)
    """

    def __init__(self, db):
        self.db = db

    @staticmethod
    def make_step_run_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
        """Build a deterministic document ID from the composite key.

        The double-underscore delimiter keeps IDs human-readable in the
        Firestore console and guarantees uniqueness per run/step/shard.
        """
        return f"{run_id}__{step_name}__{shard_key}"

    def ensure_ready(self, job_id: str, run_id: str, step_name: str, shard_key: str = "root") -> str:
        """Idempotently create a ``ready`` step-run document.

        Uses ``doc_ref.create()`` which raises ``AlreadyExists`` if the
        document already exists -- we catch and ignore that so callers
        can safely re-enqueue the same step without error.  This is the
        *create-if-absent* idiom common in distributed queues.
        """
        step_run_id = self.make_step_run_id(run_id, step_name, shard_key)
        doc_ref = self.db.collection("factory_step_runs").document(step_run_id)
        payload = {
            "job_id": job_id,
            "run_id": run_id,
            "step_name": step_name,
            "shard_key": shard_key,
            "state": "ready",
            "attempt": 1,
            "created_at": fs.SERVER_TIMESTAMP,
            "updated_at": fs.SERVER_TIMESTAMP,
        }
        try:
            doc_ref.create(payload)
        except AlreadyExists:
            # Already exists -- another code path or retry already created it.
            pass
        return step_run_id

    def has_succeeded(self, job_id: str, run_id: str, step_name: str) -> bool:
        """Check whether *any* shard of this step has already succeeded.

        ``limit(1)`` keeps this cheap -- we only need existence, not a count.
        """
        query = (
            self.db.collection("factory_step_runs")
            .where("job_id", "==", job_id)
            .where("run_id", "==", run_id)
            .where("step_name", "==", step_name)
            .where("state", "==", "succeeded")
            .limit(1)
        )
        return any(query.stream())

    def _shard_keys_by_state(
        self,
        job_id: str,
        run_id: str,
        step_name: str,
        state: str,
    ) -> set[str]:
        """Return the set of shard keys whose step-runs are in ``state``.

        Used by the orchestrator to decide which shards still need work
        (e.g. skip shards that already succeeded from a prior attempt).
        """
        query = (
            self.db.collection("factory_step_runs")
            .where("job_id", "==", job_id)
            .where("run_id", "==", run_id)
            .where("step_name", "==", step_name)
            .where("state", "==", state)
        )
        shard_keys: set[str] = set()
        for doc in query.stream():
            data = doc.to_dict() or {}
            shard_key = str(data.get("shard_key") or "root").strip()
            if shard_key:
                shard_keys.add(shard_key)
        return shard_keys

    def succeeded_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set[str]:
        """Convenience: which shards already finished successfully."""
        return self._shard_keys_by_state(job_id, run_id, step_name, "succeeded")

    def failed_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set[str]:
        """Convenience: which shards ended in failure."""
        return self._shard_keys_by_state(job_id, run_id, step_name, "failed")

    def state(self, run_id: str, step_name: str, shard_key: str = "root") -> str | None:
        """Read the current state of a single step-run shard."""
        snap = self.db.collection("factory_step_runs").document(
            self.make_step_run_id(run_id, step_name, shard_key)
        ).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        state = str(data.get("state") or "").strip()
        return state or None

    def mark_running(
        self,
        step_run_id: str,
        queue_id: str,
        worker_id: str,
        attempt: int = 1,
        *,
        started_at: datetime | None = None,
        deadline_at: datetime | None = None,
    ) -> None:
        """Transition to ``running`` and initialize heartbeat / watchdog fields.

        Clears any leftover error or retry metadata from a previous
        attempt so the document always reflects the *current* execution.
        """
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "running",
                "queue_id": queue_id,
                "worker_id": worker_id,
                "attempt": attempt,
                # Clear previous-attempt error fields.
                "error_code": None,
                "error_message": None,
                "next_attempt": None,
                "retry_delay_seconds": None,
                "ended_at": None,
                "started_at": started_at or fs.SERVER_TIMESTAMP,
                "last_heartbeat_at": started_at or fs.SERVER_TIMESTAMP,
                "deadline_at": deadline_at,
                "watchdog_state": "running",
                "progress_detail": None,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def heartbeat(
        self,
        step_run_id: str,
        worker_id: str,
        *,
        deadline_at: datetime,
        progress_detail: str | None = None,
    ) -> None:
        """Refresh heartbeat timestamp so the watchdog knows we are alive.

        Workers call this periodically during long-running steps (e.g.
        TTS synthesis).  If the watchdog sees ``last_heartbeat_at`` is
        too old it will mark the step as stuck and release the queue
        entry for another worker.
        """
        payload: dict[str, Any] = {
            "worker_id": worker_id,
            "last_heartbeat_at": fs.SERVER_TIMESTAMP,
            "deadline_at": deadline_at,
            "watchdog_state": "running",
            "updated_at": fs.SERVER_TIMESTAMP,
        }
        if progress_detail:
            payload["progress_detail"] = progress_detail
        self.db.collection("factory_step_runs").document(step_run_id).set(payload, merge=True)

    def mark_succeeded(self, step_run_id: str, output: dict) -> None:
        """Record success along with the step's output artifact dict."""
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "succeeded",
                "output": output,
                "watchdog_state": "succeeded",
                "ended_at": fs.SERVER_TIMESTAMP,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_succeeded_from_checkpoint(
        self,
        step_run_id: str,
        output: dict,
    ) -> None:
        """
        Mark a step run as succeeded without execution on this run.

        Used when a shard is reused from an existing checkpoint result.
        """
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "succeeded",
                "output": output,
                "worker_id": "checkpoint",
                "attempt": 1,
                "started_at": fs.SERVER_TIMESTAMP,
                "last_heartbeat_at": fs.SERVER_TIMESTAMP,
                "watchdog_state": "succeeded",
                "ended_at": fs.SERVER_TIMESTAMP,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_failed(self, step_run_id: str, error_code: str, error_message: str) -> None:
        """Terminal failure -- no automatic retry will follow."""
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "failed",
                "error_code": error_code,
                "error_message": error_message,
                "watchdog_state": "failed",
                "ended_at": fs.SERVER_TIMESTAMP,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_retry_scheduled(
        self,
        step_run_id: str,
        error_code: str,
        error_message: str,
        next_attempt: int,
        delay_seconds: int,
    ) -> None:
        """Record that a retry will happen after ``delay_seconds``.

        The queue repo separately re-enqueues the work with an
        ``available_at`` in the future; this doc just tracks the intent.
        """
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "retry_scheduled",
                "error_code": error_code,
                "error_message": error_message,
                "next_attempt": next_attempt,
                "retry_delay_seconds": delay_seconds,
                "watchdog_state": "retry_scheduled",
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_waiting(
        self,
        step_run_id: str,
        delay_seconds: int,
    ) -> None:
        """Park the step in ``waiting`` for a non-error delay (e.g. polling)."""
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "waiting",
                "error_code": None,
                "error_message": None,
                "retry_delay_seconds": delay_seconds,
                "watchdog_state": "waiting",
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )


# ---------------------------------------------------------------------------
# Event Repository
# ---------------------------------------------------------------------------

class FirestoreEventRepo:
    """Append-only event log in the ``factory_events`` collection.

    Events are immutable audit records (think *event sourcing lite*).
    They are never updated or deleted, which makes this collection safe
    for debugging, analytics, and disaster recovery.
    """

    def __init__(self, db):
        self.db = db

    def emit(self, event_type: str, job_id: str, run_id: str, payload: dict) -> str:
        """Append one event and return the auto-generated document ID."""
        # ``document()`` with no argument lets Firestore generate a
        # unique ID, which is the correct choice for an append-only log.
        ref = self.db.collection("factory_events").document()
        ref.set(
            {
                "event_type": event_type,
                "job_id": job_id,
                "run_id": run_id,
                "payload": payload,
                "created_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        return ref.id
