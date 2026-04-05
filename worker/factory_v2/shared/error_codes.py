"""
Shared error classification for pipeline failures.
"""

from __future__ import annotations

from typing import Any


def classify_error(exc: Exception | str | None) -> str:
    """Return a stable error code for logs and Firestore status docs."""
    if exc is None:
        return "unknown_error"

    message = str(exc).lower()
    if isinstance(exc, str):
        return _classify_from_message(message)

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
