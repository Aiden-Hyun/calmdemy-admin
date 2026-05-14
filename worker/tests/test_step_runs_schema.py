"""Schema-validity tests for ``schema/step_runs.sql``.

Just a quick check that the SQL file parses, produces the expected
table + indexes, and has the columns the Python layer will write.
Catches typos at unittest time instead of at worker boot.

The actual SQLite implementation (``SqliteStepRunRepo``) and its
parity tests come in Phase 2 step 2.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import unittest
from pathlib import Path

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


SCHEMA_PATH = Path(WORKER_DIR) / "factory_v2" / "infrastructure" / "schema" / "step_runs.sql"


class StepRunsSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        # Pure in-memory db — schema-only validation, no need for a file.
        self.conn = sqlite3.connect(":memory:")
        sql = SCHEMA_PATH.read_text()
        # ``executescript`` runs multiple statements separated by ``;``.
        self.conn.executescript(sql)

    def tearDown(self) -> None:
        self.conn.close()

    def test_schema_file_exists(self) -> None:
        """The schema lives at a stable path. SqliteStepRunRepo (Phase 2
        step 2) will look here; if someone renames it, this catches it
        before the worker fails to boot."""
        self.assertTrue(SCHEMA_PATH.is_file(), f"schema not found at {SCHEMA_PATH}")

    def test_factory_step_runs_table_created(self) -> None:
        rows = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='factory_step_runs'"
        ).fetchall()
        self.assertEqual(len(rows), 1, "factory_step_runs table not created")

    def test_columns_match_firestore_field_set(self) -> None:
        """Every field FirestoreStepRunRepo writes must have a column
        here, or the dual-write will silently drop data. The reverse
        (extra columns in SQLite) is fine."""
        info = self.conn.execute("PRAGMA table_info(factory_step_runs)").fetchall()
        columns = {row[1] for row in info}  # row[1] is column name

        # Every field FirestoreStepRunRepo's _write_ paths set (from
        # `grep -oE '"[a-z_]+":' firestore_repos.py` within the
        # FirestoreStepRunRepo class). If a new field gets added on the
        # Firestore side, this test should fail to remind us to add the
        # column here too.
        required_columns = {
            "step_run_id",      # PK; matches make_step_run_id() output
            "job_id", "run_id", "step_name", "shard_key",
            "state", "attempt", "next_attempt", "retry_delay_seconds",
            "worker_id", "queue_id",
            "created_at", "updated_at",
            "started_at", "last_heartbeat_at", "deadline_at", "ended_at",
            "output", "error_code", "error_message", "progress_detail",
            "watchdog_state",
        }
        missing = required_columns - columns
        self.assertFalse(missing, f"schema missing columns: {sorted(missing)}")

    def test_primary_key_is_step_run_id(self) -> None:
        """Point lookups by step_run_id are the dominant access pattern
        (every state mutation goes through it). Primary key gives O(log n)
        without a separate index."""
        info = self.conn.execute("PRAGMA table_info(factory_step_runs)").fetchall()
        pk_columns = [row[1] for row in info if row[5] > 0]  # row[5] is pk position
        self.assertEqual(pk_columns, ["step_run_id"])

    def test_composite_index_for_shard_keys_queries(self) -> None:
        """The orchestrator's hot read paths
        (succeeded_shard_keys / failed_shard_keys) filter by
        (job_id, run_id, step_name, state). Without this index they're
        full-table scans — same complexity bug we hit on Firestore
        without the matching composite there."""
        indexes = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='factory_step_runs'"
        ).fetchall()
        names = {row[0] for row in indexes}
        self.assertIn("idx_step_runs_by_state", names, f"got: {sorted(names)}")

        # Verify the index is on the right columns + order. The order
        # matters: SQLite can use a prefix of the index keys, so
        # job_id must come first since every hot query includes it.
        cols = self.conn.execute(
            "PRAGMA index_info(idx_step_runs_by_state)"
        ).fetchall()
        # row[2] is the column name; first column is row[0] = 0
        ordered = [row[2] for row in sorted(cols, key=lambda r: r[0])]
        self.assertEqual(ordered, ["job_id", "run_id", "step_name", "state"])

    def test_secondary_indexes_present(self) -> None:
        """Recovery sweeps and heartbeat scans use these. Less hot than
        the composite, but still worth indexing."""
        names = {
            row[0] for row in self.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='factory_step_runs'"
            ).fetchall()
        }
        self.assertIn("idx_step_runs_by_run_state", names)
        self.assertIn("idx_step_runs_heartbeat", names)

    def test_insert_and_query_round_trip(self) -> None:
        """End-to-end smoke: insert a row with every column populated,
        read it back, verify shapes match. Cheap parity check that
        catches schema-vs-application drift."""
        self.conn.execute(
            """
            INSERT INTO factory_step_runs (
                step_run_id, job_id, run_id, step_name, shard_key,
                state, attempt, next_attempt, retry_delay_seconds,
                worker_id, queue_id,
                created_at, updated_at, started_at, last_heartbeat_at,
                deadline_at, ended_at,
                output, error_code, error_message, progress_detail,
                watchdog_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "job1-r1__generate_script__root",  # step_run_id
                "job1", "job1-r1", "generate_script", "root",
                "succeeded", 1, None, None,
                "local-primary", "queue-abc",
                1715680000.0, 1715680001.5, 1715680000.5, 1715680001.0,
                1715680060.0, 1715680001.5,
                '{"word_count": 240}', None, None, None,
                "succeeded",
            ),
        )
        self.conn.commit()
        row = self.conn.execute(
            "SELECT state, attempt, output FROM factory_step_runs "
            "WHERE step_run_id = ?",
            ("job1-r1__generate_script__root",),
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "succeeded")
        self.assertEqual(row[1], 1)
        self.assertIn('"word_count"', row[2])

    def test_shard_keys_query_uses_index(self) -> None:
        """EXPLAIN QUERY PLAN confirms the composite index is actually
        used for the hot query — guards against a refactor that adds
        a filter not covered by the index."""
        plan = self.conn.execute(
            "EXPLAIN QUERY PLAN "
            "SELECT shard_key FROM factory_step_runs "
            "WHERE job_id = ? AND run_id = ? AND step_name = ? AND state = ?",
            ("j", "j-r1", "synthesize_audio_chunk", "succeeded"),
        ).fetchall()
        plan_text = " | ".join(str(row) for row in plan)
        self.assertIn(
            "idx_step_runs_by_state", plan_text,
            f"hot read path is not using the composite index! plan: {plan_text}",
        )


if __name__ == "__main__":
    unittest.main()
