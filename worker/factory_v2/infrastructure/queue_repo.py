"""Firestore-backed queue primitives used by workers and recovery routines."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from google.api_core.exceptions import AlreadyExists
from firebase_admin import firestore as fs

from ..shared.queue_capabilities import capability_key_for_step


class FirestoreQueueRepo:
    """Low-level queue operations over the `factory_step_queue` collection."""

    def __init__(self, db):
        self.db = db

    @staticmethod
    def make_queue_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
        return f"{run_id}__{step_name}__{shard_key}"

    def state(self, run_id: str, step_name: str, shard_key: str = "root") -> str | None:
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
            "available_at": available_at or datetime.now(timezone.utc),
            "retry_count": 0,
            "stuck_retry_count": 0,
            "capability_key": capability_key_for_step(step_name, normalized_tts_model),
            "created_at": fs.SERVER_TIMESTAMP,
            "updated_at": fs.SERVER_TIMESTAMP,
        }
        if normalized_tts_model:
            payload["required_tts_model"] = normalized_tts_model
        try:
            doc_ref.create(payload)
        except AlreadyExists:
            # Enqueue is idempotent for the same run/step/shard key.
            pass
        return queue_id

    def fetch_ready(
        self,
        available_before: datetime,
        limit: int,
    ) -> list[Any]:
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
        """Atomically move a ready doc into the leased state for one worker."""
        now = datetime.now(timezone.utc)
        tx = self.db.transaction()

        @fs.transactional
        def _claim(transaction):
            snap = doc_ref.get(transaction=transaction)
            if not snap.exists:
                return None
            data = snap.to_dict() or {}
            if data.get("state") != "ready":
                return None
            if payload_validator and not payload_validator(data):
                return None
            transaction.update(
                doc_ref,
                {
                    "state": "leased",
                    "lease_owner": worker_id,
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
        """Reset expired leased/running queue items back to ready."""
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

                    lease_ts = (
                        datetime.fromtimestamp(lease_expires_at.timestamp(), tz=timezone.utc)
                        if hasattr(lease_expires_at, "timestamp")
                        else lease_expires_at
                    )
                    if isinstance(lease_ts, datetime) and lease_ts.tzinfo is None:
                        lease_ts = lease_ts.replace(tzinfo=timezone.utc)
                    if not isinstance(lease_ts, datetime) or lease_ts > now:
                        return False

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
        """Promote a leased item to running once executor work actually starts."""
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
        """Refresh lease/heartbeat fields while a worker is actively executing a step."""
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
        """
        Cancel queued work for a run that should no longer continue.

        Only READY/LEASED items are cancelled; RUNNING items are handled by run-state guards.
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
                snap = doc.reference.get(transaction=transaction)
                if not snap.exists:
                    return False
                data = snap.to_dict() or {}
                state = str(data.get("state") or "")
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
