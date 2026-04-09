"""Step executors for the single-content workflow (non-course, non-subject jobs).

Architectural Role:
    Pipeline Step -- implements every step in the **single-content** pipeline
    (guided meditations, bedtime stories, soundscapes, etc.).  Each public
    ``execute_*`` function is a step executor with the standard
    ``(StepContext) -> StepResult`` signature registered in ``registry.py``.

Design Patterns:
    * **Template Method (implicit)** -- all executors share the same
      contract (receive ``StepContext``, return ``StepResult``), but each
      implements its own logic.  The claim-loop orchestrator treats them
      uniformly.
    * **Pipeline / Chain** -- each step reads artifacts from
      ``runtime`` (populated by the *previous* step's ``runtime_patch``) and
      writes new artifacts back.  The ordering is enforced by the step DAG
      in the ``factory_jobs`` document.
    * **Approval Checkpoint** -- some steps can pause the pipeline by
      returning an ``awaiting_*`` flag in their output, which signals the
      claim loop to stop advancing until an admin approves.

Key Dependencies:
    * ``factory_v2.shared.llm_generator`` -- LLM-backed script generation
    * ``factory_v2.shared.qa_formatter`` -- script QA/formatting
    * ``factory_v2.shared.image_generator`` -- thumbnail generation
    * ``factory_v2.shared.tts_converter`` -- text-to-speech synthesis
    * ``factory_v2.shared.audio_processor`` -- WAV-to-MP3 post-processing
    * ``factory_v2.shared.storage_uploader`` -- Cloud Storage upload
    * ``factory_v2.shared.content_publisher`` -- Firestore publish
    * ``factory_v2.shared.course_tts_chunks`` -- chunk splitting for fan-out TTS

Consumed By:
    * ``factory_v2.steps.registry`` -- maps step names to these functions.

Single-content pipeline order:
    generate_script -> format_script -> generate_image -> synthesize_audio
    (or synthesize_audio_chunk -> assemble_audio) -> post_process_audio
    -> upload_audio -> publish_content
"""

from __future__ import annotations

from typing import Any

import config

from .base import StepContext, StepResult


# ---------------------------------------------------------------------------
# Private helpers -- extract commonly needed fields from the job snapshot
# ---------------------------------------------------------------------------

def _content_job_data(job: dict) -> dict[str, Any]:
    """Extract the original content-job payload embedded in the V2 factory job.

    The V2 pipeline stores the legacy ``content_jobs`` document inside
    ``factory_jobs.request.content_job`` so that every step can access
    the original request parameters without a separate Firestore read.
    """
    request = job.get("request") or {}
    # Two field names are accepted for backward compatibility during migration.
    payload = request.get("content_job") or request.get("job_data") or {}
    if not payload:
        raise ValueError("factory_jobs.request.content_job is required")
    return dict(payload)


def _runtime(job: dict) -> dict[str, Any]:
    """Return a mutable copy of the runtime accumulator from previous steps."""
    return dict(job.get("runtime") or {})


def _content_job_id(job: dict) -> str:
    """Resolve the legacy ``content_jobs`` document ID for compat patching."""
    request = job.get("request") or {}
    compat = request.get("compat") or {}
    return str(compat.get("content_job_id") or "").strip()


