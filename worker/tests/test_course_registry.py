from __future__ import annotations

import os
import sys
import unittest

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.steps.registry import get_executor


class CourseRegistryTests(unittest.TestCase):
    def test_course_executors_remain_registered(self) -> None:
        for step_name in (
            "generate_course_plan",
            "generate_course_thumbnail",
            "generate_course_scripts",
            "format_course_scripts",
            "synthesize_course_audio_chunk",
            "synthesize_course_audio",
            "upload_course_audio",
            "publish_course",
        ):
            self.assertTrue(callable(get_executor(step_name)), step_name)


if __name__ == "__main__":
    unittest.main()
