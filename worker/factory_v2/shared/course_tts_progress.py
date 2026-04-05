"""Helpers for turning chunk/session completion into UI-friendly course TTS progress."""

from __future__ import annotations

from typing import Any

from factory_v2.shared.course_tts_chunks import make_chunk_shard_key, split_course_tts_chunks

SESSION_SHARDS = ("INT", "M1L", "M1P", "M2L", "M2P", "M3L", "M3P", "M4L", "M4P")


def _word_count(text: str) -> int:
    return len(str(text or "").split())


def _content_job_payload(job: dict[str, Any]) -> dict[str, Any]:
    request = job.get("request") or {}
    payload = request.get("content_job") or request.get("job_data") or {}
    return dict(payload or {})


def _runtime(job: dict[str, Any]) -> dict[str, Any]:
    return dict(job.get("runtime") or {})


def _course_code(job: dict[str, Any]) -> str:
    payload = _content_job_payload(job)
    params = payload.get("params") or {}
    return str(params.get("courseCode") or "COURSE101").strip() or "COURSE101"


def _formatted_scripts(job: dict[str, Any]) -> dict[str, str]:
    runtime = _runtime(job)
    payload = _content_job_payload(job)
    scripts = runtime.get("course_formatted_scripts") or payload.get("courseFormattedScripts") or {}
    return {str(key): str(value) for key, value in dict(scripts).items()}


def _completed_session_codes(job: dict[str, Any]) -> set[str]:
    runtime = _runtime(job)
    payload = _content_job_payload(job)
    audio_results = runtime.get("course_audio_results") or payload.get("courseAudioResults") or {}
    completed: set[str] = set()
    for session_code, result in dict(audio_results).items():
        if not isinstance(result, dict):
            continue
        if str(result.get("storagePath") or "").strip():
            completed.add(str(session_code or "").strip())
    return completed


def build_course_tts_progress(
    job: dict[str, Any],
    *,
    succeeded_chunk_shards: set[str] | None = None,
) -> dict[str, Any] | None:
    """Build a normalized progress snapshot from runtime checkpoints plus in-flight chunks."""
    formatted_scripts = _formatted_scripts(job)
    if not formatted_scripts:
        return None

    course_code = _course_code(job)
    completed_session_codes = _completed_session_codes(job)
    succeeded_chunks = {str(shard or "").strip().upper() for shard in succeeded_chunk_shards or set()}

    total_chunks = 0
    total_words = 0
    completed_chunks = 0
    completed_words = 0
    total_sessions = 0
    completed_sessions = 0

    for session_shard in SESSION_SHARDS:
        session_code = f"{course_code}{session_shard}"
        script = str(formatted_scripts.get(session_code) or "").strip()
        if not script:
            continue

        chunks = split_course_tts_chunks(script)
        if not chunks:
            continue

        total_sessions += 1
        chunk_weights = [_word_count(chunk) for chunk in chunks]
        total_chunks += len(chunk_weights)
        total_words += sum(chunk_weights)

        if session_code in completed_session_codes:
            completed_sessions += 1
            completed_chunks += len(chunk_weights)
            completed_words += sum(chunk_weights)
            continue

        for chunk_index, chunk_weight in enumerate(chunk_weights):
            chunk_shard = make_chunk_shard_key(session_shard, chunk_index)
            if chunk_shard not in succeeded_chunks:
                continue
            completed_chunks += 1
            completed_words += chunk_weight

    if total_chunks <= 0 or total_words <= 0:
        return None

    percent = int(round((completed_words / total_words) * 100))
    percent = max(0, min(100, percent))
    if completed_sessions < total_sessions and percent >= 100:
        percent = 99

    return {
        "mode": "chunk_words",
        "percent": percent,
        "completedChunks": completed_chunks,
        "totalChunks": total_chunks,
        "completedWords": completed_words,
        "totalWords": total_words,
        "completedSessions": completed_sessions,
        "totalSessions": total_sessions,
    }


def format_course_tts_progress_label(progress: dict[str, Any] | None) -> str | None:
    """Convert the structured progress payload into the short label shown in admin UI."""
    if not isinstance(progress, dict):
        return None

    percent = int(progress.get("percent") or 0)
    completed_sessions = int(progress.get("completedSessions") or 0)
    total_sessions = int(progress.get("totalSessions") or 0)
    if total_sessions <= 0:
        return None

    return f"Audio {completed_sessions}/{total_sessions} | TTS {percent}%"
