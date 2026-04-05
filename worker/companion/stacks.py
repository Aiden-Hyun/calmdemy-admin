import os
import sys
import signal
import subprocess
import time
from typing import Callable, Optional

from observability import get_logger
from .stack_config import load_stack_config

logger = get_logger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
for path in (BASE_DIR, PARENT_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

LOG_DIR = os.path.join(BASE_DIR, "..", "logs")


def load_worker_stacks() -> list[dict]:
    """Load worker stack definitions from worker_stacks.json (with fallback)."""
    return load_stack_config()


def _sanitize_stack_id(stack_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stack_id)


def _pid_path(stack_id: str) -> str:
    safe_id = _sanitize_stack_id(stack_id)
    return os.path.join(BASE_DIR, f"..", f".local_worker_{safe_id}.pid")


def log_path(stack_id: str) -> str:
    safe_id = _sanitize_stack_id(stack_id)
    return os.path.join(LOG_DIR, f"local_worker_{safe_id}.log")


def _read_pid(stack_id: str) -> Optional[int]:
    pid_path = _pid_path(stack_id)
    if not os.path.isfile(pid_path):
        return None
    try:
        with open(pid_path, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except Exception:
        return None


def _write_pid(stack_id: str, pid: int) -> None:
    pid_path = _pid_path(stack_id)
    with open(pid_path, "w", encoding="utf-8") as f:
        f.write(str(pid))


def _clear_pid(stack_id: str) -> None:
    pid_path = _pid_path(stack_id)
    if os.path.isfile(pid_path):
        try:
            os.remove(pid_path)
        except Exception:
            pass


def _pid_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:
        # On macOS/Linux, zombie processes still pass kill(pid, 0).
        # Treat Z-state as not running so companion can respawn workers.
        result = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)],
            check=False,
            capture_output=True,
            text=True,
        )
        status = (result.stdout or "").strip().upper()
        if not status:
            return False
        return not status.startswith("Z")
    except Exception:
        return True


def is_worker_running(stack_id: str) -> bool:
    pid = _read_pid(stack_id)
    if not pid:
        return False
    if _pid_is_running(pid):
        return True
    _clear_pid(stack_id)
    return False


def start_worker(stack: dict) -> int:
    os.makedirs(LOG_DIR, exist_ok=True)
    stack_id = stack["id"]
    log_file = open(log_path(stack_id), "a", encoding="utf-8")

    worker_path = os.path.join(BASE_DIR, "..", "local_worker.py")
    venv_path = stack.get("venv", ".venv")
    if not os.path.isabs(venv_path):
        venv_path = os.path.join(BASE_DIR, "..", venv_path)
    venv_python = os.path.join(venv_path, "bin", "python")
    python_exec = venv_python if os.path.isfile(venv_python) else sys.executable

    env = os.environ.copy()
    env["WORKER_ID"] = stack_id
    env["WORKER_ROLE"] = str(stack.get("role") or "v2")
    env["WORKER_DISPATCH"] = "true" if stack.get("dispatch", False) else "false"
    env["WORKER_ACCEPT_NON_TTS"] = (
        "true" if stack.get("acceptNonTtsSteps", True) else "false"
    )
    tts_models = stack.get("ttsModels") or []
    extra_capability_keys = stack.get("extraCapabilityKeys") or []
    env["WORKER_TTS_MODELS"] = ",".join(str(model) for model in tts_models)
    env["WORKER_EXTRA_CAPABILITY_KEYS"] = ",".join(
        str(capability_key) for capability_key in extra_capability_keys
    )
    env["V2_ENABLE_DISPATCH"] = env["WORKER_DISPATCH"]
    env.setdefault("PYTHONUNBUFFERED", "1")

    process = subprocess.Popen(
        [python_exec, worker_path],
        cwd=os.path.join(BASE_DIR, ".."),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=env,
    )
    _write_pid(stack_id, process.pid)
    return process.pid


def stop_worker(stack_id: str) -> None:
    pid = _read_pid(stack_id)
    if not pid:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        _clear_pid(stack_id)
        return

    deadline = time.time() + 15
    while time.time() < deadline:
        if not _pid_is_running(pid):
            _clear_pid(stack_id)
            return
        time.sleep(0.5)

    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass

    _clear_pid(stack_id)


def running_stack_pids(stacks: list[dict]) -> dict[str, int]:
    running = {}
    for stack in stacks:
        stack_id = stack["id"]
        pid = _read_pid(stack_id)
        if pid and _pid_is_running(pid):
            running[stack_id] = pid
        elif pid:
            _clear_pid(stack_id)
    return running


def primary_pid(stacks: list[dict], running: dict[str, int]) -> Optional[int]:
    for stack in stacks:
        if stack["id"] in running:
            return running[stack["id"]]
    for pid in running.values():
        return pid
    return None


def ensure_running(
    db,
    update_control: Callable[[dict], None],
    force_immediate_start: bool = True,
) -> None:
    """Set desiredState=running and optionally start enabled stacks."""
    update_control(
        {
            "desiredState": "running",
            "lastAction": "wake-dispatcher",
            "requestedBy": "wake-dispatcher",
        }
    )

    if not force_immediate_start:
        return

    stacks = load_worker_stacks()
    enabled_stacks = [s for s in stacks if s.get("enabled", True)]
    running = running_stack_pids(stacks)

    for stack in enabled_stacks:
        if stack["id"] not in running:
            running[stack["id"]] = start_worker(stack)

    pid = primary_pid(enabled_stacks, running)
    update_control(
        {
            "currentState": "running",
            "workerPid": pid,
            "lastAction": "wake-dispatcher",
            "lastError": None,
        }
    )
    logger.info("Stacks ensured running", extra={"pid": pid, "running": list(running.keys())})
