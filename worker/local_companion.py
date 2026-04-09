"""Entry point for the Calmdemy Companion process.

Architectural Role:
    The companion is a long-lived supervisor that manages *worker stacks*
    (one or more ``local_worker`` processes).  It does **not** process
    content jobs itself -- instead it watches Firestore for new jobs and
    control-doc changes, then spawns / stops worker processes as needed.

    On macOS the companion is launched by a launchd plist so it starts
    automatically at login and restarts on crash.

Lifecycle (see ``main()``):
    1. Initialise Firebase and ensure a control document exists in
       Firestore (the admin UI reads this to show worker status).
    2. Optionally start a **Firestore job listener** that reacts in
       near-real-time when new content jobs appear.
    3. Optionally start an **HTTP wake server** that the admin UI can
       POST to, triggering immediate worker spin-up.
    4. Enter the **control loop** -- a polling loop that reconciles
       desired vs. actual worker state every few seconds.

Key Dependencies:
    ``companion/`` sub-package (control_loop, listener, wake_server, dedupe),
    ``observability``, ``firebase_admin``.

Consumed By:
    Invoked directly via ``python local_companion.py`` or the launchd plist.
    Not imported by any other module.
"""

import os
import sys

# Ensure local imports work even when launched outside this folder
# (e.g. when launchd runs us with cwd = /).
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from observability import configure_logging, get_logger  # noqa: E402

from companion.control_loop import (
    init_firebase,
    ensure_control_doc,
    ensure_running_wrapper,
    run_control_loop,
)
from companion.dedupe import WakeDeduper
from companion.listener import start_job_listener
from companion.wake_server import start_wake_server

# Load .env file if present
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()
except ImportError:
    pass


configure_logging()
logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Companion-specific settings (all tuneable via environment)
# ---------------------------------------------------------------------------
POLL_SECONDS = float(os.getenv("COMPANION_POLL_SECONDS", "2"))
ENABLE_WAKE_SERVER = os.getenv("ENABLE_WAKE_SERVER", "false").lower() == "true"
ENABLE_JOB_LISTENER = os.getenv("ENABLE_JOB_LISTENER", "true").lower() == "true"
WAKE_SHARED_SECRET = os.getenv("WAKE_SHARED_SECRET", "")
WAKE_SERVER_PORT = int(os.getenv("WAKE_SERVER_PORT", "8787"))
FORCE_IMMEDIATE_START = os.getenv("FORCE_IMMEDIATE_START", "true").lower() == "true"
WAKE_DEDUP_WINDOW_SEC = int(os.getenv("WAKE_DEDUP_WINDOW_SEC", "300"))
LISTENER_DEBOUNCE_SEC = float(os.getenv("LISTENER_DEBOUNCE_SEC", "0.15"))


def main() -> None:
    """Run the companion supervisor until interrupted.

    The function wires up all optional subsystems (job listener, wake
    server) and then blocks in the control loop.  On KeyboardInterrupt
    or termination, the ``finally`` block tears down listeners cleanly.
    """
    logger.info("Calmdemy Content Factory — Local Companion (modular)")
    logger.info(
        "Flags",
        extra={
            "poll_sec": POLL_SECONDS,
            "enable_wake_server": ENABLE_WAKE_SERVER,
            "enable_job_listener": ENABLE_JOB_LISTENER,
            "force_immediate_start": FORCE_IMMEDIATE_START,
        },
    )

    # --- Step 1: Firebase init + control doc ---
    db = init_firebase()
    ensure_control_doc(db)

    # WakeDeduper prevents duplicate worker spin-ups when multiple
    # signals arrive within a short window (e.g. listener + wake HTTP
    # hitting at the same time).
    deduper = WakeDeduper(WAKE_DEDUP_WINDOW_SEC)

    # Closure that the listener and wake server call when they want
    # to ensure at least one worker stack is running.
    def _ensure_running(force: bool):
        ensure_running_wrapper(db, force)

    # --- Step 2: Firestore real-time listener (optional) ---
    listener = None
    if ENABLE_JOB_LISTENER:
        listener = start_job_listener(
            db,
            deduper=deduper,
            ensure_running=_ensure_running,
            force_immediate_start=FORCE_IMMEDIATE_START,
            debounce_sec=LISTENER_DEBOUNCE_SEC,
        )

    # --- Step 3: HTTP wake server (optional) ---
    wake_thread = None
    if ENABLE_WAKE_SERVER:
        wake_thread = start_wake_server(
            port=WAKE_SERVER_PORT,
            shared_secret=WAKE_SHARED_SECRET,
            deduper=deduper,
            ensure_running=_ensure_running,
            force_immediate_start=FORCE_IMMEDIATE_START,
        )

    # --- Step 4: Blocking control loop ---
    try:
        run_control_loop(db, poll_seconds=POLL_SECONDS, force_immediate_start=FORCE_IMMEDIATE_START)
    finally:
        # Clean shutdown: detach Firestore snapshot listener and join
        # the wake-server thread so we don't leak resources.
        if listener:
            listener.unsubscribe()
        if wake_thread:
            wake_thread.join(timeout=1)


if __name__ == "__main__":
    main()
