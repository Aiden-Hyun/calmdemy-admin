from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.steps.base import StepContext
from factory_v2.steps.course_planning import execute_generate_course_thumbnail


class CourseThumbnailGenerationTests(unittest.TestCase):
    def test_thumbnail_regeneration_rebuilds_prompt_instead_of_reusing_saved_one(self) -> None:
        job = {
            "request": {
                "content_job": {
                    "params": {
                        "courseTitle": "Mastery Through Case Studies",
                        "topic": "Case-study based CBT practice",
                    },
                    "contentType": "course",
                    "coursePlan": {
                        "courseTitle": "Mastery Through Case Studies",
                        "modules": [],
                    },
                    "imagePrompt": "Old saved prompt",
                    "thumbnailGenerationRequested": True,
                },
                "compat": {"content_job_id": "job-123"},
            },
            "runtime": {
                "course_plan": {
                    "courseTitle": "Mastery Through Case Studies",
                    "modules": [],
                },
                "image_prompt": "Old saved prompt",
                "thumbnail_generation_requested": True,
                "thumbnail_url": "https://old.example.com/thumb.png",
            },
        }

        with (
            patch(
                "factory_v2.shared.image_generator.build_image_prompt",
                return_value="New regenerated prompt",
            ) as build_image_prompt,
            patch(
                "factory_v2.shared.image_generator.generate_image",
                return_value="/tmp/generated.png",
            ) as generate_image,
            patch(
                "factory_v2.shared.storage_uploader.upload_image",
                return_value=("images/meditate/courses/job-123-generatecoursethumbnail.png", "https://new.example.com/thumb.png"),
            ) as upload_image,
        ):
            result = execute_generate_course_thumbnail(
                StepContext(
                    db=None,
                    job=job,
                    run_id="run-1",
                    step_name="generate_course_thumbnail",
                    worker_id="local-image",
                )
            )

        build_image_prompt.assert_called_once()
        generate_image.assert_called_once_with("New regenerated prompt")
        upload_image.assert_called_once()
        self.assertEqual(result.runtime_patch["image_prompt"], "New regenerated prompt")
        self.assertEqual(result.compat_content_job_patch["imagePrompt"], "New regenerated prompt")
        self.assertEqual(result.compat_content_job_patch["thumbnailUrl"], "https://new.example.com/thumb.png")

    def test_thumbnail_step_raises_when_image_generation_fails(self) -> None:
        job = {
            "request": {
                "content_job": {
                    "params": {
                        "courseTitle": "Mastery Through Case Studies",
                        "topic": "Case-study based CBT practice",
                    },
                    "contentType": "course",
                    "coursePlan": {
                        "courseTitle": "Mastery Through Case Studies",
                        "modules": [],
                    },
                },
                "compat": {"content_job_id": "job-123"},
            },
            "runtime": {
                "course_plan": {
                    "courseTitle": "Mastery Through Case Studies",
                    "modules": [],
                },
                "thumbnail_generation_requested": True,
            },
        }

        with (
            patch(
                "factory_v2.shared.image_generator.build_image_prompt",
                return_value="A magnifying glass hovering over a detailed case study page.",
            ),
            patch(
                "factory_v2.shared.image_generator.generate_image",
                side_effect=RuntimeError("generation boom"),
            ),
            patch("factory_v2.shared.storage_uploader.upload_image") as upload_image,
        ):
            with self.assertRaisesRegex(RuntimeError, "generation boom"):
                execute_generate_course_thumbnail(
                    StepContext(
                        db=None,
                        job=job,
                        run_id="run-1",
                        step_name="generate_course_thumbnail",
                        worker_id="local-image",
                    )
                )

        upload_image.assert_not_called()


if __name__ == "__main__":
    unittest.main()
