from __future__ import annotations

import copy
import os
import sys
import unittest
from unittest.mock import patch

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.application.orchestrator import Orchestrator
from factory_v2.interfaces.bootstrap import bootstrap_from_content_job
from factory_v2.steps.base import StepContext
from factory_v2.steps.course_common import SESSION_DEFS
from factory_v2.steps.course_scripts import execute_generate_course_scripts
from factory_v2.steps.single_content import execute_generate_script


def _build_plan() -> dict:
    return {
        "courseGoal": "Help learners practice calm thinking.",
        "intro": {"title": "Course Intro", "outline": "Welcome."},
        "modules": [
            {
                "moduleTitle": f"Module {index}",
                "lessonTitle": f"Lesson {index}",
                "lessonSummary": "Lesson summary",
                "objective": "Objective",
                "practiceTitle": f"Practice {index}",
                "practiceType": "guided exercise",
                "reflectionPrompts": ["Prompt"],
                "keyTakeaway": "Takeaway",
            }
            for index in range(1, 5)
        ],
    }


def _build_raw_scripts(course_code: str) -> dict[str, str]:
    return {
        f"{course_code}{session_def['suffix']}": f"Script for {session_def['label']}"
        for session_def in SESSION_DEFS
    }


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

    def get(self):
        data = self._db._collections.get(self._collection_name, {}).get(self.id)
        return _FakeSnapshot(self, data)

    def set(self, payload: dict, merge: bool = False):
        collection = self._db._collections.setdefault(self._collection_name, {})
        if merge:
            collection[self.id] = {**collection.get(self.id, {}), **copy.deepcopy(payload)}
        else:
            collection[self.id] = copy.deepcopy(payload)

    def create(self, payload: dict):
        collection = self._db._collections.setdefault(self._collection_name, {})
        if self.id in collection:
            raise AssertionError(f"Document already exists: {self._collection_name}/{self.id}")
        collection[self.id] = copy.deepcopy(payload)

    def update(self, payload: dict):
        collection = self._db._collections.setdefault(self._collection_name, {})
        collection[self.id] = {**collection.get(self.id, {}), **copy.deepcopy(payload)}


class _FakeCollection:
    def __init__(self, db, name: str):
        self._db = db
        self._name = name

    def document(self, doc_id: str):
        return _FakeDocRef(self._db, self._name, doc_id)


class _FakeDB:
    def __init__(self, collections: dict[str, dict[str, dict]] | None = None):
        self._collections = copy.deepcopy(collections or {})

    def collection(self, name: str):
        return _FakeCollection(self, name)


class _RecordingJobRepo:
    def __init__(self, job: dict):
        self._job = copy.deepcopy(job)
        self.completed_calls: list[tuple[str, str]] = []
        self.compat_patches: list[tuple[str, str, dict]] = []

    def get(self, job_id: str) -> dict:
        return copy.deepcopy(self._job)

    def mark_completed(self, job_id: str, run_id: str) -> None:
        self.completed_calls.append((job_id, run_id))

    def patch_compat_content_job_for_run(self, content_job_id: str, run_id: str, patch: dict) -> bool:
        self.compat_patches.append((content_job_id, run_id, copy.deepcopy(patch)))
        return True


class _RecordingRunRepo:
    def __init__(self):
        self.completed_calls: list[str] = []

    def mark_completed(self, run_id: str) -> None:
        self.completed_calls.append(run_id)


class _UnusedStepRunRepo:
    pass


class _UnusedQueueRepo:
    pass


class _ConfigurableStepRunRepo:
    def __init__(self, succeeded: set[tuple[str, str, str]] | None = None):
        self._succeeded = set(succeeded or set())
        self._ready: dict[str, tuple[str, str, str]] = {}

    def has_succeeded(self, job_id: str, run_id: str, step_name: str) -> bool:
        return (job_id, run_id, step_name) in self._succeeded

    def ensure_ready(self, job_id: str, run_id: str, step_name: str, shard_key: str = "root") -> str:
        step_run_id = f"{run_id}__{step_name}__{shard_key}"
        self._ready[step_run_id] = (job_id, run_id, step_name)
        return step_run_id

    def mark_succeeded_from_checkpoint(self, step_run_id: str, _output: dict) -> None:
        payload = self._ready.get(step_run_id)
        if payload:
            self._succeeded.add(payload)


