"""Artifact-lineage and timing helpers for answering "what produced this output?"."""

from __future__ import annotations

from collections.abc import Iterable
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from firebase_admin import firestore as fs

TIMING_VERSION = 1
LINEAGE_COLLECTION = "factory_job_lineage"


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if hasattr(value, "to_datetime"):
        return value.to_datetime()
    if hasattr(value, "toDate"):
        return value.toDate()
    return None


def _runtime(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("runtime")
    return dict(payload) if isinstance(payload, dict) else {}


def _content_job(job: dict[str, Any]) -> dict[str, Any]:
    request = job.get("request") or {}
    payload = request.get("content_job") or request.get("job_data") or {}
    return dict(payload) if isinstance(payload, dict) else {}


def _job_type(job: dict[str, Any]) -> str:
    job_type = str(job.get("job_type") or "").strip().lower()
    if job_type:
        return job_type
    content_type = str(_content_job(job).get("contentType") or "").strip().lower()
    if content_type == "course":
        return "course"
    if content_type == "full_subject":
        return "subject"
    return "single_content"


def _compat_content_job_id(job: dict[str, Any]) -> str:
    request = job.get("request") or {}
    compat = request.get("compat") or {}
    return str(compat.get("content_job_id") or "").strip()


def step_run_id(run_id: str, step_name: str, shard_key: str = "root") -> str:
    normalized_shard = str(shard_key or "root").strip() or "root"
    return f"{run_id}__{step_name}__{normalized_shard}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def artifact_record(
    *,
    artifact_key: str,
    kind: str,
    origin_job_id: str,
    origin_run_id: str,
    origin_step_run_id: str,
    dependency_artifact_keys: list[str] | None = None,
    dependency_child_job_ids: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "artifact_key": artifact_key,
        "kind": kind,
        "origin_job_id": origin_job_id,
        "origin_run_id": origin_run_id,
        "origin_step_run_id": origin_step_run_id,
        "dependency_artifact_keys": list(dependency_artifact_keys or []),
        "dependency_child_job_ids": list(dependency_child_job_ids or []),
        "created_at": now_utc(),
    }


def copy_artifacts(job: dict[str, Any]) -> dict[str, dict[str, Any]]:
    artifacts = _runtime(job).get("artifacts") or {}
    if not isinstance(artifacts, dict):
        return {}
    return deepcopy(artifacts)


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _changed(before: Any, after: Any) -> bool:
    return before != after


def _sorted_unique_strings(values: Iterable[Any]) -> list[str]:
    result = sorted({str(value).strip() for value in values if str(value).strip()})
    return result


def _course_session_code_from_shard(after_job: dict[str, Any], shard_key: str, step_output: dict[str, Any]) -> str:
    session_code = str(step_output.get("session_code") or "").strip().upper()
    if session_code:
        return session_code

    shard = str(step_output.get("session_shard") or shard_key or "").strip().upper()
    if not shard or shard == "ROOT":
        return ""

    params = (_content_job(after_job).get("params") or {})
    course_code = str(params.get("courseCode") or "COURSE101").strip().upper() or "COURSE101"
    return f"{course_code}{shard}"


def _course_chunk_artifact_keys(
    artifacts: dict[str, dict[str, Any]],
    session_code: str,
) -> list[str]:
    prefix = f"course.audio_chunk.{session_code}."
    return sorted(key for key in artifacts.keys() if key.startswith(prefix))


def _course_audio_dependency_keys(
    artifacts: dict[str, dict[str, Any]],
    session_code: str,
) -> list[str]:
    chunk_keys = _course_chunk_artifact_keys(artifacts, session_code)
    if chunk_keys:
        return chunk_keys
    return [f"course.formatted_script.{session_code}"]


