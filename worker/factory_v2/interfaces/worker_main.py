"""Top-level worker loop for the Content Factory V2 runtime.

Architectural Role:
    This is the **primary driving adapter** in the hexagonal architecture.
    It owns the process's main thread and orchestrates every recurring
    concern -- heartbeats, deletes, recovery sweeps, job dispatch, and
    step execution -- inside a single sequential poll loop.

Design Patterns:
    * **Event Loop / Poll Pattern** -- Instead of blocking on push-based
      triggers (e.g. Pub/Sub), the worker polls Firestore on a fixed
      cadence.  This keeps infrastructure simple and lets each tick
      prioritise work deterministically (deletes > recovery > dispatch >
      step execution).
    * **Composition Root** -- ``WorkerMain.__init__`` wires all
      repositories, the orchestrator, the claim loop, and the recovery
      manager, then hands them pre-built collaborators.  No service
      locator or DI container is needed.

Key Dependencies:
    * ``ClaimLoop``   -- executes one queue item per tick.
    * ``RecoveryManager`` -- periodic self-healing for stuck steps.
    * ``dispatch_next_content_job`` -- bridges legacy ``content_jobs``
      into the V2 pipeline.
    * ``update_worker_status`` -- publishes a heartbeat document so the
      admin UI and recovery logic can tell this worker is alive.

Consumed By:
    * The stack launcher (``companion/stack_runner.py``) spawns one
      ``WorkerMain`` per process.
    * The admin dashboard reads the heartbeat document written each tick.
"""

from __future__ import annotations

import time

from firebase_admin import firestore
from firebase_admin import firestore as fs

import config
from observability import get_logger
from factory_v2.shared.delete_job import mark_delete_failed, process_delete_job
from factory_v2.shared.worker_status import update_worker_status

from .claim_loop import ClaimLoop
from .dispatcher import dispatch_next_content_job
from .recovery_manager import RecoveryManager
from ..application.orchestrator import Orchestrator
from ..infrastructure.firestore_repos import (
    FirestoreEventRepo,
    FirestoreJobRepo,
    FirestoreRunRepo,
    FirestoreStepRunRepo,
)
from ..infrastructure.queue_repo import FirestoreQueueRepo

logger = get_logger(__name__)


