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
        self.db = db
        self.max_lines = max(10, max_lines)
        self.max_line_chars = max(80, max_line_chars)
        self.min_level_value = self._level_value(min_level)
        self.interval_sec = max(0.5, interval_sec)
        self._states: Dict[str, _TailState] = {}
        self._last_publish_ts = 0.0

        if redact_prefixes is None:
            companion_dir = os.path.dirname(os.path.abspath(__file__))
            worker_dir = os.path.abspath(os.path.join(companion_dir, ".."))
            app_root = os.path.abspath(os.path.join(worker_dir, ".."))
            redact_prefixes = [worker_dir, app_root]
        self.redact_prefixes = sorted(
            [p for p in set(redact_prefixes) if p],
            key=len,
            reverse=True,
        )

    def publish(self, stack_defs: list[dict], running_pids: dict[str, int]) -> None:
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

            lines = state.lines[-self.max_lines :]
            pid = running_pids.get(stack_id)
            role = stack.get("role")
            enabled = bool(stack.get("enabled", True))

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

        inode = (int(st.st_dev), int(st.st_ino))
        if state.inode is None:
            state.inode = inode
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
        combined = state.carry + text
        parts = combined.split("\n")
        state.carry = parts.pop() if parts else ""
        if len(state.carry) > self.max_line_chars * 2:
            state.carry = state.carry[-(self.max_line_chars * 2) :]

        changed = False
        for line in parts:
            entry = self._normalize_line(line)
            if not entry:
                continue
            state.lines.append(entry)
            changed = True

        if len(state.lines) > self.max_lines * 4:
            state.lines = state.lines[-self.max_lines :]

        return changed

    def _normalize_line(self, raw_line: str) -> Optional[dict]:
        stripped = raw_line.strip("\r")
        if not stripped.strip():
            return None

        redacted_raw = self._truncate(self._redact(stripped))

        parsed = None
        try:
            maybe = json.loads(stripped)
            if isinstance(maybe, dict):
                parsed = maybe
        except Exception:
            parsed = None

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
        for key in ("job_id", "stage", "content_type", "model_id", "error"):
            value = parsed.get(key)
            if value in (None, ""):
                continue
            entry[key] = self._truncate(self._redact(str(value)))

        return entry

    def _redact(self, text: str) -> str:
        redacted = text
        for prefix in self.redact_prefixes:
            redacted = redacted.replace(prefix, "<LOCAL_PATH>")
        return redacted

    def _truncate(self, text: str) -> str:
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
        blob = json.dumps(
            {"lines": lines, "pid": pid, "role": role, "enabled": enabled},
            sort_keys=True,
            default=str,
        )
        return hashlib.sha1(blob.encode("utf-8")).hexdigest()

    @staticmethod
    def _level_value(level_name: str) -> int:
        return _LEVEL_TO_INT.get(str(level_name).upper(), _LEVEL_TO_INT["INFO"])
