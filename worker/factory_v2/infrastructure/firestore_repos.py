"""Firestore-backed repositories for factory jobs, runs, steps, and events."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from google.api_core.exceptions import AlreadyExists
from firebase_admin import firestore as fs


class FirestoreJobRepo:
    """Persistence helpers for the `factory_jobs` collection and compat patches."""

    def __init__(self, db):
        self.db = db

    def get(self, job_id: str) -> dict:
        snap = self.db.collection("factory_jobs").document(job_id).get()
        if not snap.exists:
            raise KeyError(f"Job not found: {job_id}")
        return {"id": snap.id, **(snap.to_dict() or {})}

    def mark_running(self, job_id: str, run_id: str | None) -> None:
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "current_state": "running",
                "current_run_id": run_id,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_completed(self, job_id: str, run_id: str) -> None:
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
        self.db.collection("factory_jobs").document(job_id).set(
            {
                "retry_requested": True,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_cancelled(self, job_id: str) -> None:
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
        for key, value in patch.items():
            payload[f"runtime.{key}"] = value
        self.db.collection("factory_jobs").document(job_id).update(payload)

    def patch_summary(self, job_id: str, patch: dict) -> None:
        """Patch only the summary subdocument used by admin views and quick status cards."""
        if not patch:
            return
        payload = {"updated_at": fs.SERVER_TIMESTAMP}
        for key, value in patch.items():
            payload[f"summary.{key}"] = value
        self.db.collection("factory_jobs").document(job_id).update(payload)

    def patch_compat_content_job(self, content_job_id: str, patch: dict) -> None:
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
        """
        Patch content_jobs only when this run is still active.

        Returns True when patch was applied, False when skipped as superseded.
        """
        if not content_job_id or not patch:
            return False

        transaction = self.db.transaction()
        doc_ref = self.db.collection("content_jobs").document(content_job_id)
        payload = dict(patch)
        payload["updatedAt"] = fs.SERVER_TIMESTAMP

        @fs.transactional
        def _tx_apply(tx) -> bool:
            snap = doc_ref.get(transaction=tx)
            if not snap.exists:
                return False
            data = snap.to_dict() or {}
            active_run_id = str(data.get("v2RunId") or "").strip()
            if active_run_id and active_run_id != run_id:
                return False
            tx.set(doc_ref, payload, merge=True)
            return True

        return bool(_tx_apply(transaction))


class FirestoreRunRepo:
    """Persistence helpers for per-run lifecycle data in `factory_job_runs`."""

    def __init__(self, db):
        self.db = db

    def next_run_number(self, job_id: str) -> int:
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
        self.db.collection("factory_job_runs").document(run_id).set(
            {
                "state": "completed",
                "ended_at": fs.SERVER_TIMESTAMP,
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    def mark_failed(self, run_id: str, failed_step: str, error_code: str) -> None:
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
        snap = self.db.collection("factory_job_runs").document(run_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        state = str(data.get("state") or "").strip()
        return state or None


class FirestoreStepRunRepo:
    """Persistence helpers for per-step audit records in `factory_step_runs`."""

    def __init__(self, db):
        self.db = db

    @staticmethod
    def make_step_run_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
        return f"{run_id}__{step_name}__{shard_key}"

    def ensure_ready(self, job_id: str, run_id: str, step_name: str, shard_key: str = "root") -> str:
        """Create the step-run doc if needed without failing duplicate enqueue paths."""
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
            pass
        return step_run_id

    def has_succeeded(self, job_id: str, run_id: str, step_name: str) -> bool:
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
        return self._shard_keys_by_state(job_id, run_id, step_name, "succeeded")

    def failed_shard_keys(self, job_id: str, run_id: str, step_name: str) -> set[str]:
        return self._shard_keys_by_state(job_id, run_id, step_name, "failed")

    def state(self, run_id: str, step_name: str, shard_key: str = "root") -> str | None:
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
        self.db.collection("factory_step_runs").document(step_run_id).set(
            {
                "state": "running",
                "queue_id": queue_id,
                "worker_id": worker_id,
                "attempt": attempt,
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


class FirestoreEventRepo:
    """Append-only writer for `factory_events`, used mainly for debugging/recovery."""

    def __init__(self, db):
        self.db = db

    def emit(self, event_type: str, job_id: str, run_id: str, payload: dict) -> str:
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
