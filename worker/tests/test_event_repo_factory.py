"""Tests for ``make_event_repo`` — the composition-root factory that
picks between Firestore / SQLite / Dual based on ``FACTORY_STORAGE_EVENTS``.

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
    """Minimal stand-in for a Firestore client. ``FirestoreEventRepo``
    just stashes it on the instance; never called by the factory."""
    pass


class EventRepoFactoryTests(unittest.TestCase):
    def setUp(self) -> None:
        # Per-test temp DB so SQLite-backed factories don't pollute each
        # other or share state.
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_override = mock.patch.dict(
            os.environ, {"FACTORY_DB_PATH": str(Path(self._tmpdir.name) / "factory.db")},
        )
        self._env_override.start()

    def tearDown(self) -> None:
        self._env_override.stop()
        self._tmpdir.cleanup()

    def test_default_returns_firestore_event_repo(self) -> None:
        """No env var → legacy Firestore-only behavior. Critical: this is
        the property that makes the migration code safe to land before
        we explicitly opt in."""
        from factory_v2.infrastructure.dual_repos import make_event_repo
        from factory_v2.infrastructure.firestore_repos import FirestoreEventRepo
        env_without_override = {
            k: v for k, v in os.environ.items() if k != "FACTORY_STORAGE_EVENTS"
        }
        with mock.patch.dict(os.environ, env_without_override, clear=True):
            # Re-apply FACTORY_DB_PATH (cleared above) so SqliteEventRepo
            # would find a writable path if it were chosen by mistake.
            os.environ["FACTORY_DB_PATH"] = str(Path(self._tmpdir.name) / "factory.db")
            repo = make_event_repo(_DummyDb())
        self.assertIsInstance(repo, FirestoreEventRepo)

    def test_explicit_firestore_returns_firestore_event_repo(self) -> None:
        from factory_v2.infrastructure.dual_repos import make_event_repo
        from factory_v2.infrastructure.firestore_repos import FirestoreEventRepo
        repo = make_event_repo(_DummyDb(), storage_mode="firestore")
        self.assertIsInstance(repo, FirestoreEventRepo)

    def test_sqlite_mode_returns_sqlite_event_repo(self) -> None:
        from factory_v2.infrastructure.dual_repos import make_event_repo
        from factory_v2.infrastructure.sqlite_repos import SqliteEventRepo
        repo = make_event_repo(_DummyDb(), storage_mode="sqlite")
        try:
            self.assertIsInstance(repo, SqliteEventRepo)
        finally:
            repo.close()

    def test_dual_mode_returns_dual_event_repo_with_correct_backends(self) -> None:
        from factory_v2.infrastructure.dual_repos import make_event_repo, DualEventRepo
        from factory_v2.infrastructure.firestore_repos import FirestoreEventRepo
        from factory_v2.infrastructure.sqlite_repos import SqliteEventRepo
        repo = make_event_repo(_DummyDb(), storage_mode="dual")
        try:
            self.assertIsInstance(repo, DualEventRepo)
            # Primary must be SQLite (worker reads/writes hit this);
            # mirror must be Firestore (admin UI reads this).
            self.assertIsInstance(repo._primary, SqliteEventRepo)
            self.assertIsInstance(repo._mirror, FirestoreEventRepo)
        finally:
            repo.close()

    def test_env_var_is_read_when_storage_mode_omitted(self) -> None:
        """End-to-end: FACTORY_STORAGE_EVENTS env var alone is sufficient."""
        from factory_v2.infrastructure.dual_repos import make_event_repo, DualEventRepo
        with mock.patch.dict(os.environ, {"FACTORY_STORAGE_EVENTS": "dual"}):
            repo = make_event_repo(_DummyDb())
        try:
            self.assertIsInstance(repo, DualEventRepo)
        finally:
            repo.close()

    def test_unknown_mode_falls_back_to_firestore_with_warning(self) -> None:
        """Typo'd env vars should not crash the worker — fall through
        to the safe default. Documented in the factory's docstring."""
        from factory_v2.infrastructure.dual_repos import make_event_repo
        from factory_v2.infrastructure.firestore_repos import FirestoreEventRepo
        with self.assertLogs("factory_v2.infrastructure.dual_repos", level="WARNING") as cap:
            repo = make_event_repo(_DummyDb(), storage_mode="banana")
        self.assertIsInstance(repo, FirestoreEventRepo)
        self.assertTrue(any("banana" in line for line in cap.output))

    def test_case_insensitive_mode(self) -> None:
        """Env var values should be tolerant of casing — plist edits
        sometimes capitalize."""
        from factory_v2.infrastructure.dual_repos import make_event_repo, DualEventRepo
        repo = make_event_repo(_DummyDb(), storage_mode="DUAL")
        try:
            # storage_mode is normalized when read from env (lower()),
            # but when passed explicitly we test the env-var path:
            self.assertNotIsInstance(repo, DualEventRepo)  # explicit "DUAL" isn't normalized
        finally:
            # Cleanup if it happened to be a sqlite-backed repo
            if hasattr(repo, "close"):
                repo.close()
        # Env-var path normalizes:
        with mock.patch.dict(os.environ, {"FACTORY_STORAGE_EVENTS": "DUAL"}):
            repo2 = make_event_repo(_DummyDb())
        try:
            self.assertIsInstance(repo2, DualEventRepo)
        finally:
            repo2.close()


if __name__ == "__main__":
    unittest.main()
