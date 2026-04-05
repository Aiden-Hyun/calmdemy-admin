"""Bridge from legacy `content_jobs` documents into V2 workflow state."""

from __future__ import annotations

from firebase_admin import firestore as fs

from ..application.orchestrator import Orchestrator
from ..shared.lineage_timing import copy_artifacts
from ..infrastructure.firestore_repos import (
    FirestoreJobRepo,
    FirestoreRunRepo,
    FirestoreStepRunRepo,
)
from ..infrastructure.queue_repo import FirestoreQueueRepo


def _extract_runtime(content_job: dict, existing_runtime: dict | None = None) -> dict:
    """Build the V2 runtime snapshot from legacy fields on `content_jobs`.

    This is the compatibility handoff point: values that used to live only on
    `content_jobs` are copied into `factory_jobs.runtime` so V2 steps can read
    from one canonical runtime shape.
    """
    existing_runtime = dict(existing_runtime or {})
    return {
        "generated_script": content_job.get("generatedScript"),
        "formatted_script": content_job.get("formattedScript"),
        "generated_title": content_job.get("generatedTitle") or content_job.get("title"),
        "script_approval": content_job.get("scriptApproval"),
        "image_prompt": content_job.get("imagePrompt"),
        "image_path": content_job.get("imagePath"),
        "thumbnail_url": content_job.get("thumbnailUrl"),
        "image_model": content_job.get("imageModel"),
        "generate_thumbnail_during_run": content_job.get("generateThumbnailDuringRun"),
        "thumbnail_generation_requested": content_job.get("thumbnailGenerationRequested"),
        "storage_path": content_job.get("audioPath"),
        "duration_sec": content_job.get("audioDurationSec"),
        "published_content_id": content_job.get("publishedContentId"),
        "course_plan": content_job.get("coursePlan"),
        "course_raw_scripts": content_job.get("courseRawScripts"),
        "course_formatted_scripts": content_job.get("courseFormattedScripts"),
        "course_audio_results": content_job.get("courseAudioResults"),
        "course_preview_sessions": content_job.get("coursePreviewSessions"),
        "course_script_approval": content_job.get("courseScriptApproval"),
        "course_regeneration": content_job.get("courseRegeneration"),
        "course_id": content_job.get("courseId"),
        "course_session_ids": content_job.get("courseSessionIds"),
        "subject_plan": content_job.get("subjectPlan"),
        "subject_plan_approval": content_job.get("subjectPlanApproval"),
        "subject_progress": content_job.get("subjectProgress"),
        "child_job_ids": content_job.get("childJobIds"),
        "child_counts": content_job.get("childCounts"),
        "launch_cursor": content_job.get("launchCursor"),
        "pause_requested": content_job.get("pauseRequested"),
        "paused_at": content_job.get("pausedAt"),
        "max_active_child_courses": content_job.get("maxActiveChildCourses"),
        "artifacts": copy_artifacts({"runtime": existing_runtime}),
    }


def _course_generates_thumbnail_during_run(content_job: dict) -> bool:
    value = content_job.get("generateThumbnailDuringRun")
    if isinstance(value, bool):
        return value
    return True


