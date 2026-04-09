"""Publish bounded worker log tails to Firestore for the admin dashboard.

Architectural Role:
    Each worker subprocess writes structured JSON logs to a local file.
    The admin UI needs near-real-time visibility into those logs without
    SSH access to the worker machine.  ``LogTailPublisher`` bridges the
    gap: it incrementally reads the tail of each worker's log file,
    normalises / redacts / truncates the entries, and publishes them to
    the ``worker_log_tails`` Firestore collection.

    Design choices:
    - **Incremental reads** -- uses file offset + inode tracking so it
      only reads new bytes since the last tick (like ``tail -f``).
    - **Inode rotation detection** -- if the log file is rotated
      (different inode or file shrinks), state resets automatically.
    - **Content-hash gating** -- Firestore writes are skipped when the
      payload has not changed, minimising write costs.
    - **Path redaction** -- local filesystem paths are replaced with
      ``<LOCAL_PATH>`` before publishing to avoid leaking server layout.

Key Dependencies:
    - firebase_admin.firestore -- writes to ``worker_log_tails/{stackId}``.
    - Local log files written by worker subprocesses (paths come from
      stack definitions in ``worker_stacks.json``).

Consumed By:
    - control_loop.py -- calls ``publish()`` on every tick of the main
      supervisor loop.
    - Admin dashboard (React) -- reads ``worker_log_tails`` collection
      in real time via ``onSnapshot``.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Dict, Optional

from firebase_admin import firestore as fs

from observability import get_logger

logger = get_logger(__name__)

# Numeric severity values mirroring Python's logging module, used to
# filter out log lines below the configured minimum level.
_LEVEL_TO_INT = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "WARN": 30,
    "ERROR": 40,
    "CRITICAL": 50,
}


@dataclass
class _TailState:
    """Per-stack incremental read state -- like an ``fseek`` bookmark.

    Attributes:
        offset: Byte position in the log file where the last read ended.
        inode: ``(st_dev, st_ino)`` tuple identifying the physical file.
            Used to detect log rotation (new inode = file was replaced).
        carry: Partial line left over when a read chunk does not end on
            a newline boundary.  Prepended to the next chunk.
        lines: Accumulated parsed log entries for this stack.
        last_hash: SHA-1 of the most recently published Firestore payload.
            Compared before each write to avoid redundant updates.
    """
    offset: int = 0
    inode: Optional[tuple[int, int]] = None
    carry: str = ""
    lines: list[dict] = field(default_factory=list)
    last_hash: str = ""


class LogTailPublisher:
    """Publish bounded per-stack log tails to Firestore for admin UI display."""

    def __init__(
        self,
        db,
        max_lines: int = 120,
        max_line_chars: int = 500,
        min_level: str = "INFO",
        interval_sec: float = 2.0,
        redact_prefixes: Optional[list[str]] = None,
    ):
        """Initialise the publisher.

        Args:
            db: Firestore client instance.
            max_lines: Maximum log lines kept per stack.  Older entries
                are dropped FIFO to bound Firestore document size.
            max_line_chars: Per-line character limit; longer lines are
                truncated with ``...``.
            min_level: Minimum severity to include (e.g. ``"INFO"``).
                DEBUG lines are dropped when min_level is INFO or above.
            interval_sec: Minimum seconds between publish cycles.  Acts
                as a global rate-limit so we don't hammer Firestore on
                every control-loop tick.
            redact_prefixes: Filesystem path prefixes to replace with
                ``<LOCAL_PATH>`` in published log text.  Defaults to the
                worker directory and the app root.
        """
        self.db = db
        self.max_lines = max(10, max_lines)
        self.max_line_chars = max(80, max_line_chars)
        self.min_level_value = self._level_value(min_level)
        self.interval_sec = max(0.5, interval_sec)
        self._states: Dict[str, _TailState] = {}
        self._last_publish_ts = 0.0

        # Auto-detect local paths to redact if none were supplied.
        if redact_prefixes is None:
            companion_dir = os.path.dirname(os.path.abspath(__file__))
            worker_dir = os.path.abspath(os.path.join(companion_dir, ".."))
            app_root = os.path.abspath(os.path.join(worker_dir, ".."))
            redact_prefixes = [worker_dir, app_root]
        # Sort longest-first so more-specific paths are matched before
        # their parent directories (prevents partial replacement).
        self.redact_prefixes = sorted(
            [p for p in set(redact_prefixes) if p],
            key=len,
            reverse=True,
        )

    def publish(self, stack_defs: list[dict], running_pids: dict[str, int]) -> None:
        """Read new log lines and push updated tails to Firestore.

        Called on every control-loop tick, but internally rate-limited by
        ``interval_sec`` so Firestore writes stay bounded.

        Args:
            stack_defs: List of stack definition dicts from
                ``worker_stacks.json`` (must include ``id`` and ``logPath``).
            running_pids: Mapping of ``stack_id -> PID`` for stacks that
                currently have a live subprocess.
        """
        now = time.time()
        if now - self._last_publish_ts < self.interval_sec:
            return
        self._last_publish_ts = now

        for stack in stack_defs:
            stack_id = str(stack.get("id", "")).strip()
            if not stack_id:
                continue

            log_path = stack.get("logPath")
            if not log_path:
                continue

            state = self._states.setdefault(stack_id, _TailState())
            changed = self._read_incremental(log_path, state)

            # Only keep the most recent max_lines entries for the payload.
            lines = state.lines[-self.max_lines :]
            pid = running_pids.get(stack_id)
            role = stack.get("role")
            enabled = bool(stack.get("enabled", True))

            # Skip Firestore write if nothing changed since last publish.
            payload_hash = self._payload_hash(lines, pid, role, enabled)
            if not changed and payload_hash == state.last_hash:
                continue

            payload = {
                "stackId": stack_id,
                "stackRole": role,
                "pid": pid if pid else None,
                "source": "local-companion",
                "lineCount": len(lines),
                "lines": lines,
                "updatedAt": fs.SERVER_TIMESTAMP,
            }

            try:
                self.db.collection("worker_log_tails").document(stack_id).set(payload, merge=True)
                state.last_hash = payload_hash
            except Exception as exc:
                logger.warning(
                    "Failed to publish worker log tail",
                    extra={"stack_id": stack_id, "error": str(exc)},
                )

    def _read_incremental(self, log_path: str, state: _TailState) -> bool:
        """Read new bytes from *log_path* since the last offset.

        Handles file rotation (inode change or size shrink) by resetting
        the offset to zero.  Partial lines that don't end with ``\\n``
        are stored in ``state.carry`` and prepended to the next read.

        Args:
            log_path: Absolute path to the worker's log file.
            state: Mutable ``_TailState`` for this stack.

        Returns:
            True if any new log entries were parsed, False otherwise.
        """
        try:
            st = os.stat(log_path)
        except FileNotFoundError:
            if state.lines or state.offset != 0:
                state.offset = 0
                state.inode = None
                state.carry = ""
                state.lines = []
                return True
            return False
        except Exception as exc:
            logger.debug(
                "Log tail stat failed",
                extra={"path": log_path, "error": str(exc)},
            )
            return False

        # Track the file by device + inode so we detect log rotation.
        inode = (int(st.st_dev), int(st.st_ino))
        if state.inode is None:
            state.inode = inode
        # Inode mismatch = file was replaced; size shrink = file was
        # truncated.  Either way, start reading from the beginning.
        if state.inode != inode or st.st_size < state.offset:
            state.offset = 0
            state.carry = ""
            state.inode = inode

        if st.st_size == state.offset:
            return False

        try:
            with open(log_path, "rb") as f:
                f.seek(state.offset)
                chunk = f.read()
        except Exception as exc:
            logger.debug(
                "Log tail read failed",
                extra={"path": log_path, "error": str(exc)},
            )
            return False

        if not chunk:
            return False

        state.offset += len(chunk)
        text = chunk.decode("utf-8", errors="replace")
        # Prepend any leftover partial line from the previous read.
        combined = state.carry + text
        parts = combined.split("\n")
        # The last element is either empty (if chunk ended with \n) or
        # a partial line -- stash it in carry for the next read.
        state.carry = parts.pop() if parts else ""
        # Safety cap: prevent a single malformed mega-line from
        # growing carry unboundedly.
        if len(state.carry) > self.max_line_chars * 2:
            state.carry = state.carry[-(self.max_line_chars * 2) :]

        changed = False
        for line in parts:
            entry = self._normalize_line(line)
            if not entry:
                continue
            state.lines.append(entry)
            changed = True

        # Periodically trim the in-memory buffer to 4x max_lines.
        # We keep a buffer larger than max_lines so small trims don't
        # happen on every single tick -- it's a hysteresis approach.
        if len(state.lines) > self.max_lines * 4:
            state.lines = state.lines[-self.max_lines :]

        return changed

    def _normalize_line(self, raw_line: str) -> Optional[dict]:
        """Parse a single log line into a normalised dict for Firestore.

        Attempts JSON parsing first (worker logs are structured JSON).
        Falls back to treating the raw text as an INFO-level plain
        message.  Lines below ``min_level`` are dropped.

        Args:
            raw_line: One line of text from the log file.

        Returns:
            A dict with keys ``timestamp``, ``level``, ``logger``,
            ``message``, ``raw`` (and optional metadata keys), or
            None if the line is blank or below the severity threshold.
        """
        stripped = raw_line.strip("\r")
        if not stripped.strip():
            return None

        redacted_raw = self._truncate(self._redact(stripped))

        # Try structured JSON first (the common case for worker logs).
        parsed = None
        try:
            maybe = json.loads(stripped)
            if isinstance(maybe, dict):
                parsed = maybe
        except Exception:
            parsed = None

        # Fallback: treat as a plain-text INFO line.
        if parsed is None:
            if self._level_value("INFO") < self.min_level_value:
                return None
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "INFO",
                "logger": "raw",
                "message": redacted_raw,
                "raw": redacted_raw,
            }

        level = str(parsed.get("level", "INFO")).upper()
        if self._level_value(level) < self.min_level_value:
            return None

        message = parsed.get("message", redacted_raw)
        entry = {
            "timestamp": str(parsed.get("timestamp") or datetime.now(timezone.utc).isoformat()),
            "level": level,
            "logger": str(parsed.get("logger", "")),
            "message": self._truncate(self._redact(str(message))),
            "raw": redacted_raw,
        }
        # Carry forward useful metadata fields if present in the JSON.
        for key in ("job_id", "stage", "content_type", "model_id", "error"):
            value = parsed.get(key)
            if value in (None, ""):
                continue
            entry[key] = self._truncate(self._redact(str(value)))

        return entry

    def _redact(self, text: str) -> str:
        """Replace known local filesystem paths with ``<LOCAL_PATH>``."""
        redacted = text
        for prefix in self.redact_prefixes:
            redacted = redacted.replace(prefix, "<LOCAL_PATH>")
        return redacted

    def _truncate(self, text: str) -> str:
        """Trim *text* to ``max_line_chars``, appending ``...`` if cut."""
        if len(text) <= self.max_line_chars:
            return text
        if self.max_line_chars <= 3:
            return text[: self.max_line_chars]
        return text[: self.max_line_chars - 3] + "..."

    def _payload_hash(
        self,
        lines: list[dict],
        pid: Optional[int],
        role: Optional[str],
        enabled: bool,
    ) -> str:
        """Return a SHA-1 digest of the payload to detect changes cheaply."""
        blob = json.dumps(
            {"lines": lines, "pid": pid, "role": role, "enabled": enabled},
            sort_keys=True,
            default=str,
        )
        return hashlib.sha1(blob.encode("utf-8")).hexdigest()

    @staticmethod
    def _level_value(level_name: str) -> int:
        """Map a level name like ``"WARNING"`` to its numeric severity."""
        return _LEVEL_TO_INT.get(str(level_name).upper(), _LEVEL_TO_INT["INFO"])
