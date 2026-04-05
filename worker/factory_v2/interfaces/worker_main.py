"""Top-level worker loop for the Content Factory V2 runtime."""

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
    """Coordinates dispatch, step execution, deletes, and periodic recovery."""

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
        self.can_dispatch = bool(enable_dispatch if can_dispatch is None else can_dispatch)
        self.worker_type = worker_type
        self.stack_id = stack_id or worker_id
        self.process_id = process_id
        self.capability_keys = list(capability_keys or [])

        self.job_repo = FirestoreJobRepo(db)
        self.run_repo = FirestoreRunRepo(db)
        self.step_run_repo = FirestoreStepRunRepo(db)
        self.queue_repo = FirestoreQueueRepo(db)
        self.event_repo = FirestoreEventRepo(db)
        self.orchestrator = Orchestrator(
            self.job_repo,
            self.run_repo,
            self.step_run_repo,
            self.queue_repo,
        )
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
        self._last_recovery_at = 0.0

    def _claim_delete_job(self, doc_ref) -> dict | None:
        transaction = self.db.transaction()

        @firestore.transactional
        def _tx_claim(tx):
            snapshot = doc_ref.get(transaction=tx)
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            if not data.get("deleteRequested"):
                return None
            if data.get("deleteInProgress"):
                return None

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
        query = self.db.collection(config.JOBS_COLLECTION).where("deleteRequested", "==", True).limit(10)
        for doc in query.stream():
            claimed = self._claim_delete_job(doc.reference)
            if claimed is not None:
                return doc.id, claimed
        return None

    def _cleanup_factory_records(self, job_id: str) -> None:
        """Remove V2 bookkeeping documents after a delete job succeeds."""
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

    def run_forever(self) -> None:
        """Main worker loop.

        The order matters:
        1. publish worker heartbeat
        2. handle delete requests
        3. run periodic recovery
        4. optionally dispatch new legacy jobs into V2
        5. claim and execute one queue item
        """
        while True:
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

            if self._handle_delete_requests():
                continue

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

            processed = self.claim_loop.run_once()
            if not processed:
                time.sleep(self.poll_seconds)
