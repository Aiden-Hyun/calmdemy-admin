from __future__ import annotations

import hashlib
import json
import os

from firebase_admin import storage

import config
from observability import get_logger

logger = get_logger(__name__)

SEGMENT_CACHE_VERSION = 1


def _cache_scope(job_data: dict) -> dict[str, str] | None:
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
    return _cache_scope(job_data) is not None


def _segment_cache_digest(scope: dict[str, str], text: str) -> str:
    payload = {
        "version": SEGMENT_CACHE_VERSION,
        "content_job_id": scope["content_job_id"],
        "session_code": scope["session_code"],
        "tts_backend": scope["tts_backend"],
        "tts_model": scope["tts_model"],
        "tts_voice": scope["tts_voice"],
        "text": " ".join(str(text or "").split()),
    }
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def segment_cache_storage_path(job_data: dict, text: str) -> str | None:
    scope = _cache_scope(job_data)
    if scope is None:
        return None

    digest = _segment_cache_digest(scope, text)
    return (
        f"audio/meditate/courses/segment-cache/"
        f"{scope['content_job_id']}/{scope['session_code']}/{digest}.wav"
    )


def restore_segment_audio(job_data: dict, text: str, output_path: str) -> bool:
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
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
        except OSError:
            pass
        return False


def persist_segment_audio(job_data: dict, text: str, wav_path: str) -> str | None:
    storage_path = segment_cache_storage_path(job_data, text)
    if not storage_path:
        return None
    if not os.path.isfile(wav_path):
        raise FileNotFoundError(f"Missing WAV file for segment cache upload: {wav_path}")

    bucket = storage.bucket(config.STORAGE_BUCKET)
    blob = bucket.blob(storage_path)
    try:
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
        blob.cache_control = "public, max-age=31536000"
        blob.patch()
        return storage_path
    except Exception as exc:
        logger.warning(
            "Failed to persist cached course TTS segment",
            extra={"storage_path": storage_path, "error": str(exc)},
        )
        return None
