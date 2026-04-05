"""
Calmdemy Content Factory — Local Companion (modular).

Primary responsibilities:
- Listen to Firestore control + job changes and start/stop local worker stacks.
- Optional HTTP wake endpoint (off by default).
- Keep worker control doc updated for the admin UI.
"""

import os
import sys

# Ensure local imports work even when launched outside this folder
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

POLL_SECONDS = float(os.getenv("COMPANION_POLL_SECONDS", "2"))
ENABLE_WAKE_SERVER = os.getenv("ENABLE_WAKE_SERVER", "false").lower() == "true"
ENABLE_JOB_LISTENER = os.getenv("ENABLE_JOB_LISTENER", "true").lower() == "true"
WAKE_SHARED_SECRET = os.getenv("WAKE_SHARED_SECRET", "")
WAKE_SERVER_PORT = int(os.getenv("WAKE_SERVER_PORT", "8787"))
FORCE_IMMEDIATE_START = os.getenv("FORCE_IMMEDIATE_START", "true").lower() == "true"
WAKE_DEDUP_WINDOW_SEC = int(os.getenv("WAKE_DEDUP_WINDOW_SEC", "300"))
LISTENER_DEBOUNCE_SEC = float(os.getenv("LISTENER_DEBOUNCE_SEC", "0.15"))


def main() -> None:
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

    db = init_firebase()
    ensure_control_doc(db)

    deduper = WakeDeduper(WAKE_DEDUP_WINDOW_SEC)

    def _ensure_running(force: bool):
        ensure_running_wrapper(db, force)

    listener = None
    if ENABLE_JOB_LISTENER:
        listener = start_job_listener(
            db,
            deduper=deduper,
            ensure_running=_ensure_running,
            force_immediate_start=FORCE_IMMEDIATE_START,
            debounce_sec=LISTENER_DEBOUNCE_SEC,
        )

    wake_thread = None
    if ENABLE_WAKE_SERVER:
        wake_thread = start_wake_server(
            port=WAKE_SERVER_PORT,
            shared_secret=WAKE_SHARED_SECRET,
            deduper=deduper,
            ensure_running=_ensure_running,
            force_immediate_start=FORCE_IMMEDIATE_START,
        )

    try:
        run_control_loop(db, poll_seconds=POLL_SECONDS, force_immediate_start=FORCE_IMMEDIATE_START)
    finally:
        if listener:
            listener.unsubscribe()
        if wake_thread:
            wake_thread.join(timeout=1)


if __name__ == "__main__":
    main()
