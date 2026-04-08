from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.interfaces.queue_policy import (
    QueueCandidate,
    build_worker_capability_plan,
    rank_claim_candidates,
    supports_worker_payload,
)
from factory_v2.shared.queue_capabilities import capability_key_for_step


class QueuePolicyTests(unittest.TestCase):
    def test_capability_key_mapping(self) -> None:
        self.assertEqual(capability_key_for_step("generate_course_plan"), "default")
        self.assertEqual(capability_key_for_step("generate_course_thumbnail"), "image")
        self.assertEqual(capability_key_for_step("synthesize_course_audio_chunk", "qwen3-base"), "tts:qwen3-base")
        self.assertEqual(capability_key_for_step("synthesize_course_audio"), "tts:any")

    def test_image_only_worker_supports_image_steps_but_not_default_steps(self) -> None:
        plan = build_worker_capability_plan(
            accept_non_tts_steps=False,
            supported_tts_models=set(),
            extra_capability_keys={"image"},
        )
        self.assertTrue(
            supports_worker_payload(
                {
                    "step_name": "generate_course_thumbnail",
                    "capability_key": "image",
                },
                plan,
            )
        )
        self.assertFalse(
            supports_worker_payload(
                {
                    "step_name": "generate_course_plan",
                    "capability_key": "default",
                },
                plan,
            )
        )

    def test_legacy_payload_without_capability_key_is_supported_by_matching_worker(self) -> None:
        plan = build_worker_capability_plan(
            accept_non_tts_steps=False,
            supported_tts_models={"qwen3-base"},
        )
        self.assertTrue(
            supports_worker_payload(
                {
                    "step_name": "synthesize_course_audio_chunk",
                    "required_tts_model": "qwen3-base",
                },
                plan,
            )
        )
        self.assertFalse(
            supports_worker_payload(
                {
                    "step_name": "synthesize_course_audio_chunk",
                    "required_tts_model": "qwen3-base",
                },
                plan,
            )
        )

    def test_soft_limit_deprioritizes_monopolizing_job(self) -> None:
        plan = build_worker_capability_plan(
            accept_non_tts_steps=False,
            supported_tts_models={"qwen3-base"},
        )
        base = datetime(2026, 3, 21, 10, 20, tzinfo=timezone.utc)
        ranked = rank_claim_candidates(
            [
                QueueCandidate(
                    doc_id="job-a-0",
                    doc_ref=object(),
                    payload={
                        "available_at": base,
                        "job_id": "job-a",
                        "step_name": "synthesize_course_audio_chunk",
                        "capability_key": "tts:qwen3-base",
                    },
                    source_reason="selected_by_capability",
                ),
                QueueCandidate(
                    doc_id="job-b-0",
                    doc_ref=object(),
                    payload={
                        "available_at": base + timedelta(seconds=2),
                        "job_id": "job-b",
                        "step_name": "synthesize_course_audio_chunk",
                        "capability_key": "tts:qwen3-base",
                    },
                    source_reason="selected_by_capability",
                ),
            ],
            plan=plan,
            active_tts_by_job={"job-a": 4},
            tts_per_job_soft_limit=2,
        )

        self.assertEqual([candidate.doc_id for candidate in ranked], ["job-b-0", "job-a-0"])
        self.assertEqual(ranked[0].claim_reason, "deprioritized_by_soft_limit")


if __name__ == "__main__":
    unittest.main()
