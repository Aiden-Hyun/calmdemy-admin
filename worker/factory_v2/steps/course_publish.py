"""Course publish steps: fan-in confirmation first, then writes to app collections.

Architectural Role:
    Pipeline Step -- implements the final two steps of the course pipeline:
    (1) ``upload_course_audio`` -- a lightweight confirmation gate that
    verifies all session audio is ready, and (2) ``publish_course`` -- the
    step that writes the course and its sessions to the app-facing Firestore
    collections (``courses``, ``course_sessions``).

Design Patterns:
    * **Approval Checkpoint** -- ``publish_course`` can pause at an approval
      gate (e.g. regeneration review) before writing to production.
    * **Idempotent Publish** -- if the course already exists in Firestore
      and no regeneration/manual-publish is requested, the step returns
      the existing IDs without re-writing.
    * **Storage Cleanup** -- when regeneration replaces session audio, the
      old Cloud Storage paths are deleted after publish succeeds.

Key Dependencies:
    * ``factory_v2.shared.voice_utils`` -- TTS voice display names
    * ``factory_v2.shared.storage_cleanup`` -- orphaned audio deletion
    * ``course_common`` -- ``SESSION_DEFS``, helpers, preview builder

Consumed By:
    * ``course.py`` (re-export facade) -> ``registry.py``
"""

from __future__ import annotations

import math
from typing import Any

from firebase_admin import firestore as fs

from factory_v2.shared.voice_utils import get_voice_display_name

from .base import StepContext, StepResult
from .course_common import (
    SESSION_DEFS,
    _build_course_preview_sessions,
    _content_job_data,
    _course_code,
    _course_regeneration,
    _get_session_title,
    _runtime,
)


def _publish_course(
    db,
    publish_token: str,
    plan: dict,
    audio_results: dict[str, dict[str, Any]],
    job_data: dict,
) -> tuple[str, list[str]]:
    """Write/update the course doc plus all of its session docs in Firestore.

    Uses ``merge=True`` so that re-publishes (regeneration, thumbnail refresh)
    only overwrite the fields that changed, preserving user-facing metadata
    like ``isFree`` or custom descriptions set by admins.

    Args:
        db: Firestore client instance.
        publish_token: Document ID for the ``courses`` collection.  Reused
            across regeneration so the same course ID is updated in place.
        plan: The LLM-generated course plan (modules, titles, etc.).
        audio_results: Mapping of session code -> ``{storagePath, durationSec}``.
        job_data: Original content-job payload with params and metadata.

    Returns:
        Tuple of ``(course_id, session_ids)`` -- the Firestore document IDs.
    """
    params = job_data.get("params", {})
    course_code = params.get("courseCode", "COURSE101")
    course_title = params.get("courseTitle", plan.get("courseTitle", "Untitled"))
    subject_id = params.get("subjectId", "")
    subject_label = params.get("subjectLabel", "")
    subject_color = params.get("subjectColor", "#6B7280")
    subject_icon = params.get("subjectIcon", "school-outline")
    tone = params.get("tone", "gentle")
    audience = params.get("targetAudience", "beginner")
    voice_id = job_data.get("ttsVoice", "Calmdemy")
    voice = get_voice_display_name(voice_id)
    thumbnail_url = job_data.get("thumbnailUrl") or ""

    total_duration = sum(result.get("durationSec", 0) for result in audio_results.values())
    total_minutes = max(1, math.ceil(total_duration / 60))

    course_data = {
        "code": course_code,
        "title": course_title,
        "description": plan.get("courseGoal", ""),
        "color": subject_color,
        "icon": subject_icon,
        "subjectId": subject_id,
        "subjectLabel": subject_label,
        "difficulty": audience,
        "tone": tone,
        "sessionCount": len(SESSION_DEFS),
        "duration_minutes": total_minutes,
        "instructor": voice,
        "ttsVoiceId": voice_id,
        "thumbnailUrl": thumbnail_url,
        "generatedBy": "content-factory",
        "createdAt": fs.SERVER_TIMESTAMP,
    }

    course_ref = db.collection("courses").document(str(publish_token))
    if course_ref.get().exists:
        course_data.pop("createdAt", None)
        course_data["updatedAt"] = fs.SERVER_TIMESTAMP
    course_ref.set(course_data, merge=True)
    course_id = course_ref.id

    session_ids: list[str] = []
    for session_def in SESSION_DEFS:
        session_code = f"{course_code}{session_def['suffix']}"
        audio = audio_results.get(session_code, {})
        duration_sec = audio.get("durationSec", 0)

        session_data = {
            "courseId": course_id,
            "code": session_code,
            "title": _get_session_title(session_def, plan),
            "description": f"{session_def['label']} for {course_title}",
            "duration_minutes": max(1, math.ceil(duration_sec / 60)),
            "audioPath": audio.get("storagePath", ""),
            "order": session_def["order"],
            "isFree": False,
            "generatedBy": "content-factory",
            "createdAt": fs.SERVER_TIMESTAMP,
        }

        session_ref = db.collection("course_sessions").document(f"{publish_token}-{session_code}")
        if session_ref.get().exists:
            session_data.pop("createdAt", None)
            session_data["updatedAt"] = fs.SERVER_TIMESTAMP
        session_ref.set(session_data, merge=True)
        session_ids.append(session_ref.id)

    return course_id, session_ids


