"""Step executors for the single-content workflow (non-course, non-subject jobs)."""

from __future__ import annotations

from typing import Any

import config

from .base import StepContext, StepResult


def _content_job_data(job: dict) -> dict[str, Any]:
    request = job.get("request") or {}
    payload = request.get("content_job") or request.get("job_data") or {}
    if not payload:
        raise ValueError("factory_jobs.request.content_job is required")
    return dict(payload)


def _runtime(job: dict) -> dict[str, Any]:
    return dict(job.get("runtime") or {})


def _content_job_id(job: dict) -> str:
    request = job.get("request") or {}
    compat = request.get("compat") or {}
    return str(compat.get("content_job_id") or "").strip()


def _script_approval(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, Any]:
    payload = runtime.get("script_approval")
    if isinstance(payload, dict):
        return dict(payload)
    payload = job_data.get("scriptApproval")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def execute_generate_script(ctx: StepContext) -> StepResult:
    """Generate the draft script/title unless runtime already contains reusable output."""
    from factory_v2.shared.llm_generator import generate_script

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    script = runtime.get("generated_script") or generate_script(job_data)
    generated_title = (
        runtime.get("generated_title")
        or (job_data.get("title") or "").strip()
        or job_data.get("params", {}).get("topic", "Untitled").strip().title()
    )
    script_approval = _script_approval(runtime, job_data)
    await_script_approval = (
        bool(script_approval.get("enabled"))
        and not bool(script_approval.get("scriptApprovedAt") or script_approval.get("scriptApprovedBy"))
    )

    if await_script_approval:
        # Approval checkpoints deliberately return a "completed" compat status so
        # the admin UI shows the draft as ready for review instead of "stuck".
        script_approval["awaitingApproval"] = True
        return StepResult(
            output={"word_count": len(script.split()), "awaiting_script_approval": True},
            runtime_patch={
                "generated_script": script,
                "generated_title": generated_title,
                "script_approval": script_approval,
            },
            summary_patch={
                "currentStep": "generate_script",
                "scriptWordCount": len(script.split()),
                "awaitingScriptApproval": True,
            },
            compat_content_job_patch={
                "status": "completed",
                "generatedScript": script,
                "generatedTitle": generated_title,
                "jobRunId": ctx.run_id,
                "scriptApproval": script_approval,
            },
        )

    return StepResult(
        output={"word_count": len(script.split())},
        runtime_patch={
            "generated_script": script,
            "generated_title": generated_title,
        },
        summary_patch={
            "currentStep": "generate_script",
            "scriptWordCount": len(script.split()),
        },
        compat_content_job_patch={
            "status": "llm_generating",
            "generatedScript": script,
            "generatedTitle": generated_title,
            "jobRunId": ctx.run_id,
        },
    )


def execute_format_script(ctx: StepContext) -> StepResult:
    """Run QA formatting over the generated script before image/TTS steps use it."""
    from factory_v2.shared.qa_formatter import format_script

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    script = runtime.get("generated_script")
    if not script:
        raise ValueError("Missing runtime.generated_script")

    formatted = format_script(script, job_data)

    return StepResult(
        output={"formatted_word_count": len(formatted.split())},
        runtime_patch={"formatted_script": formatted},
        summary_patch={
            "currentStep": "format_script",
            "formattedWordCount": len(formatted.split()),
        },
        compat_content_job_patch={
            "status": "qa_formatting",
            "formattedScript": formatted,
            "jobRunId": ctx.run_id,
        },
    )


def execute_generate_image(ctx: StepContext) -> StepResult:
    """Build or reuse an image prompt, then generate and upload the thumbnail."""
    from factory_v2.shared.image_generator import build_image_prompt, generate_image
    from factory_v2.shared.storage_uploader import upload_image

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    title = runtime.get("generated_title") or job_data.get("title") or "Untitled"
    topic = job_data.get("params", {}).get("topic", "")
    content_type = job_data.get("contentType", "guided_meditation")
    content_job_id = _content_job_id(ctx.job)

    force_regenerate = bool(
        runtime.get("thumbnail_generation_requested")
        or job_data.get("thumbnailGenerationRequested")
    )

    image_prompt = runtime.get("image_prompt") or job_data.get("imagePrompt")
    if not image_prompt or force_regenerate:
        image_prompt = build_image_prompt(
            job_data, title, topic, content_type,
            ignore_saved_prompt=force_regenerate,
        )

    local_image_path = generate_image(image_prompt)
    image_path, thumbnail_url = upload_image(
        local_image_path,
        {
            **job_data,
            "_factoryContentJobId": content_job_id,
            "_factoryStepName": ctx.step_name,
            "_factoryOverwriteExistingAsset": force_regenerate,
        },
    )

    return StepResult(
        output={"thumbnail_url": thumbnail_url},
        runtime_patch={
            "image_prompt": image_prompt,
            "image_path": image_path,
            "thumbnail_url": thumbnail_url,
            "image_model": config.IMAGE_MODEL_ID,
        },
        summary_patch={"currentStep": "generate_image"},
        compat_content_job_patch={
            "status": "image_generating",
            "imagePrompt": image_prompt,
            "imagePath": image_path,
            "thumbnailUrl": thumbnail_url,
            "imageModel": config.IMAGE_MODEL_ID,
            "thumbnailGenerationRequested": False,
            "jobRunId": ctx.run_id,
        },
    )


