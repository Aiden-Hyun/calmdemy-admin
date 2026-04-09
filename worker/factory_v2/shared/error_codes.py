"""Shared error classification for pipeline failures.

Architectural Role:
    Converts arbitrary Python exceptions (or raw error strings) into a
    finite set of stable error-code strings.  These codes are stored in
    Firestore job documents (``errorCode`` field) and surfaced in the
    admin dashboard for filtering and alerting.

    The classification is intentionally coarse-grained -- the goal is to
    group errors into actionable buckets (timeout, connection, TTS, LLM,
    storage, etc.) rather than to enumerate every possible failure mode.

Key Dependencies:
    None -- pure logic.

Consumed By:
    - factory_v2 step runner (tags failed jobs with an error code)
    - delete_job (tags delete failures)
    - Admin dashboard (error filtering / aggregation)
"""

from __future__ import annotations

from typing import Any


def classify_error(exc: Exception | str | None) -> str:
    """Return a stable error code string for logs and Firestore status docs.

    Classification strategy:
        1. Check the exception *type name* for well-known patterns (Timeout,
           Connection, Permission, etc.).
        2. Fall through to ``_classify_from_message`` which scans the
           stringified error message for domain-specific keywords.

    Args:
        exc: An Exception instance, a raw error string, or None.

    Returns:
        A short, snake_case error code (e.g. ``"timeout"``, ``"tts_error"``).
    """
    if exc is None:
        return "unknown_error"

    message = str(exc).lower()
    if isinstance(exc, str):
        return _classify_from_message(message)

    # Inspect the exception class name for broad categories
    name = type(exc).__name__.lower()

    if "timeout" in name or "timeout" in message:
        return "timeout"
    if "connection" in name or "connection" in message:
        return "connection_error"
    if "permission" in name or "permission" in message:
        return "permission_denied"
    if "notfound" in name or "file not found" in message:
        return "not_found"
    if "json" in name or "json" in message:
        return "invalid_json"
    if "valueerror" in name:
        return "invalid_input"
    if "runtimeerror" in name:
        return _classify_from_message(message)

    return _classify_from_message(message)


def _classify_from_message(message: str) -> str:
    """Scan a lowercased error message for domain-specific keywords.

    The order matters -- more specific patterns are checked first so that
    e.g. "storage upload" matches ``storage_upload_failed`` before a generic
    ``runtime_error``.
    """
    if "unknown content type" in message:
        return "unknown_content_type"
    if "missing generatedscript" in message:
        return "missing_prerequisite_script"
    if "missing raw script" in message:
        return "missing_course_script"
    if "publish" in message and "duplicate" in message:
        return "duplicate_publish_guard"
    if "storage" in message and ("upload" in message or "blob" in message):
        return "storage_upload_failed"
    if "firestore" in message:
        return "firestore_error"
    if "tts" in message:
        return "tts_error"
    if "llm" in message:
        return "llm_error"
    if "image" in message:
        return "image_error"
    return "runtime_error"
