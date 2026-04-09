"""Job deduplication for wake signals.

Architectural Role:
    Multiple sources can trigger a worker wake-up (Firestore listener,
    HTTP wake endpoint, control-loop tick).  When a content_job transitions
    to ``pending``, Cloud Functions fire a wake HTTP request AND the
    Firestore snapshot listener fires -- both within milliseconds.  Without
    deduplication the companion would try to spawn workers twice for the
    same job.

    WakeDeduper is a lightweight, thread-safe, TTL-based cache that
    remembers recently-seen job IDs and suppresses duplicate wake signals
    within a configurable time window.

Key Dependencies:
    None -- pure Python with only stdlib (time, threading).

Consumed By:
    - listener.py  -- checks ``is_duplicate`` before calling ensure_running.
    - wake_server.py -- checks ``is_duplicate`` on inbound HTTP /wake POSTs.
    - control_loop.py -- passes the deduper instance to both consumers above.
"""

import time
from threading import Lock
from typing import Dict


class WakeDeduper:
    """Thread-safe, TTL-based deduplication cache for wake signals.

    Stores a mapping of ``job_id -> last_seen_timestamp``.  Any job_id
    seen again within ``window_sec`` seconds is treated as a duplicate.

    The cache self-prunes expired entries on every ``is_duplicate`` call,
    so it stays bounded without a background thread.
    """

    def __init__(self, window_sec: int):
        """Initialise the deduper.

        Args:
            window_sec: How many seconds a job_id is considered "recent".
                Typical value is 30-60 s -- long enough to absorb duplicate
                wake signals, short enough that a genuinely re-queued job
                is not suppressed.
        """
        self.window_sec = window_sec
        self._recent: Dict[str, float] = {}
        # Guards _recent -- both the listener thread and the HTTP server
        # thread may call is_duplicate concurrently.
        self._lock = Lock()

    def is_duplicate(self, job_id: str) -> bool:
        """Check whether *job_id* was already seen within the TTL window.

        Side-effects:
            1. Evicts all expired entries (lazy garbage collection).
            2. If the job is *not* a duplicate, records it so future
               calls within the window will return ``True``.

        Args:
            job_id: Firestore document ID of the content_job.

        Returns:
            True if this job_id was seen within ``window_sec``, False otherwise.
        """
        now = time.time()
        with self._lock:
            # --- Lazy GC: evict entries older than the TTL window ---
            expired = [jid for jid, ts in self._recent.items() if now - ts > self.window_sec]
            for jid in expired:
                self._recent.pop(jid, None)

            last = self._recent.get(job_id)
            if last and now - last < self.window_sec:
                return True

            # Record this job_id so subsequent calls within the window
            # are suppressed.
            self._recent[job_id] = now
        return False