class CourseScriptApprovalTests(unittest.TestCase):
    def test_initial_course_script_approval_pauses_after_script_generation(self) -> None:
        course_code = "CBT101"
        raw_scripts = _build_raw_scripts(course_code)
        job = {
            "id": "job-1",
            "request": {
                "content_job": {
                    "params": {"courseCode": course_code},
                    "coursePlan": _build_plan(),
                    "courseRawScripts": raw_scripts,
                    "courseScriptApproval": {"enabled": True},
                }
            },
            "runtime": {
                "course_plan": _build_plan(),
                "course_raw_scripts": raw_scripts,
            },
        }

        result = execute_generate_course_scripts(
            StepContext(
                db=None,
                job=job,
                run_id="run-1",
                step_name="generate_course_scripts",
                worker_id="worker-1",
            )
        )

        self.assertTrue(result.output["awaiting_script_approval"])
        self.assertTrue(result.runtime_patch["course_script_approval"]["awaitingApproval"])
        self.assertEqual(result.compat_content_job_patch["status"], "completed")
        self.assertIn("Scripts ready for approval", result.compat_content_job_patch["courseProgress"])

    def test_bootstrap_resumes_at_formatting_after_initial_script_approval(self) -> None:
        content_job_id = "job-1"
        db = _FakeDB({"content_jobs": {content_job_id: {}}})
        content_job = {
            "contentType": "course",
            "status": "pending",
            "courseRawScripts": _build_raw_scripts("CBT101"),
            "courseScriptApproval": {
                "enabled": True,
                "awaitingApproval": False,
                "scriptApprovedBy": "admin-1",
            },
        }

        with patch(
            "factory_v2.interfaces.bootstrap.Orchestrator.start_new_run",
            return_value="run-123",
        ) as start_new_run:
            run_id = bootstrap_from_content_job(db, content_job_id, content_job)

        self.assertEqual(run_id, "run-123")
        self.assertEqual(start_new_run.call_args.kwargs["first_step"], "format_course_scripts")

    def test_bootstrap_restarts_at_script_generation_when_initial_scripts_are_regenerated(self) -> None:
        content_job_id = "job-1"
        db = _FakeDB({"content_jobs": {content_job_id: {}}})
        content_job = {
            "contentType": "course",
            "status": "pending",
            "coursePlan": _build_plan(),
            "courseScriptApproval": {
                "enabled": True,
                "awaitingApproval": False,
                "scriptApprovedBy": None,
                "scriptApprovedAt": None,
            },
        }

        with patch(
            "factory_v2.interfaces.bootstrap.Orchestrator.start_new_run",
            return_value="run-456",
        ) as start_new_run:
            run_id = bootstrap_from_content_job(db, content_job_id, content_job)

        self.assertEqual(run_id, "run-456")
        self.assertEqual(start_new_run.call_args.kwargs["first_step"], "generate_course_scripts")

    def test_bootstrap_enqueues_thumbnail_when_resuming_without_one(self) -> None:
        content_job_id = "job-1"
        db = _FakeDB({"content_jobs": {content_job_id: {}}})
        content_job = {
            "contentType": "course",
            "status": "pending",
            "coursePlan": _build_plan(),
            "courseScriptApproval": {
                "enabled": True,
                "awaitingApproval": False,
                "scriptApprovedBy": "admin-1",
            },
        }

        with patch(
            "factory_v2.interfaces.bootstrap.Orchestrator.start_new_run",
            return_value="run-789",
        ) as start_new_run, patch(
            "factory_v2.interfaces.bootstrap.Orchestrator._ensure_step_enqueued",
        ) as ensure_step_enqueued:
            run_id = bootstrap_from_content_job(db, content_job_id, content_job)

        self.assertEqual(run_id, "run-789")
        self.assertEqual(start_new_run.call_args.kwargs["first_step"], "format_course_scripts")
        self.assertEqual(ensure_step_enqueued.call_args.args[-2:], ("run-789", "generate_course_thumbnail"))

    def test_bootstrap_skips_thumbnail_enqueue_when_course_defers_it(self) -> None:
        content_job_id = "job-1"
        db = _FakeDB({"content_jobs": {content_job_id: {}}})
        content_job = {
            "contentType": "course",
            "status": "pending",
            "generateThumbnailDuringRun": False,
            "coursePlan": _build_plan(),
            "courseScriptApproval": {
                "enabled": True,
                "awaitingApproval": False,
                "scriptApprovedBy": "admin-1",
            },
        }

        with patch(
            "factory_v2.interfaces.bootstrap.Orchestrator.start_new_run",
            return_value="run-790",
        ) as start_new_run, patch(
            "factory_v2.interfaces.bootstrap.Orchestrator._ensure_step_enqueued",
        ) as ensure_step_enqueued:
            run_id = bootstrap_from_content_job(db, content_job_id, content_job)

        self.assertEqual(run_id, "run-790")
        self.assertEqual(start_new_run.call_args.kwargs["first_step"], "format_course_scripts")
        ensure_step_enqueued.assert_not_called()

    def test_bootstrap_starts_thumbnail_only_run_when_requested(self) -> None:
        content_job_id = "job-1"
        db = _FakeDB({"content_jobs": {content_job_id: {}}})
        content_job = {
            "contentType": "course",
            "status": "pending",
            "thumbnailGenerationRequested": True,
            "coursePlan": _build_plan(),
            "courseAudioResults": {
                "CBT101INT": {"storagePath": "audio/test.mp3", "durationSec": 60}
            },
        }

        with patch(
            "factory_v2.interfaces.bootstrap.Orchestrator.start_new_run",
            return_value="run-791",
        ) as start_new_run:
            run_id = bootstrap_from_content_job(db, content_job_id, content_job)

        self.assertEqual(run_id, "run-791")
        self.assertEqual(start_new_run.call_args.kwargs["first_step"], "generate_course_thumbnail")

    def test_orchestrator_marks_run_complete_when_initial_script_approval_is_waiting(self) -> None:
        job = {
            "job_type": "course",
            "runtime": {"course_script_approval": {"enabled": True, "awaitingApproval": True}},
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_UnusedStepRunRepo(),
            queue_repo=_UnusedQueueRepo(),
        )

        orchestrator.on_step_success("job-1", "run-1", "generate_course_scripts")

        self.assertEqual(job_repo.completed_calls, [("job-1", "run-1")])
        self.assertEqual(run_repo.completed_calls, ["run-1"])

    def test_orchestrator_allows_publish_after_upload_when_thumbnail_is_deferred(self) -> None:
        job = {
            "job_type": "course",
            "runtime": {"generate_thumbnail_during_run": False},
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_ConfigurableStepRunRepo(),
            queue_repo=_UnusedQueueRepo(),
        )

        with patch.object(orchestrator, "_ensure_step_enqueued") as ensure_step_enqueued:
            orchestrator.on_step_success("job-1", "run-1", "upload_course_audio")

        ensure_step_enqueued.assert_called_once()
        self.assertEqual(ensure_step_enqueued.call_args.args[-2:], ("run-1", "publish_course"))

    def test_orchestrator_waits_for_regenerated_thumbnail_before_publish(self) -> None:
        job = {
            "job_type": "course",
            "runtime": {"thumbnail_generation_requested": True},
            "request": {
                "content_job": {
                    "thumbnailGenerationRequested": True,
                    "thumbnailUrl": "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80",
                }
            },
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_ConfigurableStepRunRepo(),
            queue_repo=_UnusedQueueRepo(),
        )

        with patch.object(orchestrator, "_ensure_step_enqueued") as ensure_step_enqueued:
            orchestrator.on_step_success("job-1", "run-1", "upload_course_audio")

        ensure_step_enqueued.assert_not_called()

    def test_recovery_waits_for_regenerated_thumbnail_before_publish(self) -> None:
        job = {
            "job_type": "course",
            "runtime": {
                "thumbnail_generation_requested": True,
                "thumbnail_url": "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80",
            },
            "request": {
                "content_job": {
                    "thumbnailGenerationRequested": True,
                    "thumbnailUrl": "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80",
                }
            },
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_ConfigurableStepRunRepo({("job-1", "run-1", "upload_course_audio")}),
            queue_repo=_UnusedQueueRepo(),
        )

        with patch.object(orchestrator, "_ensure_step_enqueued") as ensure_step_enqueued:
            recovered = orchestrator.recover_course_publish_if_ready("job-1", "run-1")

        self.assertFalse(recovered)
        ensure_step_enqueued.assert_not_called()

    def test_recovery_finalizes_published_thumbnail_regeneration_without_recomputing_timing(self) -> None:
        job = {
            "job_type": "course",
            "summary": {"currentStep": "publish_course"},
            "runtime": {
                "thumbnail_generation_requested": True,
                "course_id": "course-123",
                "course_session_ids": ["session-1", "session-2"],
                "thumbnail_url": "https://cdn.example.com/thumb.jpg",
            },
            "request": {
                "compat": {"content_job_id": "content-1"},
                "content_job": {
                    "thumbnailGenerationRequested": True,
                },
            },
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_ConfigurableStepRunRepo(
                {
                    ("job-1", "run-1", "upload_course_audio"),
                    ("job-1", "run-1", "publish_course"),
                }
            ),
            queue_repo=_UnusedQueueRepo(),
        )

        with (
            patch.object(orchestrator, "_seed_course_checkpoint_steps"),
            patch.object(orchestrator, "_finalize_completed_job") as finalize_completed_job,
        ):
            recovered = orchestrator.recover_course_publish_if_ready("job-1", "run-1")

        self.assertTrue(recovered)
        self.assertEqual(job_repo.completed_calls, [("job-1", "run-1")])
        self.assertEqual(run_repo.completed_calls, ["run-1"])
        self.assertEqual(job_repo.compat_patches[0][0], "content-1")
        self.assertEqual(job_repo.compat_patches[0][1], "run-1")
        self.assertEqual(job_repo.compat_patches[0][2]["status"], "completed")
        self.assertEqual(job_repo.compat_patches[0][2]["courseProgress"], "Published")
        self.assertEqual(job_repo.compat_patches[0][2]["thumbnailGenerationRequested"], False)
        self.assertIsNone(job_repo.compat_patches[0][2]["error"])
        finalize_completed_job.assert_not_called()

    def test_thumbnail_only_course_run_completes_without_recomputing_timing(self) -> None:
        job = {
            "job_type": "course",
            "runtime": {"thumbnail_generation_requested": True},
            "request": {"content_job": {"thumbnailGenerationRequested": True}},
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_ConfigurableStepRunRepo(),
            queue_repo=_UnusedQueueRepo(),
        )

        with patch.object(orchestrator, "_finalize_completed_job") as finalize_completed_job:
            orchestrator.on_step_success("job-1", "run-1", "generate_course_thumbnail")

        self.assertEqual(job_repo.completed_calls, [("job-1", "run-1")])
        self.assertEqual(run_repo.completed_calls, ["run-1"])
        finalize_completed_job.assert_not_called()


