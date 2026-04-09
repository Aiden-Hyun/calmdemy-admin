"""Helpers for turning chunk/session completion into UI-friendly course TTS progress.

Architectural Role:
    Course TTS synthesis can take many minutes.  This module computes a
    progress snapshot that the admin dashboard can display in real time:
    a percentage bar, chunk counts, word counts, and session counts.

    Progress is weighted by word count rather than by chunk count so that
    a 200-word chunk counts more toward completion than a 50-word chunk,
    giving a more accurate perception of remaining work.

    The session shards follow the convention:
        ``INT`` = Intro, ``M1L`` = Module 1 Lesson, ``M1P`` = Module 1 Practice, etc.

Key Dependencies:
    - course_tts_chunks.split_course_tts_chunks -- chunk splitting logic
    - course_tts_chunks.make_chunk_shard_key    -- shard key format

Consumed By:
    - factory_v2 course TTS orchestrator (progress reporting to Firestore)
    - Admin dashboard (real-time progress display)
"""

from __future__ import annotations

from typing import Any

from factory_v2.shared.course_tts_chunks import make_chunk_shard_key, split_course_tts_chunks

# Standard session shards for a Calmdemy course:
# INT = Introduction, M<n>L = Module n Lesson, M<n>P = Module n Practice
SESSION_SHARDS = ("INT", "M1L", "M1P", "M2L", "M2P", "M3L", "M3P", "M4L", "M4P")


def _word_count(text: str) -> int:
    """Count whitespace-delimited words."""
    return len(str(text or "").split())


def _content_job_payload(job: dict[str, Any]) -> dict[str, Any]:
    """Extract the content-job payload from the factory job's request envelope."""
    request = job.get("request") or {}
    payload = request.get("content_job") or request.get("job_data") or {}
    return dict(payload or {})


def _runtime(job: dict[str, Any]) -> dict[str, Any]:
    """Safely extract the ``runtime`` sub-dict."""
    return dict(job.get("runtime") or {})


def _course_code(job: dict[str, Any]) -> str:
    """Return the course code (e.g. ``"CALM101"``), defaulting to ``"COURSE101"``."""
    payload = _content_job_payload(job)
    params = payload.get("params") or {}
    return str(params.get("courseCode") or "COURSE101").strip() or "COURSE101"


def _formatted_scripts(job: dict[str, Any]) -> dict[str, str]:
    """Return the per-session formatted scripts as ``{session_code: script_text}``."""
    runtime = _runtime(job)
    payload = _content_job_payload(job)
    scripts = runtime.get("course_formatted_scripts") or payload.get("courseFormattedScripts") or {}
    return {str(key): str(value) for key, value in dict(scripts).items()}


def _completed_session_codes(job: dict[str, Any]) -> set[str]:
    """Return the set of session codes that have a ``storagePath`` in audio results."""
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
    """Build a normalized progress snapshot from runtime checkpoints plus in-flight chunks.

    Iterates over all session shards, splits each script into chunks, and
    tallies completed vs. total words.  A session is considered fully complete
    when its audio result has a ``storagePath``; individual chunks within
    an incomplete session are matched against ``succeeded_chunk_shards``.

    The percentage is capped at 99 until all sessions are fully complete,
    preventing the UI from showing 100% prematurely.

    Returns:
        A progress dict with keys: ``mode``, ``percent``, ``completedChunks``,
        ``totalChunks``, ``completedWords``, ``totalWords``,
        ``completedSessions``, ``totalSessions``.  Or None if no scripts
        are available yet.
    """
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
    """Convert the structured progress payload into a short label for the admin UI.

    Example output: ``"Audio 3/9 | TTS 42%"``
    """
    if not isinstance(progress, dict):
        return None

    percent = int(progress.get("percent") or 0)
    completed_sessions = int(progress.get("completedSessions") or 0)
    total_sessions = int(progress.get("totalSessions") or 0)
    if total_sessions <= 0:
        return None

    return f"Audio {completed_sessions}/{total_sessions} | TTS {percent}%"
