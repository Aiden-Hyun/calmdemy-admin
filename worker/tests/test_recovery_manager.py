from __future__ import annotations

import copy
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from firebase_admin import firestore as fs

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.interfaces.recovery_manager import RecoveryManager


def _resolved_value(current, value):
    class_name = value.__class__.__name__
    if class_name == "Increment":
        return (current or 0) + int(getattr(value, "value", getattr(value, "_value", 0)))
    if class_name == "Sentinel":
        return datetime.now(timezone.utc)
    return copy.deepcopy(value)


def _merge_dict(target: dict, patch: dict) -> dict:
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            target[key] = _merge_dict(dict(target.get(key) or {}), value)
            continue
        target[key] = _resolved_value(target.get(key), value)
    return target


class _FakeSnapshot:
    def __init__(self, reference, data):
        self.reference = reference
        self.id = reference.id
        self._data = copy.deepcopy(data) if data is not None else None

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict:
        return copy.deepcopy(self._data or {})


class _FakeDocRef:
    def __init__(self, db, collection_name: str, doc_id: str):
        self._db = db
        self._collection_name = collection_name
        self.id = doc_id

    def get(self, transaction=None):
        data = self._db._collections.get(self._collection_name, {}).get(self.id)
        return _FakeSnapshot(self, data)

    def set(self, payload: dict, merge: bool = False):
        collection = self._db._collections.setdefault(self._collection_name, {})
        if merge and self.id in collection:
            collection[self.id] = _merge_dict(dict(collection[self.id]), payload)
        else:
            collection[self.id] = _merge_dict({}, payload)

    def update(self, payload: dict):
        collection = self._db._collections.setdefault(self._collection_name, {})
        collection[self.id] = _merge_dict(dict(collection.get(self.id) or {}), payload)


class _FakeQuery:
    def __init__(self, db, collection_name: str, filters=None, limit_value: int | None = None):
        self._db = db
        self._collection_name = collection_name
        self._filters = list(filters or [])
        self._limit_value = limit_value

    def where(self, field: str, op: str, value):
        return _FakeQuery(
            self._db,
            self._collection_name,
            filters=self._filters + [(field, op, value)],
            limit_value=self._limit_value,
        )

    def limit(self, value: int):
        return _FakeQuery(self._db, self._collection_name, filters=self._filters, limit_value=value)

    def stream(self):
        docs = []
        for doc_id, payload in self._db._collections.get(self._collection_name, {}).items():
            if all(self._matches(payload, field, op, value) for field, op, value in self._filters):
                docs.append(_FakeSnapshot(_FakeDocRef(self._db, self._collection_name, doc_id), payload))
        if self._limit_value is not None:
            docs = docs[: self._limit_value]
        return docs

    @staticmethod
    def _matches(payload: dict, field: str, op: str, value) -> bool:
        current = payload.get(field)
        if op == "==":
            return current == value
        if op == "<=":
            return current <= value
        raise AssertionError(f"Unsupported operator: {op}")


class _FakeCollection:
    def __init__(self, db, collection_name: str):
        self._db = db
        self._collection_name = collection_name

    def document(self, doc_id: str):
        return _FakeDocRef(self._db, self._collection_name, doc_id)

    def where(self, field: str, op: str, value):
        return _FakeQuery(self._db, self._collection_name).where(field, op, value)

    def stream(self):
        return _FakeQuery(self._db, self._collection_name).stream()


class _FakeTransaction:
    _read_only = False

    def update(self, doc_ref: _FakeDocRef, payload: dict):
        doc_ref.update(payload)

    def set(self, doc_ref: _FakeDocRef, payload: dict, merge: bool = False):
        doc_ref.set(payload, merge=merge)


class _FakeDB:
    def __init__(self, collections: dict[str, dict[str, dict]] | None = None):
        self._collections = copy.deepcopy(collections or {})

    def collection(self, name: str):
        return _FakeCollection(self, name)

    def transaction(self):
        return _FakeTransaction()


class _FakeQueueRepo:
    def __init__(self, db: _FakeDB, stale_leases: int = 0):
        self._db = db
        self._stale_leases = stale_leases

    def recover_stale_leases(self) -> int:
        return self._stale_leases

    def fetch_docs_by_states(self, states, limit: int):
        docs = []
        allowed = set(states)
        for doc_id, payload in self._db._collections.get("factory_step_queue", {}).items():
            if str(payload.get("state") or "") in allowed:
                docs.append(_FakeSnapshot(_FakeDocRef(self._db, "factory_step_queue", doc_id), payload))
        return docs[:limit]


