"""Helpers that keep legacy ``content_jobs`` status fields aligned with V2 state.

Architectural Role:
    This module implements a **Read-Model Projection** (sometimes called
    a "compatibility projection").  The V2 pipeline stores its canonical
    state in ``factory_jobs`` / ``factory_job_runs`` / ``factory_step_runs``,
    but the admin UI still reads the old ``content_jobs`` document.  These
    helpers translate V2 events into writes against the legacy schema so
    the UI stays in sync without being rewritten.

Design Patterns:
    * **Read-Model / CQRS Projection** -- The write model (V2 repos) and
      the read model (``content_jobs``) diverge in shape.  This module is
      the synchronisation layer between them.
    * **Stage Mapping Table** -- A static dict maps internal V2 step
      names to the legacy stage labels the admin UI expects (e.g.
      ``"synthesize_audio"`` -> ``"tts_converting"``).  New steps only
      need one line added here.

Key Dependencies:
    * ``job_repo.patch_compat_content_job_for_run`` -- the repo method
      that performs the actual Firestore write against ``content_jobs``.

Consumed By:
    * ``ClaimLoop`` calls ``patch_running_status`` when a step starts
      and ``patch_failed_status`` when a step fails terminally.
    * ``RecoveryManager`` calls ``patch_failed_status`` when the
      watchdog gives up on a stuck step.
"""

from __future__ import annotations

from firebase_admin import firestore as fs


# Maps V2 step names to the legacy "stage" labels shown in the admin UI.
# When adding a new step, add a row here so the UI displays a sensible label.
_COMPAT_STAGE_BY_STEP = {
    "generate_script": "llm_generating",
    "format_script": "qa_formatting",
    "generate_image": "image_generating",
    "synthesize_audio": "tts_converting",
    "post_process_audio": "post_processing",
    "upload_audio": "uploading",
    "publish_content": "publishing",
    "generate_course_plan": "llm_generating",
    "generate_course_scripts": "llm_generating",
    "format_course_scripts": "qa_formatting",
    "generate_course_thumbnail": "image_generating",
    "synthesize_course_audio_chunk": "tts_converting",
    "synthesize_course_audio": "tts_converting",
    "upload_course_audio": "uploading",
    "publish_course": "publishing",
    "generate_subject_plan": "llm_generating",
    "launch_subject_children": "llm_generating",
    "watch_subject_children": "llm_generating",
}


def compat_failed_stage(step_name: str) -> str:
    """Map a V2 step name to the legacy stage label the admin UI expects.

    Falls back to ``"pending"`` for unknown steps so the UI always has
    a displayable value.
    """
    return _COMPAT_STAGE_BY_STEP.get(step_name, "pending")


def patch_running_status(job_repo, content_job_id: str, run_id: str, step_name: str) -> None:
    """Project a step start into the legacy ``content_jobs`` document.

    This lets the admin UI show the current stage label (e.g.
    ``"tts_converting"``) and a ``"running"`` badge while the step
    executes.
    """
    job_repo.patch_compat_content_job_for_run(
        content_job_id,
        run_id,
        {
            "status": compat_failed_stage(step_name),
            "jobRunId": run_id,
            "lastRunStatus": "running",
            "runEndedAt": None,
        },
    )


def patch_failed_status(
    job_repo,
    content_job_id: str,
    run_id: str,
    step_name: str,
    *,
    error_msg: str,
    error_code: str,
) -> None:
    """Project a terminal step failure into the legacy ``content_jobs`` document.

    Sets ``status=failed``, records the error details and the failed
    stage, and stamps ``runEndedAt`` with a server timestamp so the
    admin UI can display when the run stopped.
    """
    job_repo.patch_compat_content_job_for_run(
        content_job_id,
        run_id,
        {
            "status": "failed",
            "error": error_msg,
            "errorCode": error_code,
            "failedStage": compat_failed_stage(step_name),
            "jobRunId": run_id,
            "lastRunStatus": "failed",
            "runEndedAt": fs.SERVER_TIMESTAMP,
        },
    )
