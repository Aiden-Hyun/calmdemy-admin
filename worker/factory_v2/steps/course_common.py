"""Shared course constants and lookup helpers reused across multiple step files."""

from __future__ import annotations

from typing import Any


DEFAULT_FALLBACK_URL = (
    "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80"
)

# This is the canonical course session layout. Multiple steps use it to keep
# plan generation, script generation, TTS, upload, and publish in sync.
SESSION_DEFS = [
    {"suffix": "INT", "type": "intro", "label": "Course Intro", "order": 0, "duration_min": 2},
    {"suffix": "M1L", "type": "lesson", "label": "Module 1 — Lesson", "order": 1, "duration_min": 5},
    {"suffix": "M1P", "type": "practice", "label": "Module 1 — Practice", "order": 2, "duration_min": 8},
    {"suffix": "M2L", "type": "lesson", "label": "Module 2 — Lesson", "order": 3, "duration_min": 5},
    {"suffix": "M2P", "type": "practice", "label": "Module 2 — Practice", "order": 4, "duration_min": 8},
    {"suffix": "M3L", "type": "lesson", "label": "Module 3 — Lesson", "order": 5, "duration_min": 5},
    {"suffix": "M3P", "type": "practice", "label": "Module 3 — Practice", "order": 6, "duration_min": 8},
    {"suffix": "M4L", "type": "lesson", "label": "Module 4 — Lesson", "order": 7, "duration_min": 5},
    {"suffix": "M4P", "type": "practice", "label": "Module 4 — Practice", "order": 8, "duration_min": 8},
]


def _content_job_data(job: dict) -> dict[str, Any]:
    """Read the original legacy payload that was copied into the V2 job request."""
    request = job.get("request") or {}
    payload = request.get("content_job") or request.get("job_data") or {}
    if not payload:
        raise ValueError("factory_jobs.request.content_job is required")
    return dict(payload)


def _runtime(job: dict) -> dict[str, Any]:
    """Return the mutable runtime snapshot accumulated by earlier steps."""
    return dict(job.get("runtime") or {})


def _course_code(job_data: dict) -> str:
    params = job_data.get("params") or {}
    return str(params.get("courseCode") or "COURSE101")


def _content_job_id(job: dict) -> str:
    request = job.get("request") or {}
    compat = request.get("compat") or {}
    return str(compat.get("content_job_id") or "").strip()


def _count_audio_results(audio_results: dict[str, dict[str, Any]]) -> int:
    """Count only sessions whose audio upload has finished and produced a storage path."""
    count = 0
    for payload in audio_results.values():
        if isinstance(payload, dict) and payload.get("storagePath"):
            count += 1
    return count


def _course_regeneration(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, Any]:
    regeneration = runtime.get("course_regeneration")
    if isinstance(regeneration, dict):
        return dict(regeneration)
    payload = job_data.get("courseRegeneration")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def _course_script_approval(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, Any]:
    script_approval = runtime.get("course_script_approval")
    if isinstance(script_approval, dict):
        return dict(script_approval)
    payload = job_data.get("courseScriptApproval")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def _session_def_by_shard(shard_key: str) -> dict[str, Any] | None:
    """Map a shard label like `M2P` back to the matching session definition."""
    shard = str(shard_key or "").strip().upper()
    for session_def in SESSION_DEFS:
        if session_def["suffix"] == shard:
            return session_def
    return None


def _get_session_title(session_def: dict, plan: dict) -> str:
    """Resolve the user-facing session title from the plan plus the static layout."""
    if session_def["type"] == "intro":
        return plan.get("intro", {}).get("title", "Course Intro")

    module_idx = int(session_def["suffix"][1]) - 1
    modules = plan.get("modules", [])
    module = modules[module_idx] if module_idx < len(modules) else {}

    if session_def["type"] == "lesson":
        return module.get("lessonTitle", session_def["label"])
    return module.get("practiceTitle", session_def["label"])


def _build_course_preview_sessions(
    course_code: str,
    plan: dict,
    audio_results: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build a lightweight preview payload for approval screens before publish."""
    sessions: list[dict[str, Any]] = []
    for session_def in SESSION_DEFS:
        session_code = f"{course_code}{session_def['suffix']}"
        audio = audio_results.get(session_code, {})
        sessions.append(
            {
                "code": session_code,
                "label": session_def["label"],
                "title": _get_session_title(session_def, plan),
                "order": session_def["order"],
                "audioPath": audio.get("storagePath", ""),
                "durationSec": audio.get("durationSec", 0),
            }
        )
    return sessions