class SingleContentScriptApprovalTests(unittest.TestCase):
    def test_single_script_approval_pauses_after_script_generation(self) -> None:
        job = {
            "id": "job-2",
            "request": {
                "content_job": {
                    "contentType": "guided_meditation",
                    "params": {"topic": "Relaxation"},
                    "title": "Relaxation",
                    "scriptApproval": {"enabled": True},
                }
            },
            "runtime": {
                "generated_script": "A calm script for testing.",
                "generated_title": "Relaxation",
            },
        }

        result = execute_generate_script(
            StepContext(
                db=None,
                job=job,
                run_id="run-2",
                step_name="generate_script",
                worker_id="worker-1",
            )
        )

        self.assertTrue(result.output["awaiting_script_approval"])
        self.assertTrue(result.runtime_patch["script_approval"]["awaitingApproval"])
        self.assertEqual(result.compat_content_job_patch["status"], "completed")
        self.assertEqual(result.compat_content_job_patch["generatedScript"], "A calm script for testing.")

    def test_bootstrap_resumes_single_content_at_format_after_script_approval(self) -> None:
        content_job_id = "job-2"
        db = _FakeDB({"content_jobs": {content_job_id: {}}})
        content_job = {
            "contentType": "guided_meditation",
            "status": "pending",
            "generatedScript": "Already approved script",
            "scriptApproval": {
                "enabled": True,
                "awaitingApproval": False,
                "scriptApprovedBy": "admin-1",
            },
        }

        with patch(
            "factory_v2.interfaces.bootstrap.Orchestrator.start_new_run",
            return_value="run-222",
        ) as start_new_run:
            run_id = bootstrap_from_content_job(db, content_job_id, content_job)

        self.assertEqual(run_id, "run-222")
        self.assertEqual(start_new_run.call_args.kwargs["first_step"], "format_script")

    def test_orchestrator_marks_single_run_complete_when_script_approval_is_waiting(self) -> None:
        job = {
            "job_type": "single_content",
            "runtime": {"script_approval": {"enabled": True, "awaitingApproval": True}},
        }
        job_repo = _RecordingJobRepo(job)
        run_repo = _RecordingRunRepo()
        orchestrator = Orchestrator(
            job_repo=job_repo,
            run_repo=run_repo,
            step_run_repo=_UnusedStepRunRepo(),
            queue_repo=_UnusedQueueRepo(),
        )

        orchestrator.on_step_success("job-2", "run-2", "generate_script")

        self.assertEqual(job_repo.completed_calls, [("job-2", "run-2")])
        self.assertEqual(run_repo.completed_calls, ["run-2"])


if __name__ == "__main__":
    unittest.main()
