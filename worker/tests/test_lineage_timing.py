from __future__ import annotations

import copy
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

from firebase_admin import firestore as fs

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.shared.lineage_timing import build_artifact_updates, finalize_job_timing


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
        raise AssertionError(f"Unsupported operator: {op}")


class _FakeCollection:
    def __init__(self, db, collection_name: str):
        self._db = db
        self._collection_name = collection_name

    def document(self, doc_id: str):
        return _FakeDocRef(self._db, self._collection_name, doc_id)

    def where(self, field: str, op: str, value):
        return _FakeQuery(self._db, self._collection_name).where(field, op, value)


class _FakeDB:
    def __init__(self, collections: dict[str, dict[str, dict]] | None = None):
        self._collections = copy.deepcopy(collections or {})

    def collection(self, name: str):
        return _FakeCollection(self, name)


def _dt(seconds: int) -> datetime:
    return datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc) + timedelta(seconds=seconds)


def _step_run(run_id: str, job_id: str, step_name: str, start_sec: int, end_sec: int) -> dict:
    return {
        "job_id": job_id,
        "run_id": run_id,
        "step_name": step_name,
        "state": "succeeded",
        "worker_id": "worker-1",
        "started_at": _dt(start_sec),
        "ended_at": _dt(end_sec),
    }


def _course_job_with_artifacts(artifacts: dict[str, dict]) -> dict:
    return {
        "job_type": "course",
        "request": {"compat": {"content_job_id": "content-1"}},
        "runtime": {
            "artifacts": artifacts,
            "course_id": "course-live-1",
            "course_session_ids": ["session-1"],
        },
    }


