from __future__ import annotations

import copy
import os
import sys
import unittest

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.steps.base import StepContext
from factory_v2.steps.subject import execute_watch_subject_children


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
        if merge and self.id in collection:
            collection[self.id] = {**collection[self.id], **copy.deepcopy(payload)}
        else:
            collection[self.id] = copy.deepcopy(payload)


class _FakeQuery:
    def __init__(self, db, collection_name: str, filters=None):
        self._db = db
        self._collection_name = collection_name
        self._filters = list(filters or [])

    def where(self, field: str, op: str, value):
        return _FakeQuery(
            self._db,
            self._collection_name,
            filters=self._filters + [(field, op, value)],
        )

    def stream(self):
        docs = []
        for doc_id, payload in self._db._collections.get(self._collection_name, {}).items():
            if all(self._matches(payload, field, op, value) for field, op, value in self._filters):
                docs.append(_FakeSnapshot(_FakeDocRef(self._db, self._collection_name, doc_id), payload))
        return docs

    @staticmethod
    def _matches(payload: dict, field: str, op: str, value) -> bool:
        if op != "==":
            raise AssertionError(f"Unsupported operator: {op}")
        return payload.get(field) == value


class _FakeCollection:
    def __init__(self, db, name: str):
        self._db = db
        self._name = name

    def document(self, doc_id: str | None = None):
        if doc_id is None:
            self._db._auto_id += 1
            doc_id = f"auto-{self._db._auto_id}"
        return _FakeDocRef(self._db, self._name, doc_id)

    def where(self, field: str, op: str, value):
        return _FakeQuery(self._db, self._name).where(field, op, value)


class _FakeDB:
    def __init__(self, collections: dict[str, dict[str, dict]] | None = None):
        self._collections = copy.deepcopy(collections or {})
        self._auto_id = 0

    def collection(self, name: str):
        return _FakeCollection(self, name)


class SubjectRetryBehaviorTests(unittest.TestCase):
    def test_watch_subject_children_relaunches_missing_gap_when_completed_children_are_preserved(self) -> None:
        parent_job_id = "subject-parent"
        plan = {
            "subjectId": "dbt",
            "subjectLabel": "DBT",
            "courses": [
                {
                    "sequence": 1,
                    "level": 300,
                    "code": "DBT301",
                    "title": "Course 1",
                    "description": "Desc 1",
                    "childJobId": "child-1",
                    "childStatus": "completed",
                },
                {
                    "sequence": 2,
                    "level": 300,
                    "code": "DBT310",
                    "title": "Course 2",
                    "description": "Desc 2",
                },
                {
                    "sequence": 3,
                    "level": 300,
                    "code": "DBT320",
                    "title": "Course 3",
                    "description": "Desc 3",
                    "childJobId": "child-3",
                    "childStatus": "completed",
                },
            ],
        }
        content_job = {
            "contentType": "full_subject",
            "llmBackend": "local",
            "ttsBackend": "local",
            "llmModel": "qwen3-base",
            "ttsModel": "imstudio-local",
            "ttsVoice": "Laura Qwen",
            "createdBy": "admin-1",
            "params": {
                "subjectId": "dbt",
                "subjectLabel": "DBT",
                "levelCounts": {"l100": 0, "l200": 0, "l300": 3, "l400": 0},
            },
            "subjectPlan": plan,
            "launchCursor": 0,
            "maxActiveChildCourses": 3,
            "pauseRequested": False,
        }
        db = _FakeDB(
            {
                "content_jobs": {
                    parent_job_id: {
                        **copy.deepcopy(content_job),
                        "childJobIds": ["child-1", "child-3"],
                        "childCounts": {"pending": 0, "running": 0, "completed": 2, "failed": 0},
                    },
                    "child-1": {
                        "contentType": "course",
                        "status": "completed",
                        "parentJobId": parent_job_id,
                        "params": {"courseCode": "DBT301"},
                    },
                    "child-3": {
                        "contentType": "course",
                        "status": "completed",
                        "parentJobId": parent_job_id,
                        "params": {"courseCode": "DBT320"},
                    },
                }
            }
        )
        factory_job = {
            "id": parent_job_id,
            "request": {
                "content_job": copy.deepcopy(content_job),
                "compat": {"content_job_id": parent_job_id},
            },
            "runtime": {
                "subject_plan": copy.deepcopy(plan),
                "launch_cursor": 0,
                "child_job_ids": ["child-1", "child-3"],
                "child_counts": {"pending": 0, "running": 0, "completed": 2, "failed": 0},
                "max_active_child_courses": 3,
            },
        }

        result = execute_watch_subject_children(
            StepContext(
                db=db,
                job=factory_job,
                run_id="subject-parent-r2",
                step_name="watch_subject_children",
                worker_id="worker-1",
            )
        )

        created_children = [
            payload
            for doc_id, payload in db._collections["content_jobs"].items()
            if doc_id not in {parent_job_id, "child-1", "child-3"}
        ]
        self.assertEqual(len(created_children), 1)
        self.assertEqual(created_children[0]["parentJobId"], parent_job_id)
        self.assertEqual(created_children[0]["params"]["courseCode"], "DBT310")
        self.assertEqual(result.runtime_patch["launch_cursor"], 3)
        self.assertEqual(result.runtime_patch["child_counts"]["completed"], 2)
        self.assertEqual(result.runtime_patch["child_counts"]["pending"], 1)
        self.assertEqual(result.compat_content_job_patch["launchCursor"], 3)


if __name__ == "__main__":
    unittest.main()
