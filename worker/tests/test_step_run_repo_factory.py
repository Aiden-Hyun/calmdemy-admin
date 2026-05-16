"""Tests for ``make_step_run_repo`` — the composition-root factory that
picks between Firestore / SQLite / Dual based on ``FACTORY_STORAGE_STEP_RUNS``.

Mirrors ``test_event_repo_factory.py`` shape. Same 7 contracts pinned for
the step_runs collection; per-collection env var keeps the two factories
independent so each phase of the migration can flip on its own.

Pinning the factory's behavior matters because the composition root
(``worker_main.py``) is the only place this gets called in production,
and we want changes to it to surface in tests rather than only at
worker boot time on a real machine.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)


class _DummyDb:
    """Minimal stand-in for a Firestore client. ``FirestoreStepRunRepo``
    just stashes it on the instance; never called by the factory."""
    pass


class StepRunRepoFactoryTests(unittest.TestCase):
    def setUp(self) -> None:
        # Per-test temp DB so SQLite-backed factories don't pollute each
        # other or share state across tests.
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_override = mock.patch.dict(
            os.environ, {"FACTORY_DB_PATH": str(Path(self._tmpdir.name) / "factory.db")},
        )
        self._env_override.start()

    def tearDown(self) -> None:
        self._env_override.stop()
        self._tmpdir.cleanup()

    def test_default_returns_firestore_step_run_repo(self) -> None:
        """No env var → legacy Firestore-only behavior. Critical: this is
        the property that makes the migration code safe to land before
        we explicitly opt in. If this test breaks, deploying main would
        change runtime behavior on every worker."""
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        env_without_override = {
            k: v for k, v in os.environ.items() if k != "FACTORY_STORAGE_STEP_RUNS"
        }
        with mock.patch.dict(os.environ, env_without_override, clear=True):
            # Re-apply FACTORY_DB_PATH (cleared above) so SqliteStepRunRepo
            # would find a writable path if it were chosen by mistake.
            os.environ["FACTORY_DB_PATH"] = str(Path(self._tmpdir.name) / "factory.db")
            repo = make_step_run_repo(_DummyDb())
        self.assertIsInstance(repo, FirestoreStepRunRepo)

    def test_default_mode_never_touches_sqlite(self) -> None:
        """A safety test, not just a behavior test: pinning that the
        SQLite file does NOT exist after a default-mode construction
        means deploying this code cannot accidentally start dual-writing
        on a machine where the operator hasn't opted in."""
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        db_path = Path(self._tmpdir.name) / "factory.db"
        self.assertFalse(db_path.exists())
        env_without_override = {
            k: v for k, v in os.environ.items() if k != "FACTORY_STORAGE_STEP_RUNS"
        }
        with mock.patch.dict(os.environ, env_without_override, clear=True):
            os.environ["FACTORY_DB_PATH"] = str(db_path)
            make_step_run_repo(_DummyDb())
        # The Firestore-backed repo touches no local files.
        self.assertFalse(db_path.exists())

    def test_explicit_firestore_returns_firestore_step_run_repo(self) -> None:
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        repo = make_step_run_repo(_DummyDb(), storage_mode="firestore")
        self.assertIsInstance(repo, FirestoreStepRunRepo)

    def test_sqlite_mode_returns_sqlite_step_run_repo(self) -> None:
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        repo = make_step_run_repo(_DummyDb(), storage_mode="sqlite")
        try:
            self.assertIsInstance(repo, SqliteStepRunRepo)
        finally:
            repo.close()

    def test_dual_mode_returns_dual_step_run_repo_with_correct_backends(self) -> None:
        """Dual mode must wire SQLite as primary and Firestore as mirror,
        NEVER the other way around. If a future refactor swaps them, the
        whole point of the migration is undone: reads would hit Firestore
        and the eventual-consistency race would return."""
        from factory_v2.infrastructure.dual_repos import (
            make_step_run_repo,
            DualStepRunRepo,
        )
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        from factory_v2.infrastructure.sqlite_repos import SqliteStepRunRepo
        repo = make_step_run_repo(_DummyDb(), storage_mode="dual")
        try:
            self.assertIsInstance(repo, DualStepRunRepo)
            # Primary must be SQLite (worker reads/writes hit this) —
            # this is the property that closes the consistency race.
            self.assertIsInstance(repo._primary, SqliteStepRunRepo)
            # Mirror must be Firestore (admin UI reads this).
            self.assertIsInstance(repo._mirror, FirestoreStepRunRepo)
        finally:
            repo.close()

    def test_env_var_is_read_when_storage_mode_omitted(self) -> None:
        """End-to-end: FACTORY_STORAGE_STEP_RUNS env var alone is sufficient.
        This is the production path — worker_main.py never passes
        storage_mode explicitly; it relies on the env var."""
        from factory_v2.infrastructure.dual_repos import (
            make_step_run_repo,
            DualStepRunRepo,
        )
        with mock.patch.dict(os.environ, {"FACTORY_STORAGE_STEP_RUNS": "dual"}):
            repo = make_step_run_repo(_DummyDb())
        try:
            self.assertIsInstance(repo, DualStepRunRepo)
        finally:
            repo.close()

    def test_unknown_mode_falls_back_to_firestore_with_warning(self) -> None:
        """Typo'd env vars should not crash the worker — fall through
        to the safe default. Documented in the factory's docstring."""
        from factory_v2.infrastructure.dual_repos import make_step_run_repo
        from factory_v2.infrastructure.firestore_repos import FirestoreStepRunRepo
        with self.assertLogs("factory_v2.infrastructure.dual_repos", level="WARNING") as cap:
            repo = make_step_run_repo(_DummyDb(), storage_mode="banana")
        self.assertIsInstance(repo, FirestoreStepRunRepo)
        self.assertTrue(any("banana" in line for line in cap.output))

    def test_case_insensitive_mode_via_env_var(self) -> None:
        """Env var values should be tolerant of casing — plist edits
        sometimes capitalize. Explicit-arg path stays strict so we don't
        accidentally hide bugs in test code."""
        from factory_v2.infrastructure.dual_repos import (
            make_step_run_repo,
            DualStepRunRepo,
        )
        # Explicit "DUAL" is NOT normalized — stays an unknown mode and
        # falls through to firestore.
        repo = make_step_run_repo(_DummyDb(), storage_mode="DUAL")
        try:
            self.assertNotIsInstance(repo, DualStepRunRepo)
        finally:
            if hasattr(repo, "close"):
                repo.close()
        # Env-var path normalizes to lowercase, so "DUAL" works there.
        with mock.patch.dict(os.environ, {"FACTORY_STORAGE_STEP_RUNS": "DUAL"}):
            repo2 = make_step_run_repo(_DummyDb())
        try:
            self.assertIsInstance(repo2, DualStepRunRepo)
        finally:
            repo2.close()

    def test_events_and_step_runs_env_vars_are_independent(self) -> None:
        """The whole point of per-collection env vars: flipping one
        collection's backend must NOT affect the other. Pinning this
        prevents a future refactor from accidentally collapsing both
        factories onto a single env var."""
        from factory_v2.infrastructure.dual_repos import (
            make_event_repo,
            make_step_run_repo,
            DualEventRepo,
            DualStepRunRepo,
        )
        from factory_v2.infrastructure.firestore_repos import (
            FirestoreEventRepo,
            FirestoreStepRunRepo,
        )
        # events=dual, step_runs unset → step_runs stays firestore
        env = {
            k: v for k, v in os.environ.items()
            if k not in ("FACTORY_STORAGE_EVENTS", "FACTORY_STORAGE_STEP_RUNS")
        }
        env["FACTORY_STORAGE_EVENTS"] = "dual"
        env["FACTORY_DB_PATH"] = str(Path(self._tmpdir.name) / "factory.db")
        with mock.patch.dict(os.environ, env, clear=True):
            events_repo = make_event_repo(_DummyDb())
            step_runs_repo = make_step_run_repo(_DummyDb())
        try:
            self.assertIsInstance(events_repo, DualEventRepo)
            self.assertIsInstance(step_runs_repo, FirestoreStepRunRepo)
            self.assertNotIsInstance(step_runs_repo, DualStepRunRepo)
        finally:
            if hasattr(events_repo, "close"):
                events_repo.close()
        # step_runs=dual, events unset → events stays firestore
        env2 = {
            k: v for k, v in os.environ.items()
            if k not in ("FACTORY_STORAGE_EVENTS", "FACTORY_STORAGE_STEP_RUNS")
        }
        env2["FACTORY_STORAGE_STEP_RUNS"] = "dual"
        env2["FACTORY_DB_PATH"] = str(Path(self._tmpdir.name) / "factory.db")
        with mock.patch.dict(os.environ, env2, clear=True):
            events_repo2 = make_event_repo(_DummyDb())
            step_runs_repo2 = make_step_run_repo(_DummyDb())
        try:
            self.assertIsInstance(events_repo2, FirestoreEventRepo)
            self.assertNotIsInstance(events_repo2, DualEventRepo)
            self.assertIsInstance(step_runs_repo2, DualStepRunRepo)
        finally:
            if hasattr(step_runs_repo2, "close"):
                step_runs_repo2.close()


if __name__ == "__main__":
    unittest.main()
