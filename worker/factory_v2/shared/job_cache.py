"""
Local cache helpers for content job artifacts.
"""

import json
import os
import shutil
import time

import config

STATE_FILENAME = "state.json"


def get_cache_dir(job_id: str) -> str:
    return os.path.join(config.JOB_CACHE_DIR, job_id)


def ensure_cache_dir(job_id: str) -> str:
    path = get_cache_dir(job_id)
    os.makedirs(path, exist_ok=True)
    return path


def _state_path(job_id: str) -> str:
    return os.path.join(get_cache_dir(job_id), STATE_FILENAME)


def has_cache(job_id: str) -> bool:
    path = get_cache_dir(job_id)
    return os.path.isdir(path) and any(os.scandir(path))


def load_state(job_id: str) -> dict | None:
    path = _state_path(job_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


def save_state(job_id: str, state: dict) -> None:
    ensure_cache_dir(job_id)
    path = _state_path(job_id)
    tmp_path = f"{path}.tmp"
    state = dict(state)
    state["updatedAt"] = time.time()
    with open(tmp_path, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp_path, path)


def write_text(job_id: str, filename: str, text: str) -> str:
    base_dir = ensure_cache_dir(job_id)
    path = os.path.join(base_dir, filename)
    with open(path, "w") as f:
        f.write(text)
    return path


def read_text(job_id: str, filename: str) -> str | None:
    path = os.path.join(get_cache_dir(job_id), filename)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return None


def save_artifact(job_id: str, src_path: str, dest_name: str) -> str:
    base_dir = ensure_cache_dir(job_id)
    dest_path = os.path.join(base_dir, dest_name)
    try:
        if os.path.exists(src_path) and os.path.exists(dest_path):
            if os.path.samefile(src_path, dest_path):
                return dest_path
    except Exception:
        # If samefile check fails (e.g., on different filesystems), fall through to copy.
        pass
    if os.path.abspath(src_path) == os.path.abspath(dest_path):
        return dest_path
    try:
        shutil.copy2(src_path, dest_path)
    except shutil.SameFileError:
        return dest_path
    return dest_path


def cleanup(job_id: str) -> None:
    path = get_cache_dir(job_id)
    shutil.rmtree(path, ignore_errors=True)