def execute_synthesize_audio(ctx: StepContext) -> StepResult:
    """Convert the formatted script into a WAV file using the configured TTS model."""
    from factory_v2.shared.tts_converter import convert_to_audio

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    script = runtime.get("formatted_script")
    if not script:
        raise ValueError("Missing runtime.formatted_script")

    wav_path = convert_to_audio(script, job_data)

    return StepResult(
        output={"wav_path": wav_path},
        runtime_patch={"wav_path": wav_path},
        summary_patch={"currentStep": "synthesize_audio"},
        compat_content_job_patch={"status": "tts_converting", "jobRunId": ctx.run_id},
    )


def execute_post_process_audio(ctx: StepContext) -> StepResult:
    """Normalize the raw WAV and encode it into the final MP3 artifact."""
    from factory_v2.shared.audio_processor import post_process_audio

    runtime = _runtime(ctx.job)
    wav_path = runtime.get("wav_path")
    if not wav_path:
        raise ValueError("Missing runtime.wav_path")

    mp3_path = post_process_audio(wav_path)

    return StepResult(
        output={"mp3_path": mp3_path},
        runtime_patch={"mp3_path": mp3_path},
        summary_patch={"currentStep": "post_process_audio"},
        compat_content_job_patch={"status": "post_processing", "jobRunId": ctx.run_id},
    )


def execute_upload_audio(ctx: StepContext) -> StepResult:
    """Upload the MP3 and persist its storage path/duration for later publish."""
    from factory_v2.shared.storage_uploader import upload_audio

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    content_job_id = _content_job_id(ctx.job)
    mp3_path = runtime.get("mp3_path")
    if not mp3_path:
        raise ValueError("Missing runtime.mp3_path")

    storage_path, duration_sec = upload_audio(
        mp3_path,
        {
            **job_data,
            "_factoryContentJobId": content_job_id,
            "_factoryStepName": ctx.step_name,
        },
    )

    return StepResult(
        output={"storage_path": storage_path, "duration_sec": duration_sec},
        runtime_patch={"storage_path": storage_path, "duration_sec": duration_sec},
        summary_patch={"currentStep": "upload_audio"},
        compat_content_job_patch={
            "status": "uploading",
            "audioPath": storage_path,
            "audioDurationSec": duration_sec,
            "jobRunId": ctx.run_id,
        },
    )


def execute_publish_content(ctx: StepContext) -> StepResult:
    """Publish the final content document or stop at a manual-approval checkpoint."""
    from factory_v2.shared.content_publisher import publish_content

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    content_job_id = _content_job_id(ctx.job)
    request_status = (job_data.get("status") or "").strip().lower()
    auto_publish = bool(job_data.get("autoPublish", True))

    storage_path = runtime.get("storage_path")
    duration_sec = runtime.get("duration_sec")
    formatted_script = runtime.get("formatted_script")
    generated_title = runtime.get("generated_title")

    if not storage_path:
        raise ValueError("Missing runtime.storage_path")
    if not duration_sec:
        raise ValueError("Missing runtime.duration_sec")
    if not formatted_script:
        raise ValueError("Missing runtime.formatted_script")

    if not auto_publish and request_status != "publishing":
        # This mirrors the course approval flow: generation can finish while
        # publish remains a separate explicit admin action.
        return StepResult(
            output={"awaiting_approval": True},
            summary_patch={
                "currentStep": "publish_content",
                "awaitingApproval": True,
            },
            compat_content_job_patch={
                "status": "completed",
                "audioPath": storage_path,
                "audioDurationSec": duration_sec,
                "thumbnailUrl": runtime.get("thumbnail_url") or job_data.get("thumbnailUrl", ""),
                "jobRunId": ctx.run_id,
            },
        )

    publish_job_data = {
        **job_data,
        "_resolvedTitle": generated_title,
        "thumbnailUrl": runtime.get("thumbnail_url") or job_data.get("thumbnailUrl", ""),
    }

    content_id = publish_content(
        ctx.db,
        storage_path,
        float(duration_sec),
        formatted_script,
        {
            **publish_job_data,
            "_factoryContentJobId": content_job_id,
        },
    )

    return StepResult(
        output={"published_content_id": content_id},
        runtime_patch={"published_content_id": content_id},
        summary_patch={
            "currentStep": "publish_content",
            "publishedContentId": content_id,
        },
        compat_content_job_patch={
            "status": "completed",
            "publishedContentId": content_id,
            "audioPath": storage_path,
            "audioDurationSec": duration_sec,
            "thumbnailUrl": runtime.get("thumbnail_url") or job_data.get("thumbnailUrl", ""),
            "jobRunId": ctx.run_id,
        },
    )