class _FakeRunRepo:
    def __init__(self, states: dict[str, str]):
        self._states = dict(states)

    def run_state(self, run_id: str) -> str | None:
        return self._states.get(run_id)


class _FakeJobRepo:
    def __init__(self, jobs: dict[str, dict]):
        self._jobs = copy.deepcopy(jobs)
        self.failed_patches: list[tuple[str, str, dict]] = []

    def get(self, job_id: str) -> dict:
        return copy.deepcopy(self._jobs[job_id])

    def patch_compat_content_job_for_run(self, content_job_id: str, run_id: str, patch: dict) -> bool:
        self.failed_patches.append((content_job_id, run_id, copy.deepcopy(patch)))
        return True


class _FakeEventRepo:
    def __init__(self):
        self.events: list[tuple[str, str, str, dict]] = []

    def emit(self, event_type: str, job_id: str, run_id: str, payload: dict) -> str:
        self.events.append((event_type, job_id, run_id, copy.deepcopy(payload)))
        return f"event-{len(self.events)}"


class _FakeOrchestrator:
    def __init__(self):
        self.failed_calls: list[tuple[str, str, str, str]] = []
        self.cancelled_calls: list[tuple[str, str, str, str]] = []

    def recover_course_audio_fan_out_if_ready(self, job_id: str, run_id: str) -> int:
        return 1 if job_id == "job-1" and run_id == "run-1" else 0

    def recover_course_audio_fan_in_if_ready(self, job_id: str, run_id: str) -> int:
        return 2 if job_id == "job-1" and run_id == "run-1" else 0

    def recover_course_upload_if_ready(self, job_id: str, run_id: str) -> bool:
        return job_id == "job-1" and run_id == "run-1"

    def recover_course_publish_if_ready(self, job_id: str, run_id: str) -> bool:
        return False

    def cancel_run(
        self,
        job_id: str,
        run_id: str,
        *,
        reason: str = "Cancelled by admin",
        error_code: str = "cancelled_by_admin",
    ) -> None:
        self.cancelled_calls.append((job_id, run_id, reason, error_code))

    def on_step_failed(self, job_id: str, run_id: str, step_name: str, error_code: str) -> None:
        self.failed_calls.append((job_id, run_id, step_name, error_code))