def bootstrap_from_content_job(db, content_job_id: str, content_job: dict | None = None) -> str:
    """
    Create/merge a factory_v2 job from an existing content_jobs doc and start a run.

    Returns the V2 run id.
    """
    source_ref = db.collection("content_jobs").document(content_job_id)

    if content_job is None:
        source_snap = source_ref.get()
        if not source_snap.exists:
            raise KeyError(f"content_jobs/{content_job_id} not found")
        content_job = source_snap.to_dict() or {}

    content_type = content_job.get("contentType", "guided_meditation")
    status = content_job.get("status", "pending")
    is_course = content_type == "course"
    is_subject = content_type == "full_subject"
    generate_thumbnail_during_run = _course_generates_thumbnail_during_run(content_job)

    trigger = "bootstrap"
    first_step = "generate_course_plan" if is_course else "generate_subject_plan" if is_subject else None
    if status == "pending" and is_course:
        # Resume the course at the earliest missing step instead of re-running
        # the whole pipeline when plan/scripts/approvals already exist.
        if bool(content_job.get("thumbnailGenerationRequested")) and (content_job.get("coursePlan") or content_job.get("publishedContentId")):
            first_step = "generate_course_thumbnail"
        else:
            regeneration = content_job.get("courseRegeneration") or {}
            if isinstance(regeneration, dict) and regeneration.get("active"):
                mode = str(regeneration.get("mode") or "audio_only").strip().lower()
                if mode == "script_and_audio":
                    awaiting_script_approval = bool(regeneration.get("awaitingScriptApproval"))
                    script_approved = bool(
                        regeneration.get("scriptApprovedAt") or regeneration.get("scriptApprovedBy")
                    )
                    first_step = (
                        "format_course_scripts"
                        if script_approved and not awaiting_script_approval
                        else "generate_course_scripts"
                    )
                else:
                    first_step = "format_course_scripts"
            else:
                script_approval = content_job.get("courseScriptApproval") or {}
                if (
                    isinstance(script_approval, dict)
                    and script_approval.get("enabled")
                ):
                    has_existing_plan = bool(content_job.get("coursePlan"))
                    script_approved = bool(
                        script_approval.get("scriptApprovedAt") or script_approval.get("scriptApprovedBy")
                    )
                    awaiting_script_approval = bool(script_approval.get("awaitingApproval"))
                    if script_approved and not awaiting_script_approval:
                        first_step = "format_course_scripts"
                    elif has_existing_plan:
                        first_step = "generate_course_scripts"
    elif status == "pending":
        if is_subject:
            subject_plan = content_job.get("subjectPlan") or {}
            subject_plan_approval = content_job.get("subjectPlanApproval") or {}
            approval_enabled = bool(
                isinstance(subject_plan_approval, dict)
                and subject_plan_approval.get("enabled")
            )
            approval_awaiting = bool(
                isinstance(subject_plan_approval, dict)
                and subject_plan_approval.get("awaitingApproval")
            )
            approval_complete = bool(
                isinstance(subject_plan_approval, dict)
                and (
                    subject_plan_approval.get("approvedAt")
                    or subject_plan_approval.get("approvedBy")
                )
            )
            launch_cursor = int(content_job.get("launchCursor") or 0)
            child_job_ids = list(content_job.get("childJobIds") or [])
            has_plan = bool(isinstance(subject_plan, dict) and subject_plan.get("courses"))
            if has_plan and ((approval_enabled and approval_complete and not approval_awaiting) or not approval_enabled):
                first_step = (
                    "watch_subject_children"
                    if launch_cursor > 0 or len(child_job_ids) > 0
                    else "launch_subject_children"
                )
        else:
            if bool(content_job.get("thumbnailGenerationRequested")):
                first_step = "generate_image"
            else:
                script_approval = content_job.get("scriptApproval") or {}
                if (
                    isinstance(script_approval, dict)
                    and script_approval.get("enabled")
                    and bool(script_approval.get("scriptApprovedAt") or script_approval.get("scriptApprovedBy"))
                    and not bool(script_approval.get("awaitingApproval"))
                ):
                    first_step = "format_script"
    if status == "publishing":
        trigger = "manual_publish"
        first_step = "publish_course" if is_course else "publish_content"

    v2_job_id = content_job_id
    job_ref = db.collection("factory_jobs").document(v2_job_id)
    existing_job_snap = job_ref.get()
    existing_runtime = {}
    if existing_job_snap.exists:
        existing_runtime = dict((existing_job_snap.to_dict() or {}).get("runtime") or {})
    job_ref.set(
        {
            "job_type": "course" if is_course else "subject" if is_subject else "single_content",
            "current_state": "queued",
            "updated_at": fs.SERVER_TIMESTAMP,
            "created_at": fs.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    # Replace the nested request/runtime maps wholesale so reruns do not inherit
    # stale per-session script/audio fields from prior runs.
    job_ref.update(
        {
            "request": {
                "content_job": content_job,
                "compat": {
                    "content_job_id": content_job_id,
                },
            },
            "runtime": _extract_runtime(content_job, existing_runtime=existing_runtime),
        }
    )

    job_repo = FirestoreJobRepo(db)
    run_repo = FirestoreRunRepo(db)
    step_run_repo = FirestoreStepRunRepo(db)
    queue_repo = FirestoreQueueRepo(db)
    orchestrator = Orchestrator(job_repo, run_repo, step_run_repo, queue_repo)

    run_id = orchestrator.start_new_run(
        v2_job_id,
        trigger=trigger,
        first_step=first_step,
    )

    if (
        is_course
        and first_step in {"generate_course_scripts", "format_course_scripts"}
        and generate_thumbnail_during_run
        and not str(content_job.get("thumbnailUrl") or "").strip()
    ):
        # Script regeneration can jump into the middle of the course workflow,
        # but we still want the thumbnail step present if the course needs one.
        orchestrator._ensure_step_enqueued(
            job_repo.get(v2_job_id),
            v2_job_id,
            run_id,
            "generate_course_thumbnail",
        )

    source_ref.set(
        {
            "engine": "v2",
            "v2JobId": v2_job_id,
            "v2RunId": run_id,
            "updatedAt": fs.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    return run_id
