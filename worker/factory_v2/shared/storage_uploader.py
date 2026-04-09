"""Step 5 -- Upload files to Firebase Storage.

Architectural Role:
    Transfers locally-produced audio (MP3) and image (JPEG) files to
    Firebase Cloud Storage and returns the storage path / download URL.

    Storage paths follow a convention shared with the React Native app
    (see ``audioFiles.ts``) so that the client can resolve content to
    the correct CDN location.  Each blob carries factory-specific
    metadata (content job ID, step name, duration) for traceability.

    Idempotency: if a blob already exists at the target path, the upload
    is skipped and the existing blob's metadata is reused.  This makes
    the step safe to retry after partial failures.

Key Dependencies:
    - firebase_admin.storage   -- Firebase Cloud Storage SDK
    - mutagen                  -- MP3 metadata reader (for duration)
    - config.STORAGE_BUCKET    -- target GCS bucket name

Consumed By:
    - factory_v2 pipeline steps ``upload_audio`` / ``upload_image``
"""

import os
import uuid
import urllib.parse
from mutagen.mp3 import MP3

from firebase_admin import storage

import config
from observability import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Storage path conventions -- must stay in sync with the app's audioFiles.ts
# so the client resolves the correct download URLs.
# ---------------------------------------------------------------------------
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
    """Get audio duration in seconds from an MP3 file.

    Falls back to a bitrate-based estimate if mutagen cannot read the file.
    At 192 kbps the data rate is 24 KB/s, so ``file_size / 24000`` gives
    a reasonable approximation.
    """
    try:
        audio = MP3(mp3_path)
        return audio.info.length
    except Exception:
        size = os.path.getsize(mp3_path)
        return size / 24000


def _slugify(text: str) -> str:
    """Convert text to a URL-safe, lowercase slug (max 60 chars)."""
    import re
    slug = text.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug[:60]


def _stable_identifier(text: str, fallback: str) -> str:
    """Return a slugified identifier, trying *text* first then *fallback*."""
    slug = _slugify(text)
    if slug:
        return slug
    fallback_slug = _slugify(fallback)
    return fallback_slug or "generated"


def _asset_stem(job_data: dict, *, default_label: str) -> str:
    """Derive a stable, human-readable filename stem for a storage object.

    Priority:
        1. Explicit ``_factoryAssetKey`` (set by the orchestrator).
        2. ``<content_job_id>-<step_name>`` composite key.
        3. ``<topic>-<random_hex>`` fallback for ad-hoc jobs.
    """
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
    """Build a Firebase Storage download URL with an embedded access token.

    Firebase Storage serves files via a REST-style URL where the object path
    is URL-encoded and the download token authorizes public read access.
    """
    encoded_path = urllib.parse.quote(storage_path, safe="")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{config.STORAGE_BUCKET}"
        f"/o/{encoded_path}?alt=media&token={token}"
    )


def _ensure_download_token(blob) -> str:
    """Return (or create) a Firebase download token on the blob.

    Firebase Storage uses a custom metadata key
    ``firebaseStorageDownloadTokens`` to authorize public downloads.
    If the blob already has one we reuse it; otherwise we generate a
    fresh UUID token and patch the blob metadata.
    """
    blob.reload()
    metadata = dict(blob.metadata or {})
    # Token field can contain comma-separated values; take the first
    token = str(metadata.get("firebaseStorageDownloadTokens") or "").split(",")[0].strip()
    if token:
        return token
    token = uuid.uuid4().hex
    metadata["firebaseStorageDownloadTokens"] = token
    blob.metadata = metadata
    blob.patch()
    return token


def upload_audio(mp3_path: str, job_data: dict) -> tuple[str, float]:
    """Upload MP3 to Firebase Storage.

    Idempotent: if a blob already exists at the computed path, the upload
    is skipped and the stored duration is read from blob metadata instead.

    Args:
        mp3_path: Local path to the encoded MP3 file.
        job_data: Firestore job document.

    Returns:
        Tuple of ``(storage_path, duration_seconds)``.
    """
    content_type = job_data.get("contentType", "guided_meditation")

    # Build the canonical storage path from content type + asset stem
    base_path = STORAGE_PATHS.get(content_type, "audio/generated")
    filename = f"{_asset_stem(job_data, default_label='audio')}.mp3"
    storage_path = f"{base_path}/{filename}"

    logger.info("Uploading audio", extra={"storage_path": storage_path})

    # Measure duration *before* upload so we can store it as blob metadata
    duration_sec = _get_audio_duration(mp3_path) if os.path.isfile(mp3_path) else 0.0

    # Upload to Firebase Storage (skip if blob already exists -- idempotent)
    bucket = storage.bucket(config.STORAGE_BUCKET)
    blob = bucket.blob(storage_path)
    if blob.exists():
        # Reuse existing blob and recover its stored duration
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
        # Attach traceability metadata so we can link blobs back to jobs
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
        # Cache for 1 year -- audio content is immutable once published
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
    """Upload a JPEG thumbnail image to Firebase Storage.

    Unlike audio, images carry a download token so the client can display
    them without authentication.  Existing blobs are reused unless the
    ``_factoryOverwriteExistingAsset`` flag is set (used when regenerating
    thumbnails for existing content).

    Args:
        image_path: Local path to the JPEG file.
        job_data: Firestore job document.

    Returns:
        Tuple of ``(storage_path, download_url)``.
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