class WorkerMain:
    """Coordinates dispatch, step execution, deletes, and periodic recovery.

    This is the outermost class a worker process instantiates.  It owns:

    * The **poll loop** (``run_forever``) that cycles once per ``poll_seconds``.
    * **Priority ordering** within each tick -- delete requests are handled
      first so storage cleanup is never starved by long-running pipelines.
    * **Composition wiring** -- all repos, the orchestrator, claim loop,
      and recovery manager are assembled here and injected downward.

    Args:
        db: Firestore client instance shared across all repos.
        worker_id: Unique identifier for this worker process.
        poll_seconds: Seconds between ticks when the queue is empty.
        enable_dispatch: Whether this worker converts legacy jobs to V2.
        can_dispatch: Explicit override for dispatch capability.
        accept_non_tts_steps: Whether this stack runs non-TTS steps.
        supported_tts_models: Set of TTS model names this stack can run.
        extra_capability_keys: Additional capability keys beyond defaults.
        max_step_retries: Maximum retries before a step is marked failed.
        claim_candidate_limit: Max queue docs fetched when choosing work.
        tts_per_job_soft_limit: Soft cap on concurrent TTS steps per job.
        worker_type: Deployment flavour (``"local"`` or ``"cloud"``).
        stack_id: Logical stack this process belongs to.
        process_id: OS-level PID for admin visibility.
        capability_keys: Pre-computed capability key list for status docs.
    """

    def __init__(
        self,
        db,
        worker_id: str,
        poll_seconds: float = 1.0,
        enable_dispatch: bool = True,
        can_dispatch: bool | None = None,
        accept_non_tts_steps: bool = True,
        supported_tts_models: set[str] | None = None,
        extra_capability_keys: set[str] | None = None,
        max_step_retries: int = 2,
        claim_candidate_limit: int = 200,
        tts_per_job_soft_limit: int = 2,
        worker_type: str = "local",
        stack_id: str | None = None,
        process_id: int | None = None,
        capability_keys: list[str] | None = None,
    ):
        self.db = db
        self.worker_id = worker_id
        self.poll_seconds = poll_seconds
        self.enable_dispatch = enable_dispatch
        # If no explicit flag is given, fall back to the older enable_dispatch param.
        self.can_dispatch = bool(enable_dispatch if can_dispatch is None else can_dispatch)
        self.worker_type = worker_type
        self.stack_id = stack_id or worker_id
        self.process_id = process_id
        self.capability_keys = list(capability_keys or [])

        # --- Repository layer (infrastructure adapters) ---
        self.job_repo = FirestoreJobRepo(db)
        self.run_repo = FirestoreRunRepo(db)
        self.step_run_repo = FirestoreStepRunRepo(db)
        self.queue_repo = FirestoreQueueRepo(db)
        self.event_repo = FirestoreEventRepo(db)
        # --- Application-layer orchestrator (the "hexagon") ---
        self.orchestrator = Orchestrator(
            self.job_repo,
            self.run_repo,
            self.step_run_repo,
            self.queue_repo,
        )

        # --- Driving adapters assembled with their dependencies ---
        self.claim_loop = ClaimLoop(
            db=db,
            worker_id=worker_id,
            job_repo=self.job_repo,
            run_repo=self.run_repo,
            step_run_repo=self.step_run_repo,
            queue_repo=self.queue_repo,
            event_repo=self.event_repo,
            orchestrator=self.orchestrator,
            accept_non_tts_steps=accept_non_tts_steps,
            supported_tts_models=supported_tts_models,
            extra_capability_keys=extra_capability_keys,
            max_step_retries=max_step_retries,
            claim_candidate_limit=claim_candidate_limit,
            tts_per_job_soft_limit=tts_per_job_soft_limit,
            worker_type=self.worker_type,
            poll_interval_sec=self.poll_seconds,
            stack_id=self.stack_id,
            process_id=self.process_id,
            capability_keys=self.capability_keys,
        )
        self.recovery_manager = RecoveryManager(
            db=db,
            job_repo=self.job_repo,
            step_run_repo=self.step_run_repo,
            queue_repo=self.queue_repo,
            run_repo=self.run_repo,
            event_repo=self.event_repo,
            orchestrator=self.orchestrator,
        )
        # Tracks wall-clock time of the last recovery sweep so we only run
        # expensive cross-collection scans every ~15 seconds.
        self._last_recovery_at = 0.0

    # ------------------------------------------------------------------
    # Delete handling -- priority lane so storage cleanup is never starved
    # ------------------------------------------------------------------

    def _claim_delete_job(self, doc_ref) -> dict | None:
        """Atomically claim a delete-requested job via Firestore transaction.

        The transaction guarantees that only one worker processes the
        delete even when multiple workers poll the same document.

        Returns:
            The job data dict if successfully claimed, ``None`` otherwise.
        """
        transaction = self.db.transaction()

        @firestore.transactional
        def _tx_claim(tx):
            snapshot = doc_ref.get(transaction=tx)
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            # Guard: only claim jobs explicitly flagged for deletion.
            if not data.get("deleteRequested"):
                return None
            # Guard: another worker already owns this delete.
            if data.get("deleteInProgress"):
                return None

            # Set the lock so concurrent workers skip this doc.
            tx.update(
                doc_ref,
                {
                    "deleteInProgress": True,
                    "updatedAt": fs.SERVER_TIMESTAMP,
                },
            )
            return data

        return _tx_claim(transaction)

    def _next_delete_job(self) -> tuple[str, dict] | None:
        """Find and claim the next job marked for deletion.

        Scans up to 10 candidates and attempts a transactional claim on
        each until one succeeds.  Returns ``(job_id, job_data)`` or ``None``.
        """
        query = self.db.collection(config.JOBS_COLLECTION).where("deleteRequested", "==", True).limit(10)
        for doc in query.stream():
            claimed = self._claim_delete_job(doc.reference)
            if claimed is not None:
                return doc.id, claimed
        return None

    def _cleanup_factory_records(self, job_id: str) -> None:
        """Remove V2 bookkeeping documents after a delete job succeeds.

        This cascading delete removes the factory_job plus all related
        runs, step runs, queue entries, and events so no orphaned docs
        remain in Firestore after the content is gone.
        """
        self.db.collection("factory_jobs").document(job_id).delete()
        for collection_name in ("factory_job_runs", "factory_step_runs", "factory_step_queue", "factory_events"):
            query = self.db.collection(collection_name).where("job_id", "==", job_id).limit(500)
            for snapshot in query.stream():
                snapshot.reference.delete()

    def _handle_delete_requests(self) -> bool:
        """Give delete jobs priority so storage/doc cleanup is not starved by queue work."""
        delete_job = self._next_delete_job()
        if not delete_job:
            return False

        job_id, job_data = delete_job
        logger.info("V2 deleting job", extra={"job_id": job_id, "worker_id": self.worker_id})
        try:
            process_delete_job(self.db, job_id, job_data)
            self._cleanup_factory_records(job_id)
        except Exception as exc:
            mark_delete_failed(self.db, job_id, f"{type(exc).__name__}: {exc}")
        return True

    # ------------------------------------------------------------------
    # Recovery -- periodic self-healing for stuck/stale pipeline state
    # ------------------------------------------------------------------

    def _run_recovery_tick(self) -> None:
        """Run one recovery sweep and log only the counters that changed."""
        recovered = self.recovery_manager.recover_worker_tick()
        if recovered.get("stale_leases"):
            logger.info(
                "V2 queue stale leases recovered",
                extra={"worker_id": self.worker_id, "recovered": recovered["stale_leases"]},
            )
        if recovered.get("stuck_detected"):
            logger.info(
                "V2 detected stuck steps",
                extra={"worker_id": self.worker_id, "recovered": recovered["stuck_detected"]},
            )
        if recovered.get("watchdog_retries"):
            logger.info(
                "V2 scheduled watchdog retries",
                extra={"worker_id": self.worker_id, "recovered": recovered["watchdog_retries"]},
            )
        if recovered.get("watchdog_failures"):
            logger.info(
                "V2 failed stuck steps after retry budget",
                extra={"worker_id": self.worker_id, "recovered": recovered["watchdog_failures"]},
            )
        if recovered.get("worker_recycles"):
            logger.info(
                "V2 recycled stuck workers",
                extra={"worker_id": self.worker_id, "recovered": recovered["worker_recycles"]},
            )
        if recovered.get("fan_in"):
            logger.info(
                "V2 recovered stuck course audio fan-in steps",
                extra={"worker_id": self.worker_id, "recovered": recovered["fan_in"]},
            )
        if recovered.get("upload"):
            logger.info(
                "V2 recovered stuck course upload steps",
                extra={"worker_id": self.worker_id, "recovered": recovered["upload"]},
            )
        if recovered.get("publish"):
            logger.info(
                "V2 recovered stuck course publish steps",
                extra={"worker_id": self.worker_id, "recovered": recovered["publish"]},
            )
        if recovered.get("admin_cancelled"):
            logger.info(
                "V2 reconciled admin-cancelled runs",
                extra={"worker_id": self.worker_id, "recovered": recovered["admin_cancelled"]},
            )

    # ------------------------------------------------------------------
    # Main event loop -- the heart of every worker process
    # ------------------------------------------------------------------

    def run_forever(self) -> None:
        """Main worker loop -- runs until the process is killed.

        Each iteration follows a strict priority order:

        1. **Heartbeat** -- publish worker liveness so the admin UI and
           recovery logic know this process is healthy.
        2. **Deletes** -- give delete jobs the highest work priority so
           storage/doc cleanup is never starved by queue work.  If a
           delete is found the tick restarts (``continue``).
        3. **Recovery** -- every ~15 s, sweep for stale leases, stuck
           steps, and incomplete course fan-in transitions.
        4. **Dispatch** -- convert one legacy ``content_jobs`` doc into a
           V2 run if this worker has dispatch capability.
        5. **Claim & execute** -- pick one queue item and run it.  If no
           work is found, sleep for ``poll_seconds`` before the next tick.

        The pattern is intentionally synchronous.  Running one step at a
        time per process keeps resource usage predictable and avoids the
        concurrency hazards of async Firestore transactions.
        """
        while True:
            # ---- 1. Heartbeat ----
            try:
                update_worker_status(
                    self.db,
                    self.worker_id,
                    self.worker_type,
                    poll_interval_sec=self.poll_seconds,
                    stack_id=self.stack_id,
                    pid=self.process_id,
                    capability_keys=self.capability_keys,
                    clear_current_step=True,
                )
            except Exception as heartbeat_exc:
                logger.warning(
                    "V2 heartbeat failed",
                    extra={"worker_id": self.worker_id, "error": str(heartbeat_exc)},
                )

            # ---- 2. Deletes (highest work priority) ----
            if self._handle_delete_requests():
                continue

            # ---- 3. Recovery (throttled to once every ~15 s) ----
            now = time.time()
            if now - self._last_recovery_at >= 15:
                self._last_recovery_at = now
                try:
                    self._run_recovery_tick()
                except Exception as recovery_exc:
                    logger.warning(
                        "V2 recovery tick failed",
                        extra={"worker_id": self.worker_id, "error": str(recovery_exc)},
                    )

            # ---- 4. Dispatch (bridge legacy jobs into V2) ----
            if self.can_dispatch:
                try:
                    dispatched = dispatch_next_content_job(self.db, self.worker_id)
                    if dispatched:
                        content_job_id, run_id = dispatched
                        logger.info(
                            "V2 job dispatched",
                            extra={
                                "content_job_id": content_job_id,
                                "run_id": run_id,
                                "worker_id": self.worker_id,
                            },
                        )
                except Exception as dispatch_exc:
                    logger.exception(
                        "V2 dispatcher error",
                        extra={"worker_id": self.worker_id, "error": str(dispatch_exc)},
                    )

            # ---- 5. Claim & execute one queue item ----
            processed = self.claim_loop.run_once()
            if not processed:
                # Nothing to do -- back off before the next poll to avoid
                # hammering Firestore with empty reads.
                time.sleep(self.poll_seconds)