def _script_approval(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, Any]:
    """Read the script-approval config, preferring runtime (set by this run)
    over the original job request (set by the admin UI).
    """
    payload = runtime.get("script_approval")
    if isinstance(payload, dict):
        return dict(payload)
    payload = job_data.get("scriptApproval")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def execute_generate_script(ctx: StepContext) -> StepResult:
    """Generate the draft script/title unless runtime already contains reusable output.

    This is the first step in the single-content pipeline.  It calls the
    configured LLM to produce a narration script, then optionally pauses at
    an **approval checkpoint** if the admin enabled script review.

    Idempotency:
        If ``runtime.generated_script`` already exists (e.g. from a previous
        run that was interrupted *after* this step), the LLM call is skipped
        entirely and the cached script is reused.

    Approval Flow:
        When ``scriptApproval.enabled`` is true and the script has not yet
        been approved, this step returns with ``awaiting_script_approval``
        set.  The claim loop writes a ``"completed"`` compat status so the
        admin UI shows the draft as ready for review.  A subsequent admin
        action writes ``scriptApprovedAt`` and re-triggers the pipeline.
    """
    # Deferred import keeps heavy LLM deps out of the module's top-level scope.
    from factory_v2.shared.llm_generator import generate_script

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    # Idempotency guard: reuse the script if a previous run already generated one.
    script = runtime.get("generated_script") or generate_script(job_data)
    # Title resolution cascade: runtime > explicit title > topic fallback.
    generated_title = (
        runtime.get("generated_title")
        or (job_data.get("title") or "").strip()
        or job_data.get("params", {}).get("topic", "Untitled").strip().title()
    )
    script_approval = _script_approval(runtime, job_data)
    # Approval is needed when the feature is enabled AND nobody has approved yet.
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
    """Run QA formatting over the generated script before image/TTS steps use it.

    Applies normalization rules (SSML cleanup, pause markers, whitespace) so
    the downstream TTS engine receives consistent, well-formed narration text.
    The formatted output is stored separately from the raw script so either
    version can be inspected in the admin UI.
    """
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
    """Build or reuse an image prompt, then generate and upload the thumbnail.

    The image prompt is either retrieved from a previous run/admin override or
    freshly generated from the content metadata.  ``force_regenerate`` causes
    the prompt to be rebuilt and a new image generated even when one already
    exists -- used when an admin requests a new thumbnail.
    """
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
    """Convert the formatted script into a WAV file using the configured TTS model.

    This is the *non-chunked* TTS path.  For longer scripts the pipeline may
    instead fan out to ``synthesize_audio_chunk`` + ``assemble_audio``.
    """
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


def execute_synthesize_audio_chunk(ctx: StepContext) -> StepResult:
    """Synthesize a single chunk of a fan-out single-content TTS job.

    Fan-out TTS splits a long script into smaller chunks that can be
    synthesized in parallel by separate workers.  Each shard gets its own
    ``shard_key`` encoding the chunk index (e.g. ``"chunk:2"``).  After
    all chunks complete, ``assemble_audio`` stitches them back together.

    Idempotency:
        If the chunk WAV already exists on disk (from a previous attempt),
        the TTS call is skipped.
    """
    from factory_v2.shared.tts_converter import convert_to_audio
    from factory_v2.shared.course_tts_chunks import (
        parse_single_chunk_shard_key,
        single_chunk_wav_path,
        split_course_tts_chunks,
    )

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    script = runtime.get("formatted_script")
    if not script:
        raise ValueError("Missing runtime.formatted_script")

    # Resolve chunk index from shard_key first, then fall back to step_input.
    chunk_index = parse_single_chunk_shard_key(ctx.shard_key)
    if chunk_index is None:
        chunk_index = (ctx.step_input or {}).get("chunk_index")
    if chunk_index is None:
        raise ValueError(f"Cannot determine chunk_index from shard_key={ctx.shard_key!r}")

    # Re-split the script to get the same chunk boundaries the fan-out step used.
    chunks = split_course_tts_chunks(script)
    if chunk_index >= len(chunks):
        raise ValueError(
            f"chunk_index {chunk_index} out of range (script has {len(chunks)} chunks)"
        )

    output_path = single_chunk_wav_path(ctx.run_id, chunk_index)
    # Idempotency: skip TTS if the WAV already exists from a prior attempt.
    if not output_path.is_file():
        tmp_wav = convert_to_audio(chunks[chunk_index], job_data)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.move(str(tmp_wav), str(output_path))

    return StepResult(
        output={
            "chunk_index": chunk_index,
            "chunk_count": len(chunks),
            "chunk_wav_path": str(output_path),
        },
        summary_patch={"currentStep": "synthesize_audio_chunk"},
        compat_content_job_patch={"status": "tts_converting", "jobRunId": ctx.run_id},
    )


