from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.interfaces.queue_policy import QueueScheduler


class _FakeSnapshot:
    def __init__(self, doc_id: str, payload: dict):
        self.id = doc_id
        self.reference = self
        self._payload = dict(payload)

    def to_dict(self) -> dict:
        return dict(self._payload)


class _FakeQueueRepo:
    def __init__(self, ready_docs: list[_FakeSnapshot], active_payloads: list[dict] | None = None):
        self._ready_docs = list(ready_docs)
        self._active_payloads = list(active_payloads or [])
        self.claimed_ids: list[str] = []

    def fetch_ready_by_capability(self, capability_key: str, available_before, limit: int):
        docs = [
            doc for doc in self._ready_docs
            if str(doc.to_dict().get("capability_key") or "") == capability_key
            and doc.to_dict().get("available_at") <= available_before
        ]
        return docs[:limit]

    def fetch_ready(self, available_before, limit: int):
        docs = [
            doc for doc in self._ready_docs
            if doc.to_dict().get("available_at") <= available_before
        ]
        docs.sort(key=lambda doc: (doc.to_dict().get("available_at"), doc.id))
        return docs[:limit]

    def fetch_payloads_by_states(self, states, limit: int):
        return list(self._active_payloads)[: limit * max(1, len(tuple(states)))]

    def claim_ready_doc(self, doc_ref, worker_id: str, lease_seconds: int = 300, payload_validator=None):
        payload = doc_ref.to_dict()
        if payload_validator and not payload_validator(payload):
            return None
        if doc_ref.id in self.claimed_ids:
            return None
        self.claimed_ids.append(doc_ref.id)
        return payload


class QueueSchedulerTests(unittest.TestCase):
    def test_pure_tts_worker_claims_only_matching_capability(self) -> None:
        base = datetime(2026, 3, 21, 10, 20, tzinfo=timezone.utc)
        repo = _FakeQueueRepo(
            ready_docs=[
                _FakeSnapshot(
                    "default-0",
                    {
                        "job_id": "job-default",
                        "run_id": "run-default",
                        "step_name": "generate_course_plan",
                        "capability_key": "default",
                        "available_at": base,
                    },
                ),
                _FakeSnapshot(
                    "qwen-0",
                    {
                        "job_id": "job-qwen",
                        "run_id": "run-qwen",
                        "step_name": "synthesize_course_audio_chunk",
                        "required_tts_model": "qwen3-base",
                        "capability_key": "tts:qwen3-base",
                        "available_at": base + timedelta(seconds=1),
                    },
                ),
            ]
        )
        scheduler = QueueScheduler(repo)

        claimed = scheduler.claim_next(
            worker_id="local-tts-qwen",
            accept_non_tts_steps=False,
            supported_tts_models={"qwen3-base"},
            candidate_limit=20,
            tts_per_job_soft_limit=2,
        )

        self.assertIsNotNone(claimed)
        queue_id, payload = claimed or ("", {})
        self.assertEqual(queue_id, "qwen-0")
        self.assertEqual(payload.get("job_id"), "job-qwen")

    def test_mixed_worker_merges_default_and_tts_candidates(self) -> None:
        base = datetime(2026, 3, 21, 10, 20, tzinfo=timezone.utc)
        repo = _FakeQueueRepo(
            ready_docs=[
                _FakeSnapshot(
                    "default-0",
                    {
                        "job_id": "job-default",
                        "run_id": "run-default",
                        "step_name": "generate_course_plan",
                        "capability_key": "default",
                        "available_at": base + timedelta(seconds=2),
                    },
                ),
                _FakeSnapshot(
                    "qwen-0",
                    {
                        "job_id": "job-qwen",
                        "run_id": "run-qwen",
                        "step_name": "synthesize_course_audio_chunk",
                        "required_tts_model": "qwen3-base",
                        "capability_key": "tts:qwen3-base",
                        "available_at": base,
                    },
                ),
            ]
        )
        scheduler = QueueScheduler(repo)

        claimed = scheduler.claim_next(
            worker_id="local-primary",
            accept_non_tts_steps=True,
            supported_tts_models={"qwen3-base"},
            candidate_limit=20,
            tts_per_job_soft_limit=2,
        )

        self.assertIsNotNone(claimed)
        queue_id, _ = claimed or ("", {})
        self.assertEqual(queue_id, "qwen-0")

    def test_concurrent_course_fairness_claims_second_run(self) -> None:
        base = datetime(2026, 3, 21, 10, 20, tzinfo=timezone.utc)
        repo = _FakeQueueRepo(
            ready_docs=[
                _FakeSnapshot(
                    "run-a-chunk-0",
                    {
                        "job_id": "job-a",
                        "run_id": "run-a",
                        "step_name": "synthesize_course_audio_chunk",
                        "required_tts_model": "qwen3-base",
                        "capability_key": "tts:qwen3-base",
                        "available_at": base,
                    },
                ),
                _FakeSnapshot(
                    "run-b-chunk-0",
                    {
                        "job_id": "job-b",
                        "run_id": "run-b",
                        "step_name": "synthesize_course_audio_chunk",
                        "required_tts_model": "qwen3-base",
                        "capability_key": "tts:qwen3-base",
                        "available_at": base + timedelta(seconds=2),
                    },
                ),
            ],
            active_payloads=[
                {
                    "job_id": "job-a",
                    "run_id": "run-a",
                    "step_name": "synthesize_course_audio_chunk",
                    "required_tts_model": "qwen3-base",
                    "capability_key": "tts:qwen3-base",
                }
                for _ in range(4)
            ],
        )
        scheduler = QueueScheduler(repo)

        claimed = scheduler.claim_next(
            worker_id="local-tts-qwen",
            accept_non_tts_steps=False,
            supported_tts_models={"qwen3-base"},
            candidate_limit=20,
            tts_per_job_soft_limit=2,
        )

        self.assertIsNotNone(claimed)
        queue_id, payload = claimed or ("", {})
        self.assertEqual(queue_id, "run-b-chunk-0")
        self.assertEqual(payload.get("run_id"), "run-b")


if __name__ == "__main__":
    unittest.main()
