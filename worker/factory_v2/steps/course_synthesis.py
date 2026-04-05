"""Course audio synthesis steps, including chunk fan-out and session fan-in."""

from __future__ import annotations

import os
import shutil
from typing import Any

import config
from firebase_admin import firestore as fs

from observability import get_logger
from factory_v2.shared.course_tts_chunks import (
    assembled_wav_path,
    chunk_wav_path,
    cleanup_session_temp_dir,
    concatenate_wavs,
    parse_chunk_shard_key,
)

from .base import StepContext, StepResult
from .course_chunking import _course_session_chunks
from .course_common import (
    SESSION_DEFS,
    _content_job_data,
    _content_job_id,
    _count_audio_results,
    _course_code,
    _runtime,
    _session_def_by_shard,
)

logger = get_logger(__name__)


def _course_tts_job_data(
    ctx: StepContext,
    job_data: dict[str, Any],
    session_code: str,
) -> dict[str, Any]:
    content_job_id = _content_job_id(ctx.job)
    if not content_job_id:
        return dict(job_data)

    return {
        **dict(job_data),
        "_factoryContentJobId": content_job_id,
        "_courseTtsSessionCode": str(session_code).strip().upper(),
    }


def _persist_course_audio_checkpoint(
    ctx: StepContext,
    audio_results: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Checkpoint completed session audio into both V2 runtime and legacy compat fields.

    This makes course audio generation resumable. If a worker dies after 7/9
    sessions, the next run only needs to enqueue the missing shards.
    """
    job_id = str(ctx.job.get("id") or "").strip()
    if not job_id:
        return dict(audio_results)

    factory_ref = ctx.db.collection("factory_jobs").document(job_id)
    factory_tx = ctx.db.transaction()
    merged_audio_results: dict[str, dict[str, Any]] = dict(audio_results)
    completed = _count_audio_results(merged_audio_results)
    progress = f"Audio {completed}/{len(SESSION_DEFS)}"

    @fs.transactional
    def _tx_patch_factory(tx) -> None:
        nonlocal merged_audio_results, completed, progress
        snapshot = factory_ref.get(transaction=tx)
        if not snapshot.exists:
            return
        data = snapshot.to_dict() or {}
        active_run_id = str(data.get("current_run_id") or "").strip()
        if active_run_id and active_run_id != ctx.run_id:
            return

        runtime = dict(data.get("runtime") or {})
        existing_audio_results = dict(runtime.get("course_audio_results") or {})
        existing_audio_results.update(audio_results)
        merged_audio_results = existing_audio_results
        completed = _count_audio_results(merged_audio_results)
        progress = f"Audio {completed}/{len(SESSION_DEFS)}"

        tx.set(
            factory_ref,
            {
                "runtime": {"course_audio_results": merged_audio_results},
                "summary": {
                    "currentStep": "synthesize_course_audio",
                    "courseAudioCount": completed,
                },
                "updated_at": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    _tx_patch_factory(factory_tx)

    content_job_id = _content_job_id(ctx.job)
    if not content_job_id:
        return merged_audio_results

    content_ref = ctx.db.collection(config.JOBS_COLLECTION).document(content_job_id)
    transaction = ctx.db.transaction()

    @fs.transactional
    def _tx_patch(tx) -> None:
        nonlocal merged_audio_results, completed, progress
        snapshot = content_ref.get(transaction=tx)
        if not snapshot.exists:
            return
        data = snapshot.to_dict() or {}
        active_run_id = str(data.get("v2RunId") or "").strip()
        if active_run_id and active_run_id != ctx.run_id:
            return

        existing_audio_results = dict(data.get("courseAudioResults") or {})
        existing_audio_results.update(merged_audio_results)
        merged_audio_results = existing_audio_results
        completed = _count_audio_results(merged_audio_results)
        progress = f"Audio {completed}/{len(SESSION_DEFS)}"

        tx.set(
            content_ref,
            {
                "status": "tts_converting",
                "courseAudioResults": merged_audio_results,
                "courseProgress": progress,
                "jobRunId": ctx.run_id,
                "lastRunStatus": "running",
                "runEndedAt": None,
                "updatedAt": fs.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    _tx_patch(transaction)
    return merged_audio_results


def _stash_generated_wav(tmp_wav_path: str, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    shutil.move(tmp_wav_path, output_path)
    shutil.rmtree(os.path.dirname(tmp_wav_path), ignore_errors=True)


def _synthesize_course_session_audio_inline(
    *,
    ctx: StepContext,
    job_data: dict[str, Any],
    formatted_scripts: dict[str, str],
    audio_results: dict[str, dict[str, Any]],
    course_code: str,
    session_def: dict[str, Any],
) -> str:
    """Legacy/root-mode course synthesis path that handles one whole session inline."""
    from factory_v2.shared.audio_processor import post_process_audio
    from factory_v2.shared.storage_uploader import upload_audio
    from factory_v2.shared.tts_converter import convert_to_audio

    session_code = f"{course_code}{session_def['suffix']}"
    script = formatted_scripts.get(session_code)
    if not script:
        raise ValueError(f"Missing formatted script for {session_code}")

    wav_path = convert_to_audio(
        script,
        _course_tts_job_data(ctx, job_data, session_code),
    )
    mp3_path = post_process_audio(wav_path)

    session_job_data = {
        **job_data,
        "contentType": "course_session",
        "_factoryContentJobId": _content_job_id(ctx.job),
        "_factoryStepName": "upload_course_audio",
        "_factoryAssetKey": f"{_content_job_id(ctx.job)}-{session_code}",
        "params": {
            **(job_data.get("params") or {}),
            "topic": f"{course_code} {session_def['label']}",
        },
    }
    storage_path, duration_sec = upload_audio(mp3_path, session_job_data)
    audio_results[session_code] = {
        "storagePath": storage_path,
        "durationSec": duration_sec,
    }
    merged_audio_results = _persist_course_audio_checkpoint(ctx, audio_results)
    audio_results.clear()
    audio_results.update(merged_audio_results)
    return session_code


def _assemble_course_session_audio(
    *,
    ctx: StepContext,
    job_data: dict[str, Any],
    formatted_scripts: dict[str, str],
    audio_results: dict[str, dict[str, Any]],
    course_code: str,
    session_def: dict[str, Any],
) -> str:
    """Fan-in path for chunked TTS: stitch chunk WAVs, post-process, and upload."""
    from factory_v2.shared.audio_processor import post_process_audio
    from factory_v2.shared.storage_uploader import upload_audio
    from factory_v2.shared.tts_converter import convert_to_audio

    session_code, chunks = _course_session_chunks(formatted_scripts, course_code, session_def)
    tts_job_data = _course_tts_job_data(ctx, job_data, session_code)
    wav_paths: list[str] = []
    for chunk_index, chunk_text in enumerate(chunks):
        part_path = chunk_wav_path(ctx.run_id, session_code, chunk_index)
        if not part_path.is_file():
            logger.warning(
                "Course chunk WAV missing; regenerating during assembly",
                extra={
                    "job_id": ctx.job.get("id"),
                    "session_code": session_code,
                    "chunk_index": chunk_index,
                },
            )
            tmp_wav_path = convert_to_audio(chunk_text, tts_job_data)
            _stash_generated_wav(tmp_wav_path, str(part_path))
        wav_paths.append(str(part_path))
        ctx.progress(f"Assembled chunk {chunk_index + 1}/{len(chunks)} for {session_code}")

    merged_wav_path = assembled_wav_path(ctx.run_id, session_code)
    concatenate_wavs(wav_paths, str(merged_wav_path))
    mp3_path = post_process_audio(str(merged_wav_path))

    session_job_data = {
        **job_data,
        "contentType": "course_session",
        "_factoryContentJobId": _content_job_id(ctx.job),
        "_factoryStepName": "upload_course_audio",
        "_factoryAssetKey": f"{_content_job_id(ctx.job)}-{session_code}",
        "params": {
            **(job_data.get("params") or {}),
            "topic": f"{course_code} {session_def['label']}",
        },
    }
    storage_path, duration_sec = upload_audio(mp3_path, session_job_data)
    audio_results[session_code] = {
        "storagePath": storage_path,
        "durationSec": duration_sec,
    }
    merged_audio_results = _persist_course_audio_checkpoint(ctx, audio_results)
    audio_results.clear()
    audio_results.update(merged_audio_results)
    cleanup_session_temp_dir(ctx.run_id, session_code)
    return session_code


def execute_synthesize_course_audio(ctx: StepContext) -> StepResult:
    """Synthesize either one session shard or the full course, depending on `ctx.shard_key`."""
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    course_code = _course_code(job_data)
    formatted_scripts: dict[str, str] = dict(
        runtime.get("course_formatted_scripts") or job_data.get("courseFormattedScripts") or {}
    )
    if not formatted_scripts:
        raise ValueError("Missing runtime.course_formatted_scripts")

    audio_results: dict[str, dict[str, Any]] = dict(
        runtime.get("course_audio_results") or job_data.get("courseAudioResults") or {}
    )

    requested_shard = str(ctx.shard_key or "root").strip().upper()
    if requested_shard and requested_shard != "ROOT":
        # Session-level shard jobs are the fan-in stage after all chunk jobs for
        # a session have completed successfully.
        session_def = _session_def_by_shard(requested_shard)
        if session_def is None:
            raise ValueError(f"Unknown course synth shard '{requested_shard}'")

        session_code = f"{course_code}{session_def['suffix']}"
        if not audio_results.get(session_code, {}).get("storagePath"):
            session_code = _assemble_course_session_audio(
                ctx=ctx,
                job_data=job_data,
                formatted_scripts=formatted_scripts,
                audio_results=audio_results,
                course_code=course_code,
                session_def=session_def,
            )
            logger.info(
                "Course audio synthesized",
                extra={
                    "job_id": ctx.job.get("id"),
                    "session_code": session_code,
                    "shard_key": requested_shard,
                },
            )
        completed = _count_audio_results(audio_results)
        return StepResult(
            output={"audio_count": completed, "session_code": session_code, "shard_key": requested_shard},
            summary_patch={"currentStep": "synthesize_course_audio"},
        )

    for index, session_def in enumerate(SESSION_DEFS):
        # Root-mode execution is the fallback path used when fan-out chunking is
        # disabled or when older jobs still expect the simpler linear behavior.
        session_code = f"{course_code}{session_def['suffix']}"
        if audio_results.get(session_code, {}).get("storagePath"):
            continue
        session_code = _synthesize_course_session_audio_inline(
            ctx=ctx,
            job_data=job_data,
            formatted_scripts=formatted_scripts,
            audio_results=audio_results,
            course_code=course_code,
            session_def=session_def,
        )
        logger.info(
            "Course audio synthesized",
            extra={
                "job_id": ctx.job.get("id"),
                "session_code": session_code,
                "index": index,
                "shard_key": "root",
            },
        )
        ctx.progress(f"Synthesized session {index + 1}/{len(SESSION_DEFS)} ({session_code})")

    completed = _count_audio_results(audio_results)
    return StepResult(
        output={"audio_count": completed},
        summary_patch={"currentStep": "synthesize_course_audio"},
    )


def execute_synthesize_course_audio_chunk(ctx: StepContext) -> StepResult:
    """Synthesize exactly one chunk for one course session shard."""
    from factory_v2.shared.tts_converter import convert_to_audio

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    course_code = _course_code(job_data)
    formatted_scripts: dict[str, str] = dict(
        runtime.get("course_formatted_scripts") or job_data.get("courseFormattedScripts") or {}
    )
    if not formatted_scripts:
        raise ValueError("Missing runtime.course_formatted_scripts")

    parsed = parse_chunk_shard_key(ctx.shard_key)
    session_shard = str(
        (ctx.step_input.get("session_shard") or ctx.step_input.get("session_code") or (parsed[0] if parsed else "")) or ""
    ).strip().upper()
    if not session_shard:
        raise ValueError(f"Missing session shard for course synth chunk '{ctx.shard_key}'")

    session_def = _session_def_by_shard(session_shard)
    if session_def is None:
        raise ValueError(f"Unknown course synth chunk shard '{ctx.shard_key}'")

    session_code, chunks = _course_session_chunks(formatted_scripts, course_code, session_def)
    tts_job_data = _course_tts_job_data(ctx, job_data, session_code)

    chunk_index_raw = ctx.step_input.get("chunk_index")
    if chunk_index_raw is None and parsed is not None:
        chunk_index_raw = parsed[1]
    chunk_index = int(chunk_index_raw or 0)
    if chunk_index < 0 or chunk_index >= len(chunks):
        raise ValueError(
            f"Chunk index {chunk_index} out of range for {session_code} (chunk_count={len(chunks)})"
        )

    output_path = chunk_wav_path(ctx.run_id, session_code, chunk_index)
    if not output_path.is_file():
        tmp_wav_path = convert_to_audio(chunks[chunk_index], tts_job_data)
        _stash_generated_wav(tmp_wav_path, str(output_path))

    logger.info(
        "Course audio chunk synthesized",
        extra={
            "job_id": ctx.job.get("id"),
            "session_code": session_code,
            "chunk_index": chunk_index,
            "chunk_count": len(chunks),
            "shard_key": ctx.shard_key,
        },
    )
    ctx.progress(f"Chunk {chunk_index + 1}/{len(chunks)} ready for {session_code}")

    return StepResult(
        output={
            "session_code": session_code,
            "session_shard": session_shard,
            "chunk_index": chunk_index,
            "chunk_count": len(chunks),
            "chunk_wav_path": str(output_path),
        },
        summary_patch={"currentStep": "synthesize_course_audio"},
    )