def execute_upload_course_audio(ctx: StepContext) -> StepResult:
    """Confirm that all course audio uploads are ready for the publish step.

    This is a lightweight gate step -- it does not perform any actual uploads.
    It simply verifies that ``course_audio_results`` exists in runtime (populated
    by the synthesis steps) and advances the pipeline toward publish.
    """
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    audio_results: dict[str, dict[str, Any]] = dict(
        runtime.get("course_audio_results") or job_data.get("courseAudioResults") or {}
    )
    if not audio_results:
        raise ValueError("Missing runtime.course_audio_results")

    return StepResult(
        output={"audio_count": len(audio_results)},
        summary_patch={"currentStep": "upload_course_audio"},
        compat_content_job_patch={
            "status": "uploading",
            "courseAudioResults": audio_results,
            "courseProgress": f"All {len(SESSION_DEFS)} audio files uploaded",
            "jobRunId": ctx.run_id,
        },
    )


def execute_publish_course(ctx: StepContext) -> StepResult:
    """Publish the course or stop at an approval checkpoint when required.

    Decision matrix for ``should_publish``:
        * ``autoPublish=True`` (default) -> publish immediately.
        * ``status="publishing"`` (admin-triggered) -> publish immediately.
        * Regeneration active + ``requiresPublishApproval`` -> pause.
        * ``autoPublish=False`` and not manually publishing -> pause.

    When paused, a preview payload is written so the admin can review
    session titles, audio paths, and durations before approving.
    """
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    course_code = _course_code(job_data)
    plan = runtime.get("course_plan") or job_data.get("coursePlan")
    if not plan:
        raise ValueError("Missing runtime.course_plan")

    audio_results: dict[str, dict[str, Any]] = dict(
        runtime.get("course_audio_results") or job_data.get("courseAudioResults") or {}
    )
    if not audio_results:
        raise ValueError("Missing runtime.course_audio_results")

    # --- Determine whether to publish or pause for approval ---
    request_status = str(job_data.get("status") or "").strip().lower()
    auto_publish = bool(job_data.get("autoPublish", True))
    manual_publish = request_status == "publishing"
    thumbnail_generation_requested = bool(
        runtime.get("thumbnail_generation_requested") or job_data.get("thumbnailGenerationRequested")
    )
    regeneration = _course_regeneration(runtime, job_data)
    regeneration_active = bool(regeneration.get("active"))
    requires_publish_approval = bool(regeneration.get("requiresPublishApproval"))
    should_publish = auto_publish or manual_publish
    # Regeneration can override auto-publish when admin review is required.
    if regeneration_active and requires_publish_approval and not manual_publish:
        should_publish = False

    if not should_publish:
        # Regeneration can intentionally stop here so an admin can review the new
        # sessions before the existing course is overwritten in production.
        preview_sessions = _build_course_preview_sessions(course_code, plan, audio_results)
        return StepResult(
            output={"awaiting_approval": True, "preview_count": len(preview_sessions)},
            runtime_patch={
                "course_preview_sessions": preview_sessions,
                "course_regeneration": regeneration if regeneration_active else None,
            },
            summary_patch={"currentStep": "publish_course", "awaitingApproval": True},
            compat_content_job_patch={
                "status": "completed",
                "coursePreviewSessions": preview_sessions,
                "courseProgress": "Completed (awaiting approval)",
                "jobRunId": ctx.run_id,
                "courseRegeneration": regeneration if regeneration_active else None,
                "thumbnailGenerationRequested": False,
            },
        )

    # Resolve the Firestore document ID for the course.  Regeneration and
    # manual-publish reuse the existing course ID so the document is updated
    # in place rather than duplicated.
    publish_token = str(job_data.get("publishToken") or job_data.get("id") or ctx.job.get("id") or course_code)

    existing_course_id = runtime.get("course_id") or job_data.get("courseId")
    existing_session_ids = runtime.get("course_session_ids") or job_data.get("courseSessionIds")
    if existing_course_id and (regeneration_active or manual_publish or thumbnail_generation_requested):
        publish_token = str(existing_course_id)

    # Idempotency: skip publish if the course already exists and nothing
    # requested a replacement (no regeneration, no manual trigger).
    if (
        existing_course_id
        and existing_session_ids
        and not regeneration_active
        and not manual_publish
        and not thumbnail_generation_requested
    ):
        # A normal rerun should not duplicate publish side effects when the
        # course already exists and nothing requested a replacement publish.
        return StepResult(
            output={"course_id": existing_course_id, "session_count": len(existing_session_ids)},
            summary_patch={"currentStep": "publish_course", "courseId": existing_course_id},
            compat_content_job_patch={
                "status": "completed",
                "courseId": existing_course_id,
                "courseSessionIds": existing_session_ids,
                "courseProgress": "Published",
                "jobRunId": ctx.run_id,
            },
        )

    # Collect old audio paths that regeneration is replacing so they can be
    # cleaned up from Cloud Storage after the new publish succeeds.
    replaced_old_paths: list[str] = []
    if regeneration_active:
        previous_audio_by_session = regeneration.get("previousAudioBySession") or {}
        if isinstance(previous_audio_by_session, dict):
            for session_code, old_path in previous_audio_by_session.items():
                old_storage_path = str(old_path or "").strip()
                if not old_storage_path:
                    continue
                next_storage_path = str(
                    (audio_results.get(str(session_code)) or {}).get("storagePath") or ""
                ).strip()
                if next_storage_path and next_storage_path != old_storage_path:
                    replaced_old_paths.append(old_storage_path)

    course_id, session_ids = _publish_course(
        ctx.db,
        publish_token=publish_token,
        plan=plan,
        audio_results=audio_results,
        job_data={
            **job_data,
            "thumbnailUrl": runtime.get("thumbnail_url") or job_data.get("thumbnailUrl") or "",
        },
    )

    # Clean up replaced audio files from Cloud Storage.  The allowed_prefixes
    # guard prevents accidental deletion of non-audio assets.
    if replaced_old_paths:
        from factory_v2.shared.storage_cleanup import delete_storage_paths

        delete_storage_paths(replaced_old_paths, allowed_prefixes=("audio/",))

    return StepResult(
        output={"course_id": course_id, "session_count": len(session_ids)},
        runtime_patch={
            "course_id": course_id,
            "course_session_ids": session_ids,
            "course_regeneration": None,
        },
        summary_patch={"currentStep": "publish_course", "courseId": course_id},
        compat_content_job_patch={
            "status": "completed",
            "courseId": course_id,
            "courseSessionIds": session_ids,
            "courseProgress": "Published",
            "jobRunId": ctx.run_id,
            "courseRegeneration": None,
            "thumbnailGenerationRequested": False,
        },
    )
