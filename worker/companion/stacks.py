"""Process management layer for worker stacks.

Architectural Role:
    This module owns the lifecycle of worker **subprocesses**.  A "stack"
    is a logical worker unit defined in ``worker_stacks.json``; each
    enabled stack maps to exactly one Python subprocess running
    ``local_worker.py``.

    Responsibilities:
    - **Start**: spawn a ``local_worker.py`` subprocess with the correct
      virtualenv, environment variables (role, TTS models, capabilities),
      and log redirection.
    - **Stop**: send SIGTERM, wait up to 15 s for graceful shutdown, then
      escalate to SIGKILL if the process is still alive.
    - **PID tracking**: persist PIDs to ``.local_worker_<id>.pid`` files
      so the companion can survive its own restart and still know which
      workers are alive.
    - **Liveness check**: verify a PID is actually running (not a zombie)
      by inspecting ``ps`` output on macOS/Linux.
    - **ensure_running**: high-level orchestrator that sets
      ``desiredState=running`` in Firestore and spawns any enabled stacks
      that don't already have a live process.

Key Dependencies:
    - stack_config.load_stack_config -- reads ``worker_stacks.json``.
    - subprocess / os.kill / signal -- POSIX process management.
    - observability.get_logger -- structured logging.

Consumed By:
    - control_loop.py -- calls ``ensure_running``, ``running_stack_pids``,
      ``start_worker``, ``stop_worker`` on every tick.
    - listener.py / wake_server.py -- call ``ensure_running`` indirectly
      via the callback passed from the control loop.
"""

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
# Ensure both the companion package and the parent worker directory are
# importable.  Needed because local_worker.py lives one level up.
for path in (BASE_DIR, PARENT_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

LOG_DIR = os.path.join(BASE_DIR, "..", "logs")


def load_worker_stacks() -> list[dict]:
    """Load worker stack definitions from worker_stacks.json (with fallback)."""
    return load_stack_config()


def _sanitize_stack_id(stack_id: str) -> str:
    """Replace non-alphanumeric chars (except ``-`` and ``_``) with ``_``.

    Ensures the stack_id is safe for use in filenames and paths.
    """
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stack_id)


def _pid_path(stack_id: str) -> str:
    """Return the path to the PID sentinel file for *stack_id*."""
    safe_id = _sanitize_stack_id(stack_id)
    return os.path.join(BASE_DIR, f"..", f".local_worker_{safe_id}.pid")


def log_path(stack_id: str) -> str:
    """Return the log file path for *stack_id* (used by log_tailer too)."""
    safe_id = _sanitize_stack_id(stack_id)
    return os.path.join(LOG_DIR, f"local_worker_{safe_id}.log")


def _read_pid(stack_id: str) -> Optional[int]:
    """Read the stored PID from disk, or None if no sentinel exists."""
    pid_path = _pid_path(stack_id)
    if not os.path.isfile(pid_path):
        return None
    try:
        with open(pid_path, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except Exception:
        return None


def _write_pid(stack_id: str, pid: int) -> None:
    """Persist *pid* to a sentinel file so it survives companion restarts."""
    pid_path = _pid_path(stack_id)
    with open(pid_path, "w", encoding="utf-8") as f:
        f.write(str(pid))


def _clear_pid(stack_id: str) -> None:
    """Remove the PID sentinel (worker is no longer running)."""
    pid_path = _pid_path(stack_id)
    if os.path.isfile(pid_path):
        try:
            os.remove(pid_path)
        except Exception:
            pass


def _pid_is_running(pid: int) -> bool:
    """Check if *pid* references a live (non-zombie) process.

    Uses two checks:
    1. ``os.kill(pid, 0)`` -- signal 0 tests if the process exists
       without actually sending a signal.
    2. ``ps -o stat=`` -- needed because zombie processes (state ``Z``)
       still pass the signal-0 check on macOS/Linux.  A zombie cannot
       do useful work, so we treat it as "not running" and let the
       companion respawn the worker.
    """
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
    """Return True if the worker for *stack_id* has a live process.

    Cleans up the stale PID file as a side-effect if the process is dead.
    """
    pid = _read_pid(stack_id)
    if not pid:
        return False
    if _pid_is_running(pid):
        return True
    # Stale PID file -- process died outside our control.  Clean up so
    # the next ensure_running cycle can respawn it.
    _clear_pid(stack_id)
    return False


def start_worker(stack: dict) -> int:
    """Spawn a ``local_worker.py`` subprocess for *stack*.

    Configures the child process via environment variables derived from
    the stack definition (role, TTS models, capabilities, dispatch mode).
    stdout and stderr are redirected to a per-stack log file so
    ``LogTailPublisher`` can stream them to the admin UI.

    Args:
        stack: A single stack definition dict from ``worker_stacks.json``.

    Returns:
        The PID of the newly spawned subprocess.
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    stack_id = stack["id"]
    log_file = open(log_path(stack_id), "a", encoding="utf-8")

    worker_path = os.path.join(BASE_DIR, "..", "local_worker.py")

    # Resolve the Python interpreter: prefer the stack's configured venv,
    # fall back to whatever interpreter is running the companion itself.
    venv_path = stack.get("venv", ".venv")
    if not os.path.isabs(venv_path):
        venv_path = os.path.join(BASE_DIR, "..", venv_path)
    venv_python = os.path.join(venv_path, "bin", "python")
    python_exec = venv_python if os.path.isfile(venv_python) else sys.executable

    # Build the environment.  Each WORKER_* variable tells local_worker.py
    # what kind of work this stack should accept.
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
    # Ensure Python flushes stdout immediately so log_tailer sees lines
    # without delay.
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
    """Gracefully stop the worker for *stack_id*.

    Sends SIGTERM first and waits up to 15 seconds for the process to
    exit.  If it's still alive after that, escalates to SIGKILL.
    """
    pid = _read_pid(stack_id)
    if not pid:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        _clear_pid(stack_id)
        return

    # Poll for up to 15 s, checking every 0.5 s.
    deadline = time.time() + 15
    while time.time() < deadline:
        if not _pid_is_running(pid):
            _clear_pid(stack_id)
            return
        time.sleep(0.5)

    # Grace period expired -- force-kill.
    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass

    _clear_pid(stack_id)


def running_stack_pids(stacks: list[dict]) -> dict[str, int]:
    """Return a ``{stack_id: pid}`` dict for all stacks with live processes.

    Side-effect: cleans up stale PID files for processes that have exited.
    """
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
    """Pick one "representative" PID for Firestore status reporting.

    Prefers the first stack in definition order that is running.  Falls
    back to any running PID.  The admin UI uses this to show a single
    PID in the companion status card.
    """
    for stack in stacks:
        if stack["id"] in running:
            return running[stack["id"]]
    # Fallback: return any running PID (order doesn't matter).
    for pid in running.values():
        return pid
    return None


def ensure_running(
    db,
    update_control: Callable[[dict], None],
    force_immediate_start: bool = True,
) -> None:
    """Set desiredState=running and optionally start enabled stacks.

    This is the main entry-point called by the listener and wake server
    when new jobs arrive.  It always updates Firestore to reflect the
    desired state; when ``force_immediate_start`` is True it also spawns
    any enabled stacks that don't already have a live process.

    Args:
        db: Firestore client (unused directly here but kept for
            interface consistency with callers).
        update_control: Callback that merges a dict into the companion's
            Firestore control document.
        force_immediate_start: If True, immediately spawn missing workers.
            If False, just update desired state and let the next
            control-loop tick handle spawning.
    """
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