def build_artifact_updates(
    *,
    before_job: dict[str, Any],
    after_job: dict[str, Any],
    run_id: str,
    step_name: str,
    shard_key: str = "root",
    step_input: dict[str, Any] | None = None,
    step_output: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Derive lineage records that should be attached after a successful step."""
    step_input = dict(step_input or {})
    step_output = dict(step_output or {})
    before_runtime = _runtime(before_job)
    after_runtime = _runtime(after_job)
    updates: dict[str, dict[str, Any]] = {}
    artifacts = copy_artifacts(before_job)
    artifacts.update(copy_artifacts(after_job))
    origin_job_id = str(after_job.get("id") or before_job.get("id") or "").strip()
    origin_step_id = step_run_id(run_id, step_name, shard_key)
    job_type = _job_type(after_job)

    def put(
        artifact_key: str,
        kind: str,
        *,
        dependency_artifact_keys: list[str] | None = None,
        dependency_child_job_ids: list[str] | None = None,
    ) -> None:
        record = artifact_record(
            artifact_key=artifact_key,
            kind=kind,
            origin_job_id=origin_job_id,
            origin_run_id=run_id,
            origin_step_run_id=origin_step_id,
            dependency_artifact_keys=dependency_artifact_keys,
            dependency_child_job_ids=dependency_child_job_ids,
        )
        updates[artifact_key] = record
        artifacts[artifact_key] = record

    if job_type == "single_content":
        before_generated = str(before_runtime.get("generated_script") or "").strip()
        after_generated = str(after_runtime.get("generated_script") or "").strip()
        before_formatted = str(before_runtime.get("formatted_script") or "").strip()
        after_formatted = str(after_runtime.get("formatted_script") or "").strip()
        before_thumbnail = str(before_runtime.get("thumbnail_url") or "").strip()
        after_thumbnail = str(after_runtime.get("thumbnail_url") or "").strip()
        before_wav = str(before_runtime.get("wav_path") or "").strip()
        after_wav = str(after_runtime.get("wav_path") or "").strip()
        before_mp3 = str(before_runtime.get("mp3_path") or "").strip()
        after_mp3 = str(after_runtime.get("mp3_path") or "").strip()
        before_storage = str(before_runtime.get("storage_path") or "").strip()
        after_storage = str(after_runtime.get("storage_path") or "").strip()
        before_published = str(before_runtime.get("published_content_id") or "").strip()
        after_published = str(after_runtime.get("published_content_id") or "").strip()

        if step_name == "generate_script" and after_generated and _changed(before_generated, after_generated):
            put("single.generated_script", "single_generated_script")
        elif step_name == "format_script" and after_formatted and _changed(before_formatted, after_formatted):
            put(
                "single.formatted_script",
                "single_formatted_script",
                dependency_artifact_keys=["single.generated_script"],
            )
        elif step_name == "generate_image" and after_thumbnail and _changed(before_thumbnail, after_thumbnail):
            put(
                "single.image",
                "single_image",
                dependency_artifact_keys=["single.formatted_script"],
            )
        elif step_name == "synthesize_audio" and after_wav and _changed(before_wav, after_wav):
            put(
                "single.wav",
                "single_wav",
                dependency_artifact_keys=["single.formatted_script"],
            )
        elif step_name == "post_process_audio" and after_mp3 and _changed(before_mp3, after_mp3):
            put(
                "single.mp3",
                "single_mp3",
                dependency_artifact_keys=["single.wav"],
            )
        elif step_name == "upload_audio" and after_storage and _changed(before_storage, after_storage):
            put(
                "single.audio",
                "single_audio",
                dependency_artifact_keys=["single.mp3"],
            )
        elif step_name == "publish_content":
            awaiting_approval = bool(step_output.get("awaiting_approval"))
            if not awaiting_approval and (after_published or before_published):
                put(
                    "single.publish",
                    "single_publish",
                    dependency_artifact_keys=["single.image", "single.audio"],
                )

        return updates

    if job_type == "course":
        before_plan = before_runtime.get("course_plan")
        after_plan = after_runtime.get("course_plan")
        before_thumbnail = str(before_runtime.get("thumbnail_url") or "").strip()
        after_thumbnail = str(after_runtime.get("thumbnail_url") or "").strip()
        before_raw = _dict_or_empty(before_runtime.get("course_raw_scripts"))
        after_raw = _dict_or_empty(after_runtime.get("course_raw_scripts"))
        before_formatted = _dict_or_empty(before_runtime.get("course_formatted_scripts"))
        after_formatted = _dict_or_empty(after_runtime.get("course_formatted_scripts"))
        before_audio = _dict_or_empty(before_runtime.get("course_audio_results"))
        after_audio = _dict_or_empty(after_runtime.get("course_audio_results"))
        after_course_id = str(after_runtime.get("course_id") or "").strip()
        after_session_ids = after_runtime.get("course_session_ids") or []

        if step_name == "generate_course_plan" and after_plan and _changed(before_plan, after_plan):
            put("course.plan", "course_plan")
        elif step_name == "generate_course_thumbnail" and after_thumbnail and _changed(before_thumbnail, after_thumbnail):
            put(
                "course.thumbnail",
                "course_thumbnail",
                dependency_artifact_keys=["course.plan"],
            )
        elif step_name == "generate_course_scripts":
            for session_code, script in after_raw.items():
                normalized_code = str(session_code or "").strip().upper()
                normalized_script = str(script or "").strip()
                if not normalized_code or not normalized_script:
                    continue
                if _changed(str(before_raw.get(session_code) or "").strip(), normalized_script):
                    put(
                        f"course.raw_script.{normalized_code}",
                        "course_raw_script",
                        dependency_artifact_keys=["course.plan"],
                    )
        elif step_name == "format_course_scripts":
            for session_code, script in after_formatted.items():
                normalized_code = str(session_code or "").strip().upper()
                normalized_script = str(script or "").strip()
                if not normalized_code or not normalized_script:
                    continue
                if _changed(str(before_formatted.get(session_code) or "").strip(), normalized_script):
                    put(
                        f"course.formatted_script.{normalized_code}",
                        "course_formatted_script",
                        dependency_artifact_keys=[f"course.raw_script.{normalized_code}"],
                    )
        elif step_name == "synthesize_course_audio_chunk":
            session_code = _course_session_code_from_shard(after_job, shard_key, step_output)
            chunk_index = step_output.get("chunk_index")
            if session_code and chunk_index is not None:
                put(
                    f"course.audio_chunk.{session_code}.{int(chunk_index)}",
                    "course_audio_chunk",
                    dependency_artifact_keys=[f"course.formatted_script.{session_code}"],
                )
        elif step_name == "synthesize_course_audio":
            target_session_codes: set[str] = set()
            step_session_code = _course_session_code_from_shard(after_job, shard_key, step_output)
            if step_session_code:
                target_session_codes.add(step_session_code)
            for session_code, payload in after_audio.items():
                normalized_code = str(session_code or "").strip().upper()
                if not normalized_code:
                    continue
                storage_path = str((_dict_or_empty(payload)).get("storagePath") or "").strip()
                if not storage_path:
                    continue
                before_payload = _dict_or_empty(before_audio.get(session_code))
                if _changed(before_payload, payload):
                    target_session_codes.add(normalized_code)

            for session_code in sorted(target_session_codes):
                after_payload = _dict_or_empty(after_audio.get(session_code))
                if not str(after_payload.get("storagePath") or "").strip():
                    continue
                put(
                    f"course.audio.{session_code}",
                    "course_audio_session",
                    dependency_artifact_keys=_course_audio_dependency_keys(artifacts, session_code),
                )
        elif step_name == "upload_course_audio":
            session_keys = sorted(
                f"course.audio.{str(session_code or '').strip().upper()}"
                for session_code, payload in after_audio.items()
                if str((_dict_or_empty(payload)).get("storagePath") or "").strip()
            )
            if session_keys:
                put(
                    "course.audio_bundle",
                    "course_audio_bundle",
                    dependency_artifact_keys=session_keys,
                )
        elif step_name == "publish_course":
            awaiting_approval = bool(step_output.get("awaiting_approval"))
            if not awaiting_approval and (after_course_id or after_session_ids):
                deps = ["course.plan", "course.thumbnail"]
                if "course.audio_bundle" in artifacts or "course.audio_bundle" in updates:
                    deps.append("course.audio_bundle")
                else:
                    deps.extend(
                        sorted(
                            f"course.audio.{str(session_code or '').strip().upper()}"
                            for session_code, payload in after_audio.items()
                            if str((_dict_or_empty(payload)).get("storagePath") or "").strip()
                        )
                    )
                put(
                    "course.publish",
                    "course_publish",
                    dependency_artifact_keys=_sorted_unique_strings(deps),
                )

        return updates

    before_plan = before_runtime.get("subject_plan")
    after_plan = after_runtime.get("subject_plan")
    after_child_ids = _sorted_unique_strings(after_runtime.get("child_job_ids") or [])
    subject_state = str(after_runtime.get("subject_state") or "").strip().lower()

    if step_name == "generate_subject_plan" and after_plan and _changed(before_plan, after_plan):
        put("subject.plan", "subject_plan")
    elif step_name == "launch_subject_children":
        put(
            "subject.launch",
            "subject_launch",
            dependency_artifact_keys=["subject.plan"],
        )
    elif step_name == "watch_subject_children" and subject_state == "completed":
        put(
            "subject.publish",
            "subject_publish",
            dependency_artifact_keys=["subject.launch"],
            dependency_child_job_ids=after_child_ids,
        )

    return updates


def merge_artifacts(
    existing: dict[str, dict[str, Any]] | None,
    updates: dict[str, dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    merged = deepcopy(existing or {})
    merged.update(deepcopy(updates or {}))
    return merged


def _step_run_docs_for_job(db, job_id: str) -> list[dict[str, Any]]:
    docs = []
    for snap in db.collection("factory_step_runs").where("job_id", "==", job_id).stream():
        data = snap.to_dict() or {}
        docs.append({"id": snap.id, **data})
    return docs


def _step_run_interval(doc: dict[str, Any]) -> tuple[int, int] | None:
    worker_id = str(doc.get("worker_id") or "").strip().lower()
    if worker_id == "checkpoint":
        return None
    started_at = _coerce_datetime(doc.get("started_at"))
    ended_at = _coerce_datetime(doc.get("ended_at"))
    if started_at is None or ended_at is None:
        return None
    start_ms = int(started_at.timestamp() * 1000)
    end_ms = int(ended_at.timestamp() * 1000)
    if end_ms < start_ms:
        end_ms = start_ms
    return start_ms, end_ms


def _merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not intervals:
        return []
    sorted_intervals = sorted(intervals)
    merged: list[tuple[int, int]] = [sorted_intervals[0]]
    for start_ms, end_ms in sorted_intervals[1:]:
        last_start, last_end = merged[-1]
        if start_ms <= last_end:
            merged[-1] = (last_start, max(last_end, end_ms))
        else:
            merged.append((start_ms, end_ms))
    return merged


def _duration_ms(intervals: Iterable[tuple[int, int]]) -> int:
    return sum(max(0, end_ms - start_ms) for start_ms, end_ms in intervals)


def compute_live_run_elapsed_ms(db, job_id: str, run_id: str) -> int:
    """Approximate active runtime by merging step intervals without double-counting overlap."""
    intervals: list[tuple[int, int]] = []
    now_ms = int(now_utc().timestamp() * 1000)
    for doc in _step_run_docs_for_job(db, job_id):
        if str(doc.get("run_id") or "").strip() != str(run_id or "").strip():
            continue
        state = str(doc.get("state") or "").strip().lower()
        if state not in {"running", "succeeded", "failed"}:
            continue
        if state == "running":
            worker_id = str(doc.get("worker_id") or "").strip().lower()
            if worker_id == "checkpoint":
                continue
            started_at = _coerce_datetime(doc.get("started_at"))
            if started_at is None:
                continue
            start_ms = int(started_at.timestamp() * 1000)
            interval = (start_ms, max(start_ms, now_ms))
        else:
            interval = _step_run_interval(doc)
            if interval is None:
                continue
        intervals.append(interval)
    return _duration_ms(_merge_intervals(intervals))


def _collect_contributing_artifacts(
    artifacts: dict[str, dict[str, Any]],
    root_artifact_keys: list[str],
) -> tuple[set[str], set[str], set[str], set[str]]:
    contributing_step_run_ids: set[str] = set()
    contributing_run_ids: set[str] = set()
    contributing_artifact_keys: set[str] = set()
    contributing_child_job_ids: set[str] = set()
    pending = list(root_artifact_keys)

    while pending:
        artifact_key = pending.pop()
        if artifact_key in contributing_artifact_keys:
            continue
        artifact = artifacts.get(artifact_key)
        if not isinstance(artifact, dict):
            continue
        contributing_artifact_keys.add(artifact_key)
        origin_step_run_id = str(artifact.get("origin_step_run_id") or "").strip()
        if origin_step_run_id:
            contributing_step_run_ids.add(origin_step_run_id)
        origin_run_id = str(artifact.get("origin_run_id") or "").strip()
        if origin_run_id:
            contributing_run_ids.add(origin_run_id)
        for dependency_key in artifact.get("dependency_artifact_keys") or []:
            normalized_key = str(dependency_key or "").strip()
            if normalized_key:
                pending.append(normalized_key)
        for child_job_id in artifact.get("dependency_child_job_ids") or []:
            normalized_job_id = str(child_job_id or "").strip()
            if normalized_job_id:
                contributing_child_job_ids.add(normalized_job_id)

    return (
        contributing_step_run_ids,
        contributing_run_ids,
        contributing_artifact_keys,
        contributing_child_job_ids,
    )


def _root_artifact_keys_for_job(job_type: str, content_job: dict[str, Any], runtime: dict[str, Any]) -> list[str]:
    if job_type == "single_content":
        if str(content_job.get("publishedContentId") or runtime.get("published_content_id") or "").strip():
            return ["single.publish"]
        return []
    if job_type == "course":
        course_id = str(content_job.get("courseId") or runtime.get("course_id") or "").strip()
        session_ids = content_job.get("courseSessionIds") or runtime.get("course_session_ids") or []
        if course_id and session_ids:
            return ["course.publish"]
        return []
    if str(content_job.get("status") or "").strip().lower() != "completed":
        return []
    subject_state = str(runtime.get("subject_state") or "").strip().lower()
    if subject_state == "completed":
        return ["subject.publish"]
    return []


def _lineage_doc_data(snapshot) -> dict[str, Any] | None:
    if snapshot is None or not getattr(snapshot, "exists", False):
        return None
    data = snapshot.to_dict() or {}
    return dict(data)


def _persist_job_timing(
    db,
    content_job_id: str,
    *,
    timing_status: str,
    effective_elapsed_ms: int,
    effective_worker_ms: int,
    reuse_credit_ms: int,
    wasted_worker_ms: int,
    queue_latency_ms: int,
    parallelism_factor: float,
) -> dict[str, Any]:
    payload = {
        "timingStatus": timing_status,
        "effectiveElapsedMs": effective_elapsed_ms,
        "effectiveWorkerMs": effective_worker_ms,
        "reuseCreditMs": reuse_credit_ms,
        "wastedWorkerMs": wasted_worker_ms,
        "queueLatencyMs": queue_latency_ms,
        "parallelismFactor": parallelism_factor,
        "timingVersion": TIMING_VERSION,
        "timingComputedAt": fs.SERVER_TIMESTAMP,
        "activeRunElapsedMs": effective_elapsed_ms,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    db.collection("content_jobs").document(content_job_id).set(payload, merge=True)
    return payload


def finalize_job_timing(
    db,
    *,
    job_id: str,
    run_id: str,
    content_job_id: str,
) -> dict[str, Any] | None:
    """Persist final timing/lineage summaries once a run has truly produced publishable output."""
    if not job_id or not content_job_id or not run_id:
        return None

    job_snap = db.collection("factory_jobs").document(job_id).get()
    if not job_snap.exists:
        return None
    job = {"id": job_snap.id, **(job_snap.to_dict() or {})}
    runtime = _runtime(job)
    content_snap = db.collection("content_jobs").document(content_job_id).get()
    if not content_snap.exists:
        return None
    content_job = content_snap.to_dict() or {}
    job_type = _job_type(job)
    root_artifact_keys = _root_artifact_keys_for_job(job_type, content_job, runtime)
    if not root_artifact_keys:
        return None

    artifacts = copy_artifacts(job)
    (
        contributing_step_run_ids,
        contributing_run_ids,
        _contributing_artifact_keys,
        contributing_child_job_ids,
    ) = _collect_contributing_artifacts(artifacts, root_artifact_keys)

    step_run_docs = _step_run_docs_for_job(db, job_id)
    step_run_doc_by_id = {str(doc.get("id") or ""): doc for doc in step_run_docs}

    child_intervals: list[tuple[int, int]] = []
    child_worker_ms = 0
    child_reuse_credit_ms = 0
    child_wasted_worker_ms = 0
    child_contributing_run_ids: set[str] = set()
    child_contributing_step_run_ids: set[str] = set()

    if job_type == "subject":
        if not contributing_child_job_ids:
            runtime_child_ids = runtime.get("child_job_ids") or content_job.get("childJobIds") or []
            contributing_child_job_ids = set(_sorted_unique_strings(runtime_child_ids))

        for child_job_id in sorted(contributing_child_job_ids):
            child_lineage = _lineage_doc_data(
                db.collection(LINEAGE_COLLECTION).document(child_job_id).get()
            )
            if child_lineage is None:
                return None
            child_worker_ms += int(child_lineage.get("effective_worker_ms") or 0)
            child_reuse_credit_ms += int(child_lineage.get("reuse_credit_ms") or 0)
            child_wasted_worker_ms += int(child_lineage.get("wasted_worker_ms") or 0)
            child_contributing_run_ids.update(
                _sorted_unique_strings(child_lineage.get("contributing_run_ids") or [])
            )
            child_step_ids = _sorted_unique_strings(child_lineage.get("contributing_step_run_ids") or [])
            child_contributing_step_run_ids.update(child_step_ids)
            for step_run_id_value in child_step_ids:
                snap = db.collection("factory_step_runs").document(step_run_id_value).get()
                if not getattr(snap, "exists", False):
                    continue
                interval = _step_run_interval({"id": snap.id, **(snap.to_dict() or {})})
                if interval is not None:
                    child_intervals.append(interval)

    contributing_intervals: list[tuple[int, int]] = []
    effective_worker_ms = child_worker_ms
    reuse_credit_ms = child_reuse_credit_ms
    all_succeeded_non_checkpoint_ms = child_worker_ms + child_wasted_worker_ms

    for doc in step_run_docs:
        doc_id = str(doc.get("id") or "").strip()
        state = str(doc.get("state") or "").strip().lower()
        interval = _step_run_interval(doc)
        if state == "succeeded" and interval is not None:
            all_succeeded_non_checkpoint_ms += max(0, interval[1] - interval[0])
        if doc_id not in contributing_step_run_ids:
            continue
        if interval is None:
            continue
        contributing_intervals.append(interval)
        duration_ms = max(0, interval[1] - interval[0])
        effective_worker_ms += duration_ms
        if str(doc.get("run_id") or "").strip() != run_id:
            reuse_credit_ms += duration_ms

    effective_elapsed_ms = _duration_ms(_merge_intervals(contributing_intervals + child_intervals))
    wasted_worker_ms = max(0, all_succeeded_non_checkpoint_ms - effective_worker_ms)

    created_at = _coerce_datetime(content_job.get("createdAt"))
    first_interval_start = min((start_ms for start_ms, _ in contributing_intervals + child_intervals), default=None)
    queue_latency_ms = 0
    if created_at is not None and first_interval_start is not None:
        queue_latency_ms = max(0, first_interval_start - int(created_at.timestamp() * 1000))

    parallelism_factor = (
        round(effective_worker_ms / max(1, effective_elapsed_ms), 3)
        if effective_elapsed_ms > 0
        else 0.0
    )

    lineage_payload = {
        "job_id": job_id,
        "successful_run_id": run_id,
        "timing_version": TIMING_VERSION,
        "root_artifact_keys": root_artifact_keys,
        "contributing_step_run_ids": sorted(contributing_step_run_ids | child_contributing_step_run_ids),
        "contributing_run_ids": sorted(contributing_run_ids | child_contributing_run_ids),
        "contributing_child_job_ids": sorted(contributing_child_job_ids),
        "effective_elapsed_ms": effective_elapsed_ms,
        "effective_worker_ms": effective_worker_ms,
        "reuse_credit_ms": reuse_credit_ms,
        "wasted_worker_ms": wasted_worker_ms,
        "computed_at": fs.SERVER_TIMESTAMP,
    }
    db.collection(LINEAGE_COLLECTION).document(job_id).set(lineage_payload, merge=True)

    summary_payload = _persist_job_timing(
        db,
        content_job_id,
        timing_status="exact",
        effective_elapsed_ms=effective_elapsed_ms,
        effective_worker_ms=effective_worker_ms,
        reuse_credit_ms=reuse_credit_ms,
        wasted_worker_ms=wasted_worker_ms,
        queue_latency_ms=queue_latency_ms,
        parallelism_factor=parallelism_factor,
    )
    return {
        **lineage_payload,
        **summary_payload,
    }
