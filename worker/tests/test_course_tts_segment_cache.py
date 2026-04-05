from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
import wave
from unittest.mock import patch

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

import factory_v2.shared.tts_converter as tts_converter
from factory_v2.shared.tts_converter import convert_to_audio
from factory_v2.steps.base import StepContext
from factory_v2.steps.course_synthesis import execute_synthesize_course_audio_chunk
from factory_v2.shared.course_tts_chunks import cleanup_session_temp_dir


def _write_wav(path: str, frame_count: int) -> None:
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(8_000)
        wf.writeframes(b"\x01\x02" * max(1, frame_count))


class _FakeTts:
    def __init__(self):
        self.calls: list[str] = []

    def load(self, _model_dir: str, _voice_id: str) -> None:
        return None

    def unload(self) -> None:
        return None

    def synthesize(self, text: str, output_path: str) -> None:
        self.calls.append(text)
        _write_wav(output_path, len(text.encode("utf-8")) * 20)


class _DeletingFakeTts(_FakeTts):
    def synthesize(self, text: str, output_path: str) -> None:
        super().synthesize(text, output_path)
        if len(self.calls) < 2:
            return
        first_part = os.path.join(os.path.dirname(output_path), "part_0000.wav")
        if os.path.exists(first_part):
            os.remove(first_part)


class _FakeBlob:
    def __init__(self, path: str):
        self.path = path
        self.metadata = None
        self.cache_control = None
        self._content: bytes | None = None

    def exists(self) -> bool:
        return self._content is not None

    def reload(self) -> None:
        return None

    def upload_from_filename(self, filename: str, content_type: str | None = None, retry=None, timeout=None) -> None:
        with open(filename, "rb") as handle:
            self._content = handle.read()

    def download_to_filename(self, filename: str) -> None:
        if self._content is None:
            raise FileNotFoundError(self.path)
        with open(filename, "wb") as handle:
            handle.write(self._content)

    def patch(self) -> None:
        return None


class _FakeBucket:
    def __init__(self):
        self._blobs: dict[str, _FakeBlob] = {}

    def blob(self, path: str) -> _FakeBlob:
        if path not in self._blobs:
            self._blobs[path] = _FakeBlob(path)
        return self._blobs[path]


class CourseTtsSegmentCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        tts_converter._cached_tts = None
        tts_converter._cached_tts_id = None
        tts_converter._cached_voice_id = None
        self._output_paths: list[str] = []

    def tearDown(self) -> None:
        for path in self._output_paths:
            shutil.rmtree(os.path.dirname(path), ignore_errors=True)
        tts_converter._cached_tts = None
        tts_converter._cached_tts_id = None
        tts_converter._cached_voice_id = None

    def test_convert_to_audio_reuses_cached_course_segments_after_pause_edit(self) -> None:
        fake_tts = _FakeTts()
        fake_bucket = _FakeBucket()
        job_data = {
            "ttsBackend": "local",
            "ttsModel": "demo-tts",
            "ttsVoice": "voice-a",
            "_factoryContentJobId": "content-123",
            "_courseTtsSessionCode": "CBT101M1P",
        }

        with patch("factory_v2.shared.tts_converter.get_tts", return_value=fake_tts), patch(
            "factory_v2.shared.course_tts_segment_cache.storage.bucket",
            return_value=fake_bucket,
        ):
            first_output = convert_to_audio(
                "Hello there. [PAUSE 1s] We are aiming for calm.",
                job_data,
            )
            second_output = convert_to_audio(
                "Hello again. [PAUSE 1s] We are aiming for calm.",
                job_data,
            )

        self._output_paths.extend([first_output, second_output])
        self.assertEqual(
            fake_tts.calls,
            [
                "Hello there.",
                "We are aiming for calm.",
                "Hello again.",
            ],
        )
        self.assertEqual(len(fake_bucket._blobs), 3)

    def test_convert_to_audio_uses_stable_concat_copies_when_original_parts_disappear(self) -> None:
        fake_tts = _DeletingFakeTts()

        with patch("factory_v2.shared.tts_converter.get_tts", return_value=fake_tts):
            output_path = convert_to_audio(
                "Hello there. [PAUSE 1s] We are aiming for calm.",
                {
                    "ttsModel": "demo-tts",
                    "ttsVoice": "voice-a",
                },
            )

        self._output_paths.append(output_path)
        self.assertTrue(os.path.exists(output_path))
        self.assertEqual(
            fake_tts.calls,
            [
                "Hello there.",
                "We are aiming for calm.",
            ],
        )

    def test_course_chunk_step_passes_course_cache_context_to_tts_converter(self) -> None:
        captured_job_data: list[dict] = []

        def _fake_convert(_script: str, job_data: dict) -> str:
            captured_job_data.append(dict(job_data))
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            _write_wav(output_path, 200)
            return output_path

        job = {
            "id": "factory-job-1",
            "request": {
                "content_job": {
                    "params": {"courseCode": "CBT101"},
                    "ttsBackend": "local",
                    "ttsModel": "demo-tts",
                    "ttsVoice": "voice-a",
                },
                "compat": {"content_job_id": "content-123"},
            },
            "runtime": {
                "course_formatted_scripts": {
                    "CBT101M1P": "Hello there. [PAUSE 1s] We are aiming for calm.",
                }
            },
        }

        try:
            with patch("factory_v2.shared.tts_converter.convert_to_audio", side_effect=_fake_convert):
                execute_synthesize_course_audio_chunk(
                    StepContext(
                        db=None,
                        job=job,
                        run_id="run-123",
                        step_name="synthesize_course_audio_chunk",
                        worker_id="worker-1",
                        shard_key="M1P-P01",
                        step_input={"session_shard": "M1P", "chunk_index": 0},
                    )
                )
        finally:
            cleanup_session_temp_dir("run-123", "CBT101M1P")

        self.assertEqual(len(captured_job_data), 1)
        self.assertEqual(captured_job_data[0]["_factoryContentJobId"], "content-123")
        self.assertEqual(captured_job_data[0]["_courseTtsSessionCode"], "CBT101M1P")


if __name__ == "__main__":
    unittest.main()
