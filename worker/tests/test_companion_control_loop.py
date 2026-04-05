from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from companion.control_loop import (
    _collect_auto_workload_from_payloads,
    _desired_auto_stack_ids,
    _pick_stack_ids,
)
from companion.stack_config import load_stack_config


class CompanionControlLoopTests(unittest.TestCase):
    def test_collect_auto_workload_ignores_stale_running_queue_without_active_step(self) -> None:
        now = datetime(2026, 3, 22, 9, 45, tzinfo=timezone.utc)
        workload = _collect_auto_workload_from_payloads(
            [
                {
                    "_queue_id": "stale-dms",
                    "state": "running",
                    "step_name": "synthesize_course_audio",
                    "required_tts_model": "dms",
                    "capability_key": "tts:dms",
                    "lease_owner": "local-tts-dms-3",
                    "updated_at": now - timedelta(days=19),
                    "step_started_at": now - timedelta(days=19),
                    "lease_expires_at": None,
                },
                {
                    "_queue_id": "ready-qwen",
                    "state": "ready",
                    "step_name": "synthesize_course_audio_chunk",
                    "required_tts_model": "qwen3-base",
                    "capability_key": "tts:qwen3-base",
                },
            ],
            worker_status_by_id={
                "local-tts-dms-3": {
                    "workerId": "local-tts-dms-3",
                    "lastHeartbeat": now,
                }
            },
            now=now,
        )

        self.assertEqual(workload["tts_outstanding"], {"qwen3-base": 1})
        self.assertEqual(workload["wildcard_tts_outstanding"], 0)
        self.assertEqual(workload["image_outstanding"], 0)
        self.assertEqual(workload["active_owners"], set())

    def test_collect_auto_workload_keeps_recent_running_queue_during_startup_grace(self) -> None:
        now = datetime(2026, 3, 22, 9, 45, tzinfo=timezone.utc)
        workload = _collect_auto_workload_from_payloads(
            [
                {
                    "_queue_id": "fresh-dms",
                    "state": "running",
                    "step_name": "synthesize_course_audio",
                    "required_tts_model": "dms",
                    "capability_key": "tts:dms",
                    "lease_owner": "local-tts-dms-3",
                    "updated_at": now - timedelta(seconds=5),
                    "step_started_at": now - timedelta(seconds=5),
                    "lease_expires_at": None,
                },
            ],
            worker_status_by_id={
                "local-tts-dms-3": {
                    "workerId": "local-tts-dms-3",
                    "lastHeartbeat": now,
                }
            },
            now=now,
        )

        self.assertEqual(workload["tts_outstanding"], {"dms": 1})
        self.assertEqual(workload["image_outstanding"], 0)
        self.assertEqual(workload["active_owners"], {"local-tts-dms-3"})

    def test_desired_auto_stack_ids_do_not_keep_dms_worker_for_stale_queue(self) -> None:
        enabled_stacks = [stack for stack in load_stack_config() if stack.get("enabled", True)]
        running = {"local-tts-dms-3": 12345}
        workload = {
            "pending_jobs": False,
            "delete_jobs": False,
            "non_tts_outstanding": 0,
            "image_outstanding": 0,
            "tts_outstanding": {"qwen3-base": 1},
            "wildcard_tts_outstanding": 0,
            "active_owners": set(),
            "has_any_work": True,
        }

        with patch("companion.control_loop._collect_auto_workload", return_value=workload):
            desired_ids, resolved_workload = _desired_auto_stack_ids(object(), enabled_stacks, running)

        self.assertEqual(resolved_workload, workload)
        self.assertIn("local-tts-qwen", desired_ids)
        self.assertNotIn("local-tts-dms-3", desired_ids)

    def test_pick_stack_ids_preserves_active_workers_even_above_requested_target(self) -> None:
        candidate_stacks = [
            {"id": "local-tts-qwen"},
            {"id": "local-tts-qwen-2"},
            {"id": "local-tts-qwen-3"},
        ]

        picked = _pick_stack_ids(
            candidate_stacks,
            needed_count=1,
            running_ids={"local-tts-qwen-2", "local-tts-qwen-3"},
            active_owners={"local-tts-qwen-2", "local-tts-qwen-3"},
            selected_ids=set(),
        )

        self.assertEqual(picked, ["local-tts-qwen-2", "local-tts-qwen-3"])

    def test_desired_auto_stack_ids_caps_qwen_pool_when_memory_is_low(self) -> None:
        enabled_stacks = [stack for stack in load_stack_config() if stack.get("enabled", True)]
        workload = {
            "pending_jobs": False,
            "delete_jobs": False,
            "non_tts_outstanding": 0,
            "image_outstanding": 0,
            "tts_outstanding": {"qwen3-base": 6},
            "wildcard_tts_outstanding": 0,
            "active_owners": set(),
            "has_any_work": True,
        }

        with (
            patch("companion.control_loop._collect_auto_workload", return_value=workload),
            patch(
                "companion.control_loop._system_memory_snapshot",
                return_value={"freeRatio": 0.12, "freeBytes": 4_000_000_000},
            ),
        ):
            desired_ids, resolved_workload = _desired_auto_stack_ids(
                object(),
                enabled_stacks,
                running={},
            )

        qwen_ids = sorted(stack_id for stack_id in desired_ids if "qwen" in stack_id)
        self.assertEqual(qwen_ids, [])
        self.assertEqual(resolved_workload["qwen_stack_cap"], 0)

    def test_desired_auto_stack_ids_keeps_active_qwen_workers_while_capping_idle_pool(self) -> None:
        enabled_stacks = [stack for stack in load_stack_config() if stack.get("enabled", True)]
        workload = {
            "pending_jobs": False,
            "delete_jobs": False,
            "non_tts_outstanding": 0,
            "image_outstanding": 0,
            "tts_outstanding": {"qwen3-base": 6},
            "wildcard_tts_outstanding": 0,
            "active_owners": {"local-tts-qwen-4", "local-tts-qwen-5"},
            "has_any_work": True,
        }

        with (
            patch("companion.control_loop._collect_auto_workload", return_value=workload),
            patch(
                "companion.control_loop._system_memory_snapshot",
                return_value={"freeRatio": 0.12, "freeBytes": 4_000_000_000},
            ),
        ):
            desired_ids, _ = _desired_auto_stack_ids(
                object(),
                enabled_stacks,
                running={"local-tts-qwen-4": 1001, "local-tts-qwen-5": 1002},
            )

        qwen_ids = sorted(stack_id for stack_id in desired_ids if "qwen" in stack_id)
        self.assertEqual(qwen_ids, ["local-tts-qwen-4", "local-tts-qwen-5"])

    def test_desired_auto_stack_ids_caps_to_one_qwen_worker_before_critical_memory(self) -> None:
        enabled_stacks = [stack for stack in load_stack_config() if stack.get("enabled", True)]
        workload = {
            "pending_jobs": False,
            "delete_jobs": False,
            "non_tts_outstanding": 0,
            "image_outstanding": 0,
            "tts_outstanding": {"qwen3-base": 6},
            "wildcard_tts_outstanding": 0,
            "active_owners": set(),
            "has_any_work": True,
        }

        with (
            patch("companion.control_loop._collect_auto_workload", return_value=workload),
            patch(
                "companion.control_loop._system_memory_snapshot",
                return_value={"freeRatio": 0.19, "freeBytes": 7_000_000_000},
            ),
        ):
            desired_ids, resolved_workload = _desired_auto_stack_ids(
                object(),
                enabled_stacks,
                running={},
            )

        qwen_ids = sorted(stack_id for stack_id in desired_ids if "qwen" in stack_id)
        self.assertEqual(qwen_ids, ["local-tts-qwen"])
        self.assertEqual(resolved_workload["qwen_stack_cap"], 1)

    def test_desired_auto_stack_ids_starts_dedicated_image_worker(self) -> None:
        enabled_stacks = [stack for stack in load_stack_config() if stack.get("enabled", True)]
        workload = {
            "pending_jobs": False,
            "delete_jobs": False,
            "non_tts_outstanding": 0,
            "image_outstanding": 1,
            "tts_outstanding": {},
            "wildcard_tts_outstanding": 0,
            "active_owners": set(),
            "has_any_work": True,
        }

        with patch("companion.control_loop._collect_auto_workload", return_value=workload):
            desired_ids, resolved_workload = _desired_auto_stack_ids(object(), enabled_stacks, running={})

        self.assertEqual(resolved_workload, workload)
        self.assertIn("local-image", desired_ids)
        self.assertNotIn("local-primary", desired_ids)


if __name__ == "__main__":
    unittest.main()
