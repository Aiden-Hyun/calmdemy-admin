"""Tests for the qc_audio_chunk step executor.

Mocks Whisper so the test doesn't need torch / model weights. The QC
algorithm itself is tested separately in transcriber/test_qc.py.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class _FakeWhisperModel:
    """Returns a canned transcript regardless of audio. Just here to satisfy
    the executor's interface; the QC verdict comes from comparing this
    transcript against the chunk source text."""

    def __init__(self, transcript: str, language: str = "en", duration: float = 5.0):
        self.transcript = transcript
        self.language = language
        self.duration = duration
        self.transcribe_calls = 0

    def transcribe(self, *args, **kwargs):
        self.transcribe_calls += 1
        return {
            "text": self.transcript,
            "language": self.language,
            "segments": [{"end": self.duration}],
        }


class _FakeContext:
    def __init__(
        self,
        *,
        run_id: str,
        shard_key: str,
        chunk_index: int,
        formatted_script: str,
        chunk_qc_runtime: dict | None = None,
        job_id: str = "job-test-1",
        language: str = "en",
    ):
        self.run_id = run_id
        self.shard_key = shard_key
        self.step_input = {"chunk_index": chunk_index}
        self.job = {
            "id": job_id,
            "request": {
                "content_job": {"language": language},
            },
            "runtime": {
                "formatted_script": formatted_script,
                "chunk_qc": chunk_qc_runtime or {},
            },
        }
        self.progress_messages: list[str] = []

    def progress(self, detail: str | None = None) -> None:
        if detail:
            self.progress_messages.append(detail)


class QcAudioChunkExecutorTest(unittest.TestCase):
    def _run_with_mocks(
        self,
        *,
        chunk_text: str,
        whisper_transcript: str,
        prior_attempts: int = 0,
        whisper_language: str = "en",
        whisper_duration: float = 5.0,
        expected_language: str = "en",
    ):
        """Build a context, write a placeholder chunk WAV, mock Whisper,
        and call the executor. Return (StepResult, fake_model)."""
        from factory_v2.shared.course_tts_chunks import (
            make_single_chunk_shard_key,
            single_chunk_wav_path,
        )

        chunk_index = 0
        run_id = f"run-{os.getpid()}-{whisper_transcript[:8]}"
        shard = make_single_chunk_shard_key(chunk_index)
        wav_path = single_chunk_wav_path(run_id, chunk_index)
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        # Empty placeholder — Whisper is mocked, so it never reads real bytes.
        wav_path.write_bytes(b"")

        chunk_qc_runtime = {}
        if prior_attempts:
            chunk_qc_runtime[str(chunk_index)] = {"attempts": prior_attempts}

        ctx = _FakeContext(
            run_id=run_id,
            shard_key=shard,
            chunk_index=chunk_index,
            formatted_script=chunk_text,
            chunk_qc_runtime=chunk_qc_runtime,
            language=expected_language,
        )

        fake_model = _FakeWhisperModel(
            whisper_transcript,
            language=whisper_language,
            duration=whisper_duration,
        )

        # Patch the chunk splitter so we get exactly one chunk = chunk_text.
        # This avoids fighting the real chunker's heuristics in the test.
        from factory_v2.steps import single_content as sc

        with patch.object(sc, "_qc_get_whisper_model", return_value=fake_model), \
             patch("factory_v2.shared.course_tts_chunks.split_course_tts_chunks", return_value=[chunk_text]):
            result = sc.execute_qc_audio_chunk(ctx)

        # Cleanup
        try:
            wav_path.unlink()
        except FileNotFoundError:
            pass

        return result, fake_model

    def test_pass_when_transcript_matches_source(self):
        result, model = self._run_with_mocks(
            chunk_text="Take a deep breath and let it go.",
            whisper_transcript="Take a deep breath and let it go.",
            whisper_duration=4.0,
        )
        self.assertEqual(model.transcribe_calls, 1)
        self.assertEqual(result.output["verdict"], "PASS")
        self.assertEqual(result.output["issue_count"], 0)
        self.assertEqual(result.output["attempt"], 1)
        # Runtime patch uses dotted key so siblings aren't clobbered.
        self.assertIn("chunk_qc.0", result.runtime_patch)
        payload = result.runtime_patch["chunk_qc.0"]
        self.assertEqual(payload["verdict"], "PASS")
        self.assertEqual(payload["attempts"], 1)

    def test_review_on_single_mispronunciation(self):
        result, _ = self._run_with_mocks(
            chunk_text="The stillness brings clarity.",
            whisper_transcript="The stoneness brings clarity.",
            whisper_duration=3.0,
        )
        self.assertEqual(result.output["verdict"], "REVIEW")
        self.assertEqual(result.output["issue_count"], 1)

    def test_fail_on_dropped_run(self):
        result, _ = self._run_with_mocks(
            chunk_text="Inhale deeply. Hold. Now release the breath fully and slowly.",
            whisper_transcript="Inhale deeply. Hold.",
            whisper_duration=3.0,
        )
        self.assertEqual(result.output["verdict"], "FAIL")

    def test_attempt_counter_advances(self):
        result, _ = self._run_with_mocks(
            chunk_text="Breathe in slowly.",
            whisper_transcript="Breathe in slowly.",
            prior_attempts=2,
            whisper_duration=2.0,
        )
        self.assertEqual(result.output["attempt"], 3)
        payload = result.runtime_patch["chunk_qc.0"]
        self.assertEqual(payload["attempts"], 3)

    def test_language_mismatch_fails(self):
        result, _ = self._run_with_mocks(
            chunk_text="Breathe in.",
            whisper_transcript="Atem ein.",
            whisper_language="de",
            whisper_duration=1.5,
            expected_language="en",
        )
        self.assertEqual(result.output["verdict"], "FAIL")
        self.assertEqual(result.runtime_patch["chunk_qc.0"]["detected_language"], "de")

    def test_summary_patch_marks_current_step(self):
        result, _ = self._run_with_mocks(
            chunk_text="Hello.",
            whisper_transcript="Hello.",
            whisper_duration=1.0,
        )
        self.assertEqual(result.summary_patch["currentStep"], "qc_audio_chunk")


if __name__ == "__main__":
    unittest.main()
