"""Tests for FirestoreStepRunRepo.batch_mark_succeeded_from_checkpoint.

The optimization replaces N × (ensure_ready + mark_succeeded_from_checkpoint)
serial round-trips with one Firestore batch commit per ≤500 entries. These
tests pin the resulting Firestore call shape so a refactor doesn't silently
regress back to the slow path.
"""
from __future__ import annotations

import os
import sys
import unittest

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class _FakeBatch:
    def __init__(self, recorder):
        self._recorder = recorder
        self._ops: list[tuple[str, dict, dict]] = []

    def set(self, doc_ref, data, **kwargs):
        self._ops.append((doc_ref._path, data, kwargs))

    def commit(self):
        # Hand the staged ops to the parent recorder atomically.
        self._recorder.commits.append(list(self._ops))


class _FakeDocRef:
    def __init__(self, path: str):
        self._path = path


class _FakeCollectionRef:
    def __init__(self, recorder, name: str):
        self._recorder = recorder
        self._name = name

    def document(self, doc_id: str) -> _FakeDocRef:
        return _FakeDocRef(f"{self._name}/{doc_id}")


class _FakeDb:
    def __init__(self):
        self.commits: list[list[tuple[str, dict, dict]]] = []
        self._collections: dict[str, _FakeCollectionRef] = {}

    def collection(self, name: str) -> _FakeCollectionRef:
        if name not in self._collections:
            self._collections[name] = _FakeCollectionRef(self, name)
        return self._collections[name]

    def batch(self) -> _FakeBatch:
        return _FakeBatch(self)


class BatchCheckpointTests(unittest.TestCase):
    def _repo(self):
        # Import here so the worker package is on sys.path first.
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        return FirestoreStepRunRepo(_FakeDb()), _FakeDb()

    def test_empty_entries_is_a_no_op(self) -> None:
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        db = _FakeDb()
        repo = FirestoreStepRunRepo(db)
        repo.batch_mark_succeeded_from_checkpoint([])
        # Should NOT have called batch() / commit() at all — a no-op write
        # would still cost a network round-trip we're trying to avoid.
        self.assertEqual(db.commits, [])

    def test_single_batch_for_small_entries(self) -> None:
        """30 entries should commit as ONE batch — one round-trip, not 30."""
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        db = _FakeDb()
        repo = FirestoreStepRunRepo(db)
        entries = [
            ("job-1", "job-1-r2", f"step_{i}", "root", {"reused_from_checkpoint": True})
            for i in range(30)
        ]
        repo.batch_mark_succeeded_from_checkpoint(entries)
        self.assertEqual(len(db.commits), 1)
        self.assertEqual(len(db.commits[0]), 30)

    def test_chunks_above_500_into_multiple_batches(self) -> None:
        """Firestore caps batches at 500. The repo should chunk transparently."""
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        db = _FakeDb()
        repo = FirestoreStepRunRepo(db)
        entries = [
            ("job-1", "job-1-r2", f"step_{i}", "root", {"reused_from_checkpoint": True})
            for i in range(750)
        ]
        repo.batch_mark_succeeded_from_checkpoint(entries)
        # 750 entries -> 500 + 250 -> two batch commits.
        self.assertEqual(len(db.commits), 2)
        self.assertEqual(len(db.commits[0]), 500)
        self.assertEqual(len(db.commits[1]), 250)

    def test_each_entry_writes_canonical_fields(self) -> None:
        """The committed payload must include every field a normal succeeded
        step-run carries, otherwise admin UI / recovery would treat
        checkpoint-marked docs as malformed."""
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        db = _FakeDb()
        repo = FirestoreStepRunRepo(db)
        repo.batch_mark_succeeded_from_checkpoint([
            ("job-1", "job-1-r2", "format_script", "root", {"reused_from_checkpoint": True}),
        ])
        ops = db.commits[0]
        self.assertEqual(len(ops), 1)
        doc_path, data, kwargs = ops[0]
        self.assertEqual(doc_path, "factory_step_runs/job-1-r2__format_script__root")
        # State must be the terminal success value.
        self.assertEqual(data["state"], "succeeded")
        # Identity fields must round-trip so the doc is queryable.
        self.assertEqual(data["job_id"], "job-1")
        self.assertEqual(data["run_id"], "job-1-r2")
        self.assertEqual(data["step_name"], "format_script")
        self.assertEqual(data["shard_key"], "root")
        # Output payload preserved verbatim.
        self.assertEqual(data["output"], {"reused_from_checkpoint": True})
        # Lifecycle / attempt fields present so admin UI shows the step run.
        for required in (
            "worker_id", "attempt", "watchdog_state",
            "started_at", "last_heartbeat_at", "ended_at",
            "created_at", "updated_at",
        ):
            self.assertIn(required, data, f"missing field: {required}")
        # set() must use merge=True so a replay doesn't clobber sibling fields.
        self.assertTrue(kwargs.get("merge"))

    def test_shard_key_threaded_into_step_run_id(self) -> None:
        """Sharded steps (course audio session shards) get their shard_key
        baked into the doc id so fan-in queries by shard work."""
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        db = _FakeDb()
        repo = FirestoreStepRunRepo(db)
        repo.batch_mark_succeeded_from_checkpoint([
            ("job-1", "job-1-r2", "synthesize_course_audio", "M2P",
             {"reused_from_checkpoint": True, "session_code": "M2P"}),
        ])
        doc_path, _data, _kwargs = db.commits[0][0]
        self.assertEqual(doc_path, "factory_step_runs/job-1-r2__synthesize_course_audio__M2P")


if __name__ == "__main__":
    unittest.main()