class RecoveryManagerTests(unittest.TestCase):
    def test_recover_worker_tick_counts_recoveries(self) -> None:
        recovery_manager = RecoveryManager(
            db=_FakeDB(
                {
                    "factory_jobs": {
                        "job-1": {"job_type": "course", "current_state": "running", "current_run_id": "run-1"},
                        "job-2": {"job_type": "course", "current_state": "running", "current_run_id": "run-2"},
                    }
                }
            ),
            queue_repo=_FakeQueueRepo(_FakeDB(), stale_leases=3),
            run_repo=_FakeRunRepo({"run-1": "running", "run-2": "completed"}),
            orchestrator=_FakeOrchestrator(),
        )

        recovered = recovery_manager.recover_worker_tick()

        self.assertEqual(
            recovered,
            {
                "stale_leases": 3,
                "stuck_detected": 0,
                "watchdog_retries": 0,
                "watchdog_failures": 0,
                "worker_recycles": 0,
                "fan_in": 2,
                "upload": 1,
                "publish": 0,
                "admin_cancelled": 0,
            },
        )

    def test_recover_worker_tick_cancels_admin_cancelled_runs(self) -> None:
        orchestrator = _FakeOrchestrator()
        recovery_manager = RecoveryManager(
            db=_FakeDB(
                {
                    "factory_jobs": {
                        "job-1": {
                            "job_type": "course",
                            "current_state": "running",
                            "current_run_id": "run-1",
                            "request": {"compat": {"content_job_id": "content-1"}},
                        },
                        "job-2": {
                            "job_type": "course",
                            "current_state": "running",
                            "current_run_id": "run-2",
                            "request": {"compat": {"content_job_id": "content-2"}},
                        },
                    },
                    "content_jobs": {
                        "content-1": {
                            "status": "failed",
                            "error": "Cancelled by admin",
                            "errorCode": "cancelled_by_admin",
                        },
                        "content-2": {
                            "status": "completed",
                            "errorCode": None,
                        },
                    },
                }
            ),
            queue_repo=_FakeQueueRepo(_FakeDB(), stale_leases=0),
            run_repo=_FakeRunRepo({"run-1": "running", "run-2": "running"}),
            orchestrator=orchestrator,
        )

        recovered = recovery_manager.recover_worker_tick()

        self.assertEqual(recovered["admin_cancelled"], 1)
        self.assertEqual(
            orchestrator.cancelled_calls,
            [("job-1", "run-1", "Cancelled by admin", "cancelled_by_admin")],
        )

    def test_detects_deadline_exceeded_and_schedules_retry(self) -> None:
        now = datetime.now(timezone.utc)
        db = _FakeDB(
            {
                "factory_step_queue": {
                    "queue-1": {
                        "job_id": "job-1",
                        "run_id": "run-1",
                        "step_name": "synthesize_course_audio_chunk",
                        "step_run_id": "run-1__synthesize_course_audio_chunk__INT-C0",
                        "shard_key": "INT-C0",
                        "state": "running",
                        "lease_owner": "local-tts-qwen-1",
                        "retry_count": 0,
                        "stuck_retry_count": 0,
                        "step_deadline_at": now - timedelta(minutes=1),
                    }
                },
                "factory_step_runs": {
                    "run-1__synthesize_course_audio_chunk__INT-C0": {
                        "state": "running",
                        "attempt": 1,
                    }
                },
                "worker_status": {
                    "local-tts-qwen-1": {
                        "lastHeartbeat": now,
                        "currentQueueId": "queue-1",
                        "currentStepHeartbeatAt": now - timedelta(minutes=2),
                    }
                },
                "worker_stacks_status": {"local": {}},
            }
        )
        orchestrator = _FakeOrchestrator()
        event_repo = _FakeEventRepo()
        job_repo = _FakeJobRepo(
            {
                "job-1": {
                    "request": {
                        "compat": {
                            "content_job_id": "content-1",
                        }
                    }
                }
            }
        )
        recycle_calls: list[str] = []

        def _recycler(worker_id: str, _payload: dict) -> dict[str, bool]:
            recycle_calls.append(worker_id)
            return {"terminated": True, "recycled": True}

        recovery_manager = RecoveryManager(
            db=db,
            job_repo=job_repo,
            step_run_repo=object(),
            queue_repo=_FakeQueueRepo(db),
            run_repo=_FakeRunRepo({"run-1": "running"}),
            event_repo=event_repo,
            orchestrator=orchestrator,
            worker_recycler=_recycler,
        )

        with patch.dict(os.environ, {"V2_STEP_WATCHDOG_ENABLED": "true", "V2_STUCK_RETRY_DELAYS_SEC": "30,120"}):
            with patch("factory_v2.interfaces.recovery_manager.fs.transactional", lambda fn: fn):
                recovered = recovery_manager.recover_stuck_steps()

        queue_doc = db._collections["factory_step_queue"]["queue-1"]
        step_run = db._collections["factory_step_runs"]["run-1__synthesize_course_audio_chunk__INT-C0"]

        self.assertEqual(recovered["stuck_detected"], 1)
        self.assertEqual(recovered["watchdog_retries"], 1)
        self.assertEqual(recovered["worker_recycles"], 1)
        self.assertEqual(queue_doc["state"], "ready")
        self.assertEqual(queue_doc["retry_count"], 1)
        self.assertEqual(queue_doc["stuck_retry_count"], 1)
        self.assertEqual(queue_doc["error_code"], "stuck_timeout")
        self.assertIsNone(queue_doc["lease_owner"])
        self.assertEqual(step_run["state"], "retry_scheduled")
        self.assertEqual(step_run["next_attempt"], 2)
        self.assertEqual(recycle_calls, ["local-tts-qwen-1"])
        self.assertEqual(
            [event[0] for event in event_repo.events],
            ["worker_recycled_for_stuck_step", "step_watchdog_retry_scheduled"],
        )

    def test_missing_worker_status_retries_without_recycler(self) -> None:
        now = datetime.now(timezone.utc)
        db = _FakeDB(
            {
                "factory_step_queue": {
                    "queue-1": {
                        "job_id": "job-1",
                        "run_id": "run-1",
                        "step_name": "upload_audio",
                        "step_run_id": "run-1__upload_audio__root",
                        "state": "running",
                        "lease_owner": "local-primary",
                        "retry_count": 0,
                        "stuck_retry_count": 0,
                        "step_deadline_at": now + timedelta(minutes=5),
                    }
                },
                "factory_step_runs": {
                    "run-1__upload_audio__root": {
                        "state": "running",
                        "attempt": 1,
                    }
                },
                "worker_stacks_status": {"local": {}},
            }
        )
        recovery_manager = RecoveryManager(
            db=db,
            job_repo=_FakeJobRepo({"job-1": {"request": {"compat": {"content_job_id": "content-1"}}}}),
            step_run_repo=object(),
            queue_repo=_FakeQueueRepo(db),
            run_repo=_FakeRunRepo({"run-1": "running"}),
            event_repo=_FakeEventRepo(),
            orchestrator=_FakeOrchestrator(),
        )

        with patch.dict(os.environ, {"V2_STEP_WATCHDOG_ENABLED": "true"}):
            with patch("factory_v2.interfaces.recovery_manager.fs.transactional", lambda fn: fn):
                recovered = recovery_manager.recover_stuck_steps()

        self.assertEqual(recovered["stuck_detected"], 1)
        self.assertEqual(recovered["watchdog_retries"], 1)
        self.assertEqual(db._collections["factory_step_queue"]["queue-1"]["state"], "ready")

    def test_exhausted_stuck_budget_fails_run(self) -> None:
        now = datetime.now(timezone.utc)
        db = _FakeDB(
            {
                "factory_step_queue": {
                    "queue-1": {
                        "job_id": "job-1",
                        "run_id": "run-1",
                        "step_name": "publish_content",
                        "step_run_id": "run-1__publish_content__root",
                        "state": "running",
                        "lease_owner": "local-primary",
                        "retry_count": 2,
                        "stuck_retry_count": 2,
                        "step_deadline_at": now - timedelta(minutes=1),
                    }
                },
                "factory_step_runs": {
                    "run-1__publish_content__root": {
                        "state": "running",
                        "attempt": 3,
                    }
                },
                "worker_status": {
                    "local-primary": {
                        "lastHeartbeat": now,
                        "currentQueueId": "queue-1",
                        "currentStepHeartbeatAt": now - timedelta(minutes=2),
                    }
                },
                "worker_stacks_status": {"local": {}},
            }
        )
        orchestrator = _FakeOrchestrator()
        job_repo = _FakeJobRepo(
            {
                "job-1": {
                    "request": {
                        "compat": {
                            "content_job_id": "content-1",
                        }
                    }
                }
            }
        )
        recovery_manager = RecoveryManager(
            db=db,
            job_repo=job_repo,
            step_run_repo=object(),
            queue_repo=_FakeQueueRepo(db),
            run_repo=_FakeRunRepo({"run-1": "running"}),
            event_repo=_FakeEventRepo(),
            orchestrator=orchestrator,
            worker_recycler=lambda _worker_id, _payload: {"terminated": True, "recycled": True},
        )

        with patch.dict(os.environ, {"V2_STEP_WATCHDOG_ENABLED": "true", "V2_STUCK_RETRY_DELAYS_SEC": "30,120"}):
            with patch("factory_v2.interfaces.recovery_manager.fs.transactional", lambda fn: fn):
                recovered = recovery_manager.recover_stuck_steps()

        queue_doc = db._collections["factory_step_queue"]["queue-1"]
        step_run = db._collections["factory_step_runs"]["run-1__publish_content__root"]

        self.assertEqual(recovered["watchdog_failures"], 1)
        self.assertEqual(queue_doc["state"], "failed")
        self.assertEqual(step_run["state"], "failed")
        self.assertEqual(orchestrator.failed_calls, [("job-1", "run-1", "publish_content", "stuck_timeout")])
        self.assertEqual(job_repo.failed_patches[0][0], "content-1")
        self.assertEqual(job_repo.failed_patches[0][2]["errorCode"], "stuck_timeout")


if __name__ == "__main__":
    unittest.main()
