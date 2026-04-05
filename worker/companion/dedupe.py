import time
from threading import Lock
from typing import Dict

# Simple TTL-based dedupe cache (job_id -> timestamp)

class WakeDeduper:
    def __init__(self, window_sec: int):
        self.window_sec = window_sec
        self._recent: Dict[str, float] = {}
        self._lock = Lock()

    def is_duplicate(self, job_id: str) -> bool:
        now = time.time()
        with self._lock:
            expired = [jid for jid, ts in self._recent.items() if now - ts > self.window_sec]
            for jid in expired:
                self._recent.pop(jid, None)

            last = self._recent.get(job_id)
            if last and now - last < self.window_sec:
                return True

            self._recent[job_id] = now
        return False
