"""Local filesystem cache for content job artifacts.

Architectural Role:
    Pipeline steps produce intermediate artifacts (scripts, WAV files,
    MP3 files) that need to survive across step boundaries.  This module
    provides a per-job cache directory under ``config.JOB_CACHE_DIR`` where
    steps can persist text, audio files, and a JSON state snapshot.

    The state file (``state.json``) tracks which steps have completed so
    that the orchestrator can resume a partially-finished job without
    re-running earlier steps.

    Cache directories are cleaned up after a job completes or is deleted.

Key Dependencies:
    - config.JOB_CACHE_DIR  -- root directory for all job caches

Consumed By:
    - factory_v2 step runner (read/write intermediate artifacts)
    - delete_job (cache cleanup on job deletion)
"""

import json
import os
import shutil
import time

import config

STATE_FILENAME = "state.json"


def get_cache_dir(job_id: str) -> str:
    """Return the filesystem path to a job's cache directory."""
    return os.path.join(config.JOB_CACHE_DIR, job_id)


def ensure_cache_dir(job_id: str) -> str:
    """Create the job cache directory if it does not exist yet."""
    path = get_cache_dir(job_id)
    os.makedirs(path, exist_ok=True)
    return path


def _state_path(job_id: str) -> str:
    """Return the path to the job's ``state.json`` file."""
    return os.path.join(get_cache_dir(job_id), STATE_FILENAME)


def has_cache(job_id: str) -> bool:
    """Return True if the job's cache directory exists and is non-empty."""
    path = get_cache_dir(job_id)
    return os.path.isdir(path) and any(os.scandir(path))


def load_state(job_id: str) -> dict | None:
    """Load the job's cached state dict, or None if missing/corrupt."""
    path = _state_path(job_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


def save_state(job_id: str, state: dict) -> None:
    """Atomically write the job state dict to ``state.json``.

    Uses write-to-tmp + ``os.replace`` to avoid partial writes if the
    process crashes mid-write.
    """
    ensure_cache_dir(job_id)
    path = _state_path(job_id)
    tmp_path = f"{path}.tmp"
    state = dict(state)
    state["updatedAt"] = time.time()
    with open(tmp_path, "w") as f:
        json.dump(state, f, indent=2)
    # Atomic rename -- guarantees readers never see a half-written file
    os.replace(tmp_path, path)


def write_text(job_id: str, filename: str, text: str) -> str:
    """Write a text artifact (e.g. a script) into the job's cache directory."""
    base_dir = ensure_cache_dir(job_id)
    path = os.path.join(base_dir, filename)
    with open(path, "w") as f:
        f.write(text)
    return path


def read_text(job_id: str, filename: str) -> str | None:
    """Read a cached text artifact, or None if missing/corrupt."""
    path = os.path.join(get_cache_dir(job_id), filename)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return None


def save_artifact(job_id: str, src_path: str, dest_name: str) -> str:
    """Copy a binary artifact (WAV, MP3, JPEG) into the job's cache.

    Handles the edge case where ``src_path`` and ``dest_path`` are already
    the same file (same inode or same absolute path) to avoid a no-op copy.
    """
    base_dir = ensure_cache_dir(job_id)
    dest_path = os.path.join(base_dir, dest_name)
    try:
        if os.path.exists(src_path) and os.path.exists(dest_path):
            if os.path.samefile(src_path, dest_path):
                return dest_path
    except Exception:
        # samefile can fail across different filesystems; fall through to copy
        pass
    if os.path.abspath(src_path) == os.path.abspath(dest_path):
        return dest_path
    try:
        shutil.copy2(src_path, dest_path)
    except shutil.SameFileError:
        return dest_path
    return dest_path


def cleanup(job_id: str) -> None:
    """Delete the entire cache directory for a job."""
    path = get_cache_dir(job_id)
    shutil.rmtree(path, ignore_errors=True)