def execute_assemble_audio(ctx: StepContext) -> StepResult:
    """Concatenate chunk WAVs, post-process to MP3, and upload the final audio.

    This is the **fan-in** counterpart to ``synthesize_audio_chunk``.  It
    collects every chunk WAV produced by the parallel shard jobs, stitches
    them into one contiguous WAV, encodes it to MP3, and uploads the result.

    Error Recovery:
        If any chunk WAV is missing (e.g. a shard worker crashed before
        writing to disk), the assembly step regenerates it inline rather
        than failing the entire pipeline.  This "best-effort repair" trades
        a bit of extra latency for significantly higher reliability.
    """
    from factory_v2.shared.tts_converter import convert_to_audio
    from factory_v2.shared.audio_processor import post_process_audio
    from factory_v2.shared.storage_uploader import upload_audio
    from factory_v2.shared.course_tts_chunks import (
        split_course_tts_chunks,
        single_chunk_wav_path,
        single_assembled_wav_path,
        concatenate_wavs,
        cleanup_single_content_temp_dir,
    )

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    content_job_id = _content_job_id(ctx.job)
    script = runtime.get("formatted_script")
    if not script:
        raise ValueError("Missing runtime.formatted_script")

    # Re-split the script so we know exactly how many chunks to expect and in
    # what order they should be concatenated.
    chunks = split_course_tts_chunks(script)
    wav_paths: list[str] = []

    for i, chunk_text in enumerate(chunks):
        chunk_path = single_chunk_wav_path(ctx.run_id, i)
        if not chunk_path.is_file():
            # Resilience: regenerate missing chunk inline instead of failing.
            tmp_wav = convert_to_audio(chunk_text, job_data)
            chunk_path.parent.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.move(str(tmp_wav), str(chunk_path))
        wav_paths.append(str(chunk_path))

    # Concatenate all chunks into one contiguous WAV, then encode to MP3.
    assembled_path = str(single_assembled_wav_path(ctx.run_id))
    concatenate_wavs(wav_paths, assembled_path)

    mp3_path = post_process_audio(assembled_path)
    storage_path, duration_sec = upload_audio(
        mp3_path,
        {
            **job_data,
            "_factoryContentJobId": content_job_id,
            "_factoryStepName": ctx.step_name,
        },
    )

    # Remove chunk WAVs now that the final MP3 is safely in Cloud Storage.
    cleanup_single_content_temp_dir(ctx.run_id)

    return StepResult(
        output={"storage_path": storage_path, "duration_sec": duration_sec},
        runtime_patch={"storage_path": storage_path, "duration_sec": duration_sec},
        summary_patch={"currentStep": "assemble_audio"},
        compat_content_job_patch={
            "status": "uploading",
            "audioPath": storage_path,
            "audioDurationSec": duration_sec,
            "jobRunId": ctx.run_id,
        },
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
    """Publish the final content document or stop at a manual-approval checkpoint.

    Two modes:
        * **Auto-publish** (default) -- the content is written to the
          app-facing ``contents`` collection immediately.
        * **Manual approval** -- when ``autoPublish`` is false, the step
          returns ``awaiting_approval`` and sets compat status to
          ``"completed"`` so the admin sees "ready for review".  An admin
          then sets ``status = "publishing"`` on the legacy content_job,
          which re-triggers this step and takes the publish branch.
    """
    from factory_v2.shared.content_publisher import publish_content

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    content_job_id = _content_job_id(ctx.job)
    request_status = (job_data.get("status") or "").strip().lower()
    auto_publish = bool(job_data.get("autoPublish", True))

    # Collect all artifacts produced by upstream steps.
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

    # Approval checkpoint: halt pipeline if manual review is required.
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
