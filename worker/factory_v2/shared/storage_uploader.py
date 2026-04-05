"""
Step 5: Upload files to Firebase Storage.
"""

import os
import uuid
import urllib.parse
from mutagen.mp3 import MP3

from firebase_admin import storage

import config
from observability import get_logger

logger = get_logger(__name__)

# Storage path conventions (must match the app's audioFiles.ts)
STORAGE_PATHS = {
    "guided_meditation": "audio/meditate/meditations",
    "sleep_meditation": "audio/sleep/meditations",
    "bedtime_story": "audio/sleep/stories",
    "emergency_meditation": "audio/meditate/emergency",
    "course_session": "audio/meditate/courses",
    "course": "audio/meditate/courses",
}

IMAGE_STORAGE_PATHS = {
    "guided_meditation": "images/meditate/meditations",
    "sleep_meditation": "images/sleep/meditations",
    "bedtime_story": "images/sleep/stories",
    "emergency_meditation": "images/meditate/emergency",
    "course_session": "images/meditate/courses",
    "course": "images/meditate/courses",
    "album": "images/music/albums",
    "sleep_sound": "images/sleep/sounds",
    "white_noise": "images/music/white_noise",
    "music": "images/music/tracks",
    "asmr": "images/music/asmr",
    "series": "images/sleep/series",
}


def _get_audio_duration(mp3_path: str) -> float:
    """Get audio duration in seconds from an MP3 file."""
    try:
        audio = MP3(mp3_path)
        return audio.info.length
    except Exception:
        # Fallback: estimate from file size (192kbps = 24 KB/s)
        size = os.path.getsize(mp3_path)
        return size / 24000


def _slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    import re
    slug = text.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug[:60]


def _stable_identifier(text: str, fallback: str) -> str:
    slug = _slugify(text)
    if slug:
        return slug
    fallback_slug = _slugify(fallback)
    return fallback_slug or "generated"


def _asset_stem(job_data: dict, *, default_label: str) -> str:
    explicit = str(job_data.get("_factoryAssetKey") or "").strip()
    if explicit:
        return _stable_identifier(explicit, default_label)

    content_job_id = str(job_data.get("_factoryContentJobId") or job_data.get("id") or "").strip()
    step_name = str(job_data.get("_factoryStepName") or default_label).strip() or default_label
    if content_job_id:
        return _stable_identifier(f"{content_job_id}-{step_name}", default_label)

    topic = str(job_data.get("params", {}).get("topic", "untitled") or "untitled")
    unique_id = uuid.uuid4().hex[:8]
    return f"{_slugify(topic)}-{unique_id}"


def _build_download_url(storage_path: str, token: str) -> str:
    encoded_path = urllib.parse.quote(storage_path, safe="")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{config.STORAGE_BUCKET}"
        f"/o/{encoded_path}?alt=media&token={token}"
    )


def _ensure_download_token(blob) -> str:
    blob.reload()
    metadata = dict(blob.metadata or {})
    token = str(metadata.get("firebaseStorageDownloadTokens") or "").split(",")[0].strip()
    if token:
        return token
    token = uuid.uuid4().hex
    metadata["firebaseStorageDownloadTokens"] = token
    blob.metadata = metadata
    blob.patch()
    return token


def upload_audio(mp3_path: str, job_data: dict) -> tuple[str, float]:
    """
    Upload MP3 to Firebase Storage.

    Returns (storage_path, duration_seconds).
    """
    content_type = job_data.get("contentType", "guided_meditation")

    # Build storage path
    base_path = STORAGE_PATHS.get(content_type, "audio/generated")
    filename = f"{_asset_stem(job_data, default_label='audio')}.mp3"
    storage_path = f"{base_path}/{filename}"

    logger.info("Uploading audio", extra={"storage_path": storage_path})

    # Get duration before upload
    duration_sec = _get_audio_duration(mp3_path) if os.path.isfile(mp3_path) else 0.0

    # Upload to Firebase Storage
    bucket = storage.bucket(config.STORAGE_BUCKET)
    blob = bucket.blob(storage_path)
    if blob.exists():
        blob.reload()
        metadata = dict(blob.metadata or {})
        try:
            duration_sec = float(metadata.get("factoryDurationSec") or duration_sec)
        except (TypeError, ValueError):
            pass
        logger.info("Audio upload reused existing blob", extra={"storage_path": storage_path})
    else:
        if not os.path.isfile(mp3_path):
            raise FileNotFoundError(f"Missing audio file for upload: {mp3_path}")
        blob.metadata = {
            **dict(blob.metadata or {}),
            "factoryContentJobId": str(job_data.get("_factoryContentJobId") or ""),
            "factoryStepName": str(job_data.get("_factoryStepName") or "upload_audio"),
            "factoryDurationSec": f"{duration_sec:.3f}",
        }
        blob.upload_from_filename(
            mp3_path,
            content_type="audio/mpeg",
            retry=None,
            timeout=60,
        )
        blob.cache_control = "public, max-age=31536000"
        blob.patch()

    size_mb = (os.path.getsize(mp3_path) / (1024 * 1024)) if os.path.isfile(mp3_path) else 0.0
    logger.info(
        "Audio uploaded",
        extra={"size_mb": round(size_mb, 1), "duration_sec": round(duration_sec, 1)},
    )

    # Clean up local file
    try:
        os.remove(mp3_path)
    except OSError:
        pass

    return storage_path, duration_sec


def upload_image(image_path: str, job_data: dict) -> tuple[str, str]:
    """
    Upload image to Firebase Storage.

    Returns (storage_path, download_url).
    """
    content_type = job_data.get("contentType", "guided_meditation")

    base_path = IMAGE_STORAGE_PATHS.get(content_type, "images/generated")
    filename = f"{_asset_stem(job_data, default_label='image')}.jpg"
    storage_path = f"{base_path}/{filename}"

    logger.info("Uploading image", extra={"storage_path": storage_path})

    bucket = storage.bucket(config.STORAGE_BUCKET)
    blob = bucket.blob(storage_path)
    overwrite_existing = bool(job_data.get("_factoryOverwriteExistingAsset"))
    if blob.exists() and not overwrite_existing:
        download_token = _ensure_download_token(blob)
        logger.info("Image upload reused existing blob", extra={"storage_path": storage_path})
    else:
        if not os.path.isfile(image_path):
            raise FileNotFoundError(f"Missing image file for upload: {image_path}")
        if blob.exists():
            blob.reload()
        download_token = uuid.uuid4().hex
        blob.metadata = {
            **dict(blob.metadata or {}),
            "firebaseStorageDownloadTokens": download_token,
            "factoryContentJobId": str(job_data.get("_factoryContentJobId") or ""),
            "factoryStepName": str(job_data.get("_factoryStepName") or "generate_image"),
        }
        blob.upload_from_filename(
            image_path,
            content_type="image/jpeg",
        )
        blob.cache_control = "public, max-age=31536000"
        blob.patch()
        if overwrite_existing:
            logger.info("Image upload replaced existing blob", extra={"storage_path": storage_path})

    download_url = _build_download_url(storage_path, download_token)

    size_kb = (os.path.getsize(image_path) / 1024) if os.path.isfile(image_path) else 0.0
    logger.info("Image uploaded", extra={"size_kb": round(size_kb, 1)})

    try:
        os.remove(image_path)
    except OSError:
        pass

    return storage_path, download_url
