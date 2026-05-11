"""Regression tests for the Firestore eventual-consistency race in
single-content audio fan-in.

Background:
    Firestore index queries (the kind used by ``succeeded_shard_keys``)
    lag the underlying document write by ~50-500 ms. When the LAST chunk's
    ``on_step_success`` fires immediately after ``mark_succeeded`` for that
    same shard, the index hasn't propagated yet, so the query returns N-1
    of N succeeded shards. The fan-in helper then thinks "not all done" and
    returns without enqueueing the next step. Because this was the LAST
    completion, no future hook will retry — the pipeline silently stalls.

    Fix: the dispatcher passes ``just_succeeded_shard`` to the fan-in
    helper, which unions it into the queried succeeded set. The helper
    knows that shard is succeeded (the dispatcher is being called from
    its on_step_success hook), so it doesn't need the index to confirm.

These tests pin the union behavior so a refactor can't silently regress
back into the race.
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.application.orchestrator import (
    Orchestrator,
    SINGLE_AUDIO_CHUNK_STEP,
    SINGLE_AUDIO_QC_STEP,
)


class _RecordingJobRepo:
    def __init__(self, job: dict):
        self._job = job

    def get(self, _job_id: str) -> dict:
        return self._job


class _StaleIndexStepRunRepo:
    """Simulates Firestore's eventual-consistency behavior.

    Records of successful shards are stored, but queries can be told to
    "lag" — to exclude a specific shard that's logically succeeded but not
    yet visible to the index. This is exactly the production failure mode.
    """

    def __init__(
        self,
        succeeded_shards: set[str],
        *,
        lagging_shard: str | None = None,
    ):
        self._succeeded = set(succeeded_shards)
        self._lagging_shard = lagging_shard
        self._enqueue_calls: list[tuple[str, str]] = []

    def succeeded_shard_keys(self, _job_id: str, _run_id: str, _step_name: str) -> set[str]:
        # Mimic the lag: omit the shard whose write hasn't propagated yet.
        visible = set(self._succeeded)
        if self._lagging_shard and self._lagging_shard in visible:
            visible.discard(self._lagging_shard)
        return visible

    def failed_shard_keys(self, _job_id: str, _run_id: str, _step_name: str) -> set[str]:
        return set()

    def state(self, _run_id: str, _step_name: str, _shard_key: str = "root") -> str | None:
        return None

    # Capture orchestrator's _ensure_step_enqueued path so we can assert on it.
    def record_enqueue(self, step_name: str, shard_key: str) -> None:
        self._enqueue_calls.append((step_name, shard_key))


class _UnusedQueueRepo:
    def enqueue(self, **_kwargs) -> None:
        pass


class _UnusedRunRepo:
    pass


def _build_orchestrator(succeeded: set[str], *, lagging_shard: str | None = None):
    """Construct an orchestrator with a step-run repo that simulates the
    Firestore consistency lag. Patches _ensure_step_enqueued so we can
    observe what the orchestrator would enqueue without touching Firestore."""
    job = {
        "id": "job-1",
        "job_type": "single_content",
        "request": {
            "content_job": {"contentType": "guided_meditation"},
        },
        "runtime": {
            # 7 chunks worth of script — passes _single_audio_chunk_shards().
            "formatted_script": " ".join(["sentence."] * 200),
        },
    }
    step_run_repo = _StaleIndexStepRunRepo(succeeded, lagging_shard=lagging_shard)
    orch = Orchestrator(
        job_repo=_RecordingJobRepo(job),
        run_repo=_UnusedRunRepo(),
        step_run_repo=step_run_repo,
        queue_repo=_UnusedQueueRepo(),
    )
    return orch, job, step_run_repo


class FaninRaceTests(unittest.TestCase):
    # ----------------------- _maybe_fan_out_single_audio_qc -----------------------

    def test_qc_fanout_fires_when_just_succeeded_shard_passed_even_if_index_is_stale(self) -> None:
        """Production scenario: the last synth chunk's on_step_success fires
        immediately after its mark_succeeded. Index hasn't propagated yet.
        Without the fix, fan-out silently returned False. With the fix, the
        helper unions the just-succeeded shard into the visible set and
        enqueues all 7 QC chunks."""
        # All 7 synth shards have been "logically" succeeded, but the LAST
        # one (P07) is still in the index-lag window.
        all_shards = {"P01", "P02", "P03", "P04", "P05", "P06", "P07"}
        orch, job, _ = _build_orchestrator(all_shards, lagging_shard="P07")
        # Make _single_audio_chunk_shards return predictable shards.
        with patch.object(orch, "_single_audio_chunk_shards", return_value=list(sorted(all_shards))), \
             patch.object(orch, "_ensure_step_enqueued") as ensure:
            # WAVs needed to exist for the helper to proceed past the
            # disk check — pretend they all do.
            with patch("factory_v2.shared.course_tts_chunks.single_chunk_wav_path") as wav_path:
                fake = type("F", (), {"is_file": lambda self: True})()
                wav_path.return_value = fake
                result = orch._maybe_fan_out_single_audio_qc(
                    job, "job-1", "job-1-r6", just_succeeded_shard="P07",
                )
        self.assertTrue(result, "Expected fan-out to proceed with the just-succeeded shard")
        # Should have enqueued 7 QC chunks.
        qc_enqueues = [
            call for call in ensure.call_args_list
            if call.kwargs.get("shard_key") and SINGLE_AUDIO_QC_STEP in call.args
        ]
        self.assertEqual(
            len(qc_enqueues), 7,
            f"Expected 7 QC chunks enqueued, got {len(qc_enqueues)}",
        )

    def test_qc_fanout_without_just_succeeded_shard_misses_stale_index_case(self) -> None:
        """Without ``just_succeeded_shard``, the helper relies entirely on
        the index. A stale index means it returns False — exactly the
        production failure mode this fix prevents. This test pins that
        behavior so we don't accidentally make the helper *also* tolerant
        in a way that hides the contract: callers MUST pass the shard."""
        all_shards = {"P01", "P02", "P03", "P04", "P05", "P06", "P07"}
        orch, job, _ = _build_orchestrator(all_shards, lagging_shard="P07")
        with patch.object(orch, "_single_audio_chunk_shards", return_value=list(sorted(all_shards))), \
             patch.object(orch, "_ensure_step_enqueued") as ensure:
            result = orch._maybe_fan_out_single_audio_qc(
                job, "job-1", "job-1-r6",
                # NOT passing just_succeeded_shard
            )
        self.assertFalse(result, "Without just_succeeded_shard, stale index causes early return")
        self.assertEqual(len(ensure.call_args_list), 0, "Nothing should be enqueued")

    def test_qc_fanout_returns_false_when_genuinely_not_all_synth_done(self) -> None:
        """Sanity: even with just_succeeded_shard, if other shards are
        genuinely still pending (not just lagging in the index), we should
        wait — not enqueue prematurely."""
        # Only 5 of 7 done; P03 and P04 not yet run at all.
        partially_done = {"P01", "P02", "P05", "P06", "P07"}
        orch, job, _ = _build_orchestrator(partially_done)
        with patch.object(
            orch, "_single_audio_chunk_shards",
            return_value=["P01", "P02", "P03", "P04", "P05", "P06", "P07"],
        ), patch.object(orch, "_ensure_step_enqueued") as ensure:
            result = orch._maybe_fan_out_single_audio_qc(
                job, "job-1", "job-1-r6", just_succeeded_shard="P07",
            )
        self.assertFalse(result, "Should wait for genuinely missing shards")
        self.assertEqual(len(ensure.call_args_list), 0)

    # ------------------ _maybe_enqueue_single_audio_assembly ------------------
    # Same race in the non-QC path; the parameter was added there too.

    def test_assembly_enqueues_when_just_succeeded_shard_passed_even_if_index_is_stale(self) -> None:
        all_shards = {"P01", "P02", "P03", "P04", "P05", "P06", "P07"}
        orch, job, _ = _build_orchestrator(all_shards, lagging_shard="P07")
        with patch.object(orch, "_single_audio_chunk_shards", return_value=list(sorted(all_shards))), \
             patch.object(orch, "_ensure_step_enqueued") as ensure:
            result = orch._maybe_enqueue_single_audio_assembly(
                job, "job-1", "job-1-r6", just_succeeded_shard="P07",
            )
        self.assertTrue(result, "Assembly should enqueue with just-succeeded shard hint")
        # Should enqueue exactly one assemble_audio.
        self.assertEqual(len(ensure.call_args_list), 1)


if __name__ == "__main__":
    unittest.main()
