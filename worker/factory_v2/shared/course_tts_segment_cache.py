"""Segment-level caching for course TTS to avoid re-synthesizing unchanged segments.

Architectural Role:
    When a course is regenerated (e.g. after a script edit), most session
    segments remain identical.  Re-synthesizing them is expensive (TTS is
    the slowest pipeline stage).  This module provides a content-addressed
    cache in Firebase Cloud Storage:

    - **Cache key**: SHA-256 of a canonical JSON payload containing the
      content job ID, session code, TTS backend/model/voice, and the
      normalized segment text.
    - **Cache path**: ``audio/meditate/courses/segment-cache/<job>/<session>/<hash>.wav``

    On cache hit, ``restore_segment_audio`` downloads the WAV directly from
    storage, bypassing TTS entirely.  On cache miss, ``persist_segment_audio``
    uploads the newly synthesized WAV so future runs can reuse it.

    The cache is scoped per content-job + session + TTS configuration, so
    changing the voice or model automatically invalidates the cache.

Key Dependencies:
    - firebase_admin.storage  -- Firebase Cloud Storage SDK
    - config.STORAGE_BUCKET   -- target GCS bucket

Consumed By:
    - tts_converter.convert_to_audio (checks/populates the cache per segment)
"""

from __future__ import annotations

import hashlib
import json
import os

from firebase_admin import storage

import config
from observability import get_logger

logger = get_logger(__name__)

# Bump this version to invalidate all cached segments (e.g. after changing
# the TTS post-processing pipeline or WAV format).
SEGMENT_CACHE_VERSION = 1


def _cache_scope(job_data: dict) -> dict[str, str] | None:
    """Extract the cache scope dimensions from job_data.

    The cache is only enabled when both ``_factoryContentJobId`` and
    ``_courseTtsSessionCode`` are present -- these are injected by the
    course TTS orchestrator but absent for ad-hoc single-content jobs.
    """
    content_job_id = str(job_data.get("_factoryContentJobId") or "").strip()
    session_code = str(job_data.get("_courseTtsSessionCode") or "").strip().upper()
    if not content_job_id or not session_code:
        return None

    return {
        "content_job_id": content_job_id,
        "session_code": session_code,
        "tts_backend": str(job_data.get("ttsBackend") or "local").strip().lower() or "local",
        "tts_model": str(job_data.get("ttsModel") or "qwen3-base").strip().lower() or "qwen3-base",
        "tts_voice": str(job_data.get("ttsVoice") or "default").strip() or "default",
    }


def is_segment_cache_enabled(job_data: dict) -> bool:
    """Return True if the job has enough context to use the segment cache."""
    return _cache_scope(job_data) is not None


def _segment_cache_digest(scope: dict[str, str], text: str) -> str:
    """Compute a SHA-256 content-address for a segment.

    The digest includes the cache version, all scope dimensions, and the
    whitespace-normalized text.  Changing any of these produces a different
    digest, effectively invalidating the cached WAV.
    """
    payload = {
        "version": SEGMENT_CACHE_VERSION,
        "content_job_id": scope["content_job_id"],
        "session_code": scope["session_code"],
        "tts_backend": scope["tts_backend"],
        "tts_model": scope["tts_model"],
        "tts_voice": scope["tts_voice"],
        # Normalize whitespace so trivial formatting differences don't miss
        "text": " ".join(str(text or "").split()),
    }
    # Deterministic JSON serialization for a stable hash
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def segment_cache_storage_path(job_data: dict, text: str) -> str | None:
    """Return the Cloud Storage path for a cached segment WAV, or None if caching is disabled."""
    scope = _cache_scope(job_data)
    if scope is None:
        return None

    digest = _segment_cache_digest(scope, text)
    return (
        f"audio/meditate/courses/segment-cache/"
        f"{scope['content_job_id']}/{scope['session_code']}/{digest}.wav"
    )


def restore_segment_audio(job_data: dict, text: str, output_path: str) -> bool:
    """Try to download a previously cached WAV for this segment.

    Returns True on cache hit (file written to *output_path*), False on miss
    or error.  On failure, any partially downloaded file is cleaned up.
    """
    storage_path = segment_cache_storage_path(job_data, text)
    if not storage_path:
        return False

    bucket = storage.bucket(config.STORAGE_BUCKET)
    blob = bucket.blob(storage_path)
    try:
        if not blob.exists():
            return False
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        blob.download_to_filename(output_path)
        return True
    except Exception as exc:
        logger.warning(
            "Failed to restore cached course TTS segment",
            extra={"storage_path": storage_path, "error": str(exc)},
        )
        # Clean up partial downloads so the caller does not mistake them for valid WAVs
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except OSError:
            pass
        return False


def persist_segment_audio(job_data: dict, text: str, wav_path: str) -> str | None:
    """Upload a freshly synthesized WAV to the segment cache.

    Idempotent: if the blob already exists (e.g. from a concurrent worker)
    the upload is skipped.  Attaches traceability metadata so orphaned
    cache blobs can be audited later.

    Returns:
        The Cloud Storage path on success, or None on failure.
    """
    storage_path = segment_cache_storage_path(job_data, text)
    if not storage_path:
        return None
    if not os.path.isfile(wav_path):
        raise FileNotFoundError(f"Missing WAV file for segment cache upload: {wav_path}")

    bucket = storage.bucket(config.STORAGE_BUCKET)
    blob = bucket.blob(storage_path)
    try:
        # Skip upload if another worker already cached this segment
        if blob.exists():
            return storage_path
        blob.metadata = {
            **dict(blob.metadata or {}),
            "factoryCacheVersion": str(SEGMENT_CACHE_VERSION),
            "factoryContentJobId": str(job_data.get("_factoryContentJobId") or ""),
            "factorySessionCode": str(job_data.get("_courseTtsSessionCode") or ""),
            "factoryTtsBackend": str(job_data.get("ttsBackend") or ""),
            "factoryTtsModel": str(job_data.get("ttsModel") or ""),
            "factoryTtsVoice": str(job_data.get("ttsVoice") or ""),
        }
        blob.upload_from_filename(
            wav_path,
            content_type="audio/wav",
            retry=None,
            timeout=60,
        )
        # Cache for 1 year -- segment content is immutable (keyed by hash)
        blob.cache_control = "public, max-age=31536000"
        blob.patch()
        return storage_path
    except Exception as exc:
        logger.warning(
            "Failed to persist cached course TTS segment",
            extra={"storage_path": storage_path, "error": str(exc)},
        )
        return None