class LineageTimingTests(unittest.TestCase):
    def test_build_artifact_updates_only_rewrites_changed_course_scripts(self) -> None:
        before_job = {
            "id": "job-1",
            "job_type": "course",
            "request": {"content_job": {"params": {"courseCode": "CBT101"}}},
            "runtime": {
                "course_raw_scripts": {
                    "CBT101INT": "Keep me",
                    "CBT101M1L": "Replace me",
                },
                "artifacts": {
                    "course.raw_script.CBT101INT": {
                        "origin_step_run_id": "old-run__generate_course_scripts__root",
                    }
                },
            },
        }
        after_job = {
            "id": "job-1",
            "job_type": "course",
            "request": {"content_job": {"params": {"courseCode": "CBT101"}}},
            "runtime": {
                "course_raw_scripts": {
                    "CBT101INT": "Keep me",
                    "CBT101M1L": "Fresh text",
                },
                "artifacts": {
                    "course.raw_script.CBT101INT": {
                        "origin_step_run_id": "old-run__generate_course_scripts__root",
                    }
                },
            },
        }

        updates = build_artifact_updates(
            before_job=before_job,
            after_job=after_job,
            run_id="run-2",
            step_name="generate_course_scripts",
            step_output={"script_count": 2},
        )

        self.assertNotIn("course.raw_script.CBT101INT", updates)
        self.assertIn("course.raw_script.CBT101M1L", updates)
        self.assertEqual(
            updates["course.raw_script.CBT101M1L"]["origin_step_run_id"],
            "run-2__generate_course_scripts__root",
        )

    def test_finalize_course_timing_counts_reused_previous_run_work(self) -> None:
        artifacts = {
            "course.plan": {
                "artifact_key": "course.plan",
                "origin_run_id": "job-1-r1",
                "origin_step_run_id": "job-1-r1__generate_course_plan__root",
                "dependency_artifact_keys": [],
            },
            "course.raw_script.CBT101INT": {
                "artifact_key": "course.raw_script.CBT101INT",
                "origin_run_id": "job-1-r1",
                "origin_step_run_id": "job-1-r1__generate_course_scripts__root",
                "dependency_artifact_keys": ["course.plan"],
            },
            "course.formatted_script.CBT101INT": {
                "artifact_key": "course.formatted_script.CBT101INT",
                "origin_run_id": "job-1-r2",
                "origin_step_run_id": "job-1-r2__format_course_scripts__root",
                "dependency_artifact_keys": ["course.raw_script.CBT101INT"],
            },
            "course.audio.CBT101INT": {
                "artifact_key": "course.audio.CBT101INT",
                "origin_run_id": "job-1-r2",
                "origin_step_run_id": "job-1-r2__synthesize_course_audio__INT",
                "dependency_artifact_keys": ["course.formatted_script.CBT101INT"],
            },
            "course.audio_bundle": {
                "artifact_key": "course.audio_bundle",
                "origin_run_id": "job-1-r2",
                "origin_step_run_id": "job-1-r2__upload_course_audio__root",
                "dependency_artifact_keys": ["course.audio.CBT101INT"],
            },
            "course.publish": {
                "artifact_key": "course.publish",
                "origin_run_id": "job-1-r2",
                "origin_step_run_id": "job-1-r2__publish_course__root",
                "dependency_artifact_keys": ["course.plan", "course.audio_bundle"],
            },
        }
        db = _FakeDB(
            {
                "factory_jobs": {"job-1": _course_job_with_artifacts(artifacts)},
                "content_jobs": {
                    "content-1": {
                        "status": "completed",
                        "createdAt": _dt(-10),
                        "courseId": "course-live-1",
                        "courseSessionIds": ["session-1"],
                    }
                },
                "factory_step_runs": {
                    "job-1-r1__generate_course_plan__root": _step_run("job-1-r1", "job-1", "generate_course_plan", 0, 10),
                    "job-1-r1__generate_course_scripts__root": _step_run("job-1-r1", "job-1", "generate_course_scripts", 10, 20),
                    "job-1-r2__format_course_scripts__root": _step_run("job-1-r2", "job-1", "format_course_scripts", 30, 40),
                    "job-1-r2__synthesize_course_audio__INT": _step_run("job-1-r2", "job-1", "synthesize_course_audio", 40, 50),
                    "job-1-r2__upload_course_audio__root": _step_run("job-1-r2", "job-1", "upload_course_audio", 50, 55),
                    "job-1-r2__publish_course__root": _step_run("job-1-r2", "job-1", "publish_course", 55, 60),
                },
            }
        )

        result = finalize_job_timing(
            db,
            job_id="job-1",
            run_id="job-1-r2",
            content_job_id="content-1",
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["effectiveElapsedMs"], 50000)
        self.assertEqual(result["effectiveWorkerMs"], 50000)
        self.assertEqual(result["reuseCreditMs"], 20000)
        self.assertEqual(result["wastedWorkerMs"], 0)
        self.assertEqual(result["queueLatencyMs"], 10000)
        self.assertEqual(result["timingStatus"], "exact")

    def test_finalize_course_timing_excludes_replaced_successful_work(self) -> None:
        artifacts = {
            "course.plan": {
                "artifact_key": "course.plan",
                "origin_run_id": "job-2-r1",
                "origin_step_run_id": "job-2-r1__generate_course_plan__root",
                "dependency_artifact_keys": [],
            },
            "course.raw_script.CBT101INT": {
                "artifact_key": "course.raw_script.CBT101INT",
                "origin_run_id": "job-2-r2",
                "origin_step_run_id": "job-2-r2__generate_course_scripts__root",
                "dependency_artifact_keys": ["course.plan"],
            },
            "course.formatted_script.CBT101INT": {
                "artifact_key": "course.formatted_script.CBT101INT",
                "origin_run_id": "job-2-r2",
                "origin_step_run_id": "job-2-r2__format_course_scripts__root",
                "dependency_artifact_keys": ["course.raw_script.CBT101INT"],
            },
            "course.audio.CBT101INT": {
                "artifact_key": "course.audio.CBT101INT",
                "origin_run_id": "job-2-r2",
                "origin_step_run_id": "job-2-r2__synthesize_course_audio__INT",
                "dependency_artifact_keys": ["course.formatted_script.CBT101INT"],
            },
            "course.audio_bundle": {
                "artifact_key": "course.audio_bundle",
                "origin_run_id": "job-2-r2",
                "origin_step_run_id": "job-2-r2__upload_course_audio__root",
                "dependency_artifact_keys": ["course.audio.CBT101INT"],
            },
            "course.publish": {
                "artifact_key": "course.publish",
                "origin_run_id": "job-2-r2",
                "origin_step_run_id": "job-2-r2__publish_course__root",
                "dependency_artifact_keys": ["course.plan", "course.audio_bundle"],
            },
        }
        db = _FakeDB(
            {
                "factory_jobs": {"job-2": _course_job_with_artifacts(artifacts)},
                "content_jobs": {
                    "content-1": {
                        "status": "completed",
                        "createdAt": _dt(0),
                        "courseId": "course-live-2",
                        "courseSessionIds": ["session-1"],
                    }
                },
                "factory_step_runs": {
                    "job-2-r1__generate_course_plan__root": _step_run("job-2-r1", "job-2", "generate_course_plan", 0, 5),
                    "job-2-r1__generate_course_scripts__root": _step_run("job-2-r1", "job-2", "generate_course_scripts", 5, 15),
                    "job-2-r2__generate_course_scripts__root": _step_run("job-2-r2", "job-2", "generate_course_scripts", 20, 32),
                    "job-2-r2__format_course_scripts__root": _step_run("job-2-r2", "job-2", "format_course_scripts", 32, 42),
                    "job-2-r2__synthesize_course_audio__INT": _step_run("job-2-r2", "job-2", "synthesize_course_audio", 42, 52),
                    "job-2-r2__upload_course_audio__root": _step_run("job-2-r2", "job-2", "upload_course_audio", 52, 57),
                    "job-2-r2__publish_course__root": _step_run("job-2-r2", "job-2", "publish_course", 57, 62),
                },
            }
        )

        result = finalize_job_timing(
            db,
            job_id="job-2",
            run_id="job-2-r2",
            content_job_id="content-1",
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["effectiveElapsedMs"], 47000)
        self.assertEqual(result["reuseCreditMs"], 5000)
        self.assertEqual(result["wastedWorkerMs"], 10000)

    def test_finalize_subject_timing_aggregates_child_lineage(self) -> None:
        subject_artifacts = {
            "subject.plan": {
                "artifact_key": "subject.plan",
                "origin_run_id": "subject-r1",
                "origin_step_run_id": "subject-r1__generate_subject_plan__root",
                "dependency_artifact_keys": [],
            },
            "subject.launch": {
                "artifact_key": "subject.launch",
                "origin_run_id": "subject-r1",
                "origin_step_run_id": "subject-r1__launch_subject_children__root",
                "dependency_artifact_keys": ["subject.plan"],
            },
            "subject.publish": {
                "artifact_key": "subject.publish",
                "origin_run_id": "subject-r1",
                "origin_step_run_id": "subject-r1__watch_subject_children__root",
                "dependency_artifact_keys": ["subject.launch"],
                "dependency_child_job_ids": ["child-1", "child-2"],
            },
        }
        db = _FakeDB(
            {
                "factory_jobs": {
                    "subject-1": {
                        "job_type": "subject",
                        "request": {"compat": {"content_job_id": "subject-content-1"}},
                        "runtime": {
                            "artifacts": subject_artifacts,
                            "subject_state": "completed",
                            "child_job_ids": ["child-1", "child-2"],
                        },
                    }
                },
                "content_jobs": {
                    "subject-content-1": {
                        "status": "completed",
                        "createdAt": _dt(0),
                    }
                },
                "factory_job_lineage": {
                    "child-1": {
                        "contributing_step_run_ids": ["child-1-r1__publish_course__root"],
                        "contributing_run_ids": ["child-1-r1"],
                        "effective_worker_ms": 10000,
                        "reuse_credit_ms": 3000,
                        "wasted_worker_ms": 2000,
                    },
                    "child-2": {
                        "contributing_step_run_ids": ["child-2-r1__publish_course__root"],
                        "contributing_run_ids": ["child-2-r1"],
                        "effective_worker_ms": 10000,
                        "reuse_credit_ms": 0,
                        "wasted_worker_ms": 1000,
                    },
                },
                "factory_step_runs": {
                    "subject-r1__generate_subject_plan__root": _step_run("subject-r1", "subject-1", "generate_subject_plan", 0, 10),
                    "subject-r1__launch_subject_children__root": _step_run("subject-r1", "subject-1", "launch_subject_children", 10, 15),
                    "subject-r1__watch_subject_children__root": _step_run("subject-r1", "subject-1", "watch_subject_children", 40, 45),
                    "child-1-r1__publish_course__root": _step_run("child-1-r1", "child-1", "publish_course", 20, 30),
                    "child-2-r1__publish_course__root": _step_run("child-2-r1", "child-2", "publish_course", 30, 40),
                },
            }
        )

        result = finalize_job_timing(
            db,
            job_id="subject-1",
            run_id="subject-r1",
            content_job_id="subject-content-1",
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["effectiveElapsedMs"], 40000)
        self.assertEqual(result["effectiveWorkerMs"], 40000)
        self.assertEqual(result["reuseCreditMs"], 3000)
        self.assertEqual(result["wastedWorkerMs"], 3000)
        self.assertEqual(sorted(result["contributing_child_job_ids"]), ["child-1", "child-2"])


if __name__ == "__main__":
    unittest.main()
