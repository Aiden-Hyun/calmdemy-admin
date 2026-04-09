"""Delete job artifacts (local cache + remote audio) and remove the content job doc.

Architectural Role:
    When an admin deletes a content job from the dashboard, this module
    handles the three-phase teardown:
        1. Collect all Cloud Storage paths (audio, images, course sessions).
        2. Delete those storage objects (best-effort).
        3. Remove the local filesystem cache and the Firestore document.

    If deletion fails partway, ``mark_delete_failed`` records the error on
    the document so the admin can see what went wrong and retry.

Key Dependencies:
    - storage_cleanup.delete_storage_paths -- safe blob deletion
    - job_cache.cleanup                    -- local cache removal
    - error_codes.classify_error           -- stable error codes

Consumed By:
    - factory_v2 delete handler (triggered by admin dashboard action)
"""

from firebase_admin import firestore as fs

import config
from observability import get_logger

from .error_codes import classify_error
from .job_cache import cleanup as cleanup_cache
from .storage_cleanup import delete_storage_paths

logger = get_logger(__name__)


def process_delete_job(db, job_id: str, job_data: dict) -> None:
    """Delete all artifacts for a content job and remove the Firestore doc.

    Collects storage paths from three sources:
        - Top-level ``audioPath`` / ``imagePath`` fields.
        - ``coursePreviewSessions[].audioPath`` for course preview audio.
        - ``courseAudioResults{}.storagePath`` for per-session course audio.
    """
    # Gather all Cloud Storage paths to delete
    paths: list[str] = []
    for key in ("audioPath", "imagePath"):
        value = job_data.get(key)
        if value:
            paths.append(str(value))

    # Course preview sessions (intermediate preview audio before publishing)
    preview_sessions = job_data.get("coursePreviewSessions") or []
    for session in preview_sessions:
        if not isinstance(session, dict):
            continue
        session_path = session.get("audioPath")
        if session_path:
            paths.append(str(session_path))

    # Course audio results (final per-session audio files)
    audio_results = job_data.get("courseAudioResults") or {}
    if isinstance(audio_results, dict):
        for payload in audio_results.values():
            if not isinstance(payload, dict):
                continue
            storage_path = payload.get("storagePath")
            if storage_path:
                paths.append(str(storage_path))

    # Phase 1: Delete remote storage objects
    delete_storage_paths(paths, allowed_prefixes=("audio/", "images/"))

    # Phase 2: Remove local cache directory
    cleanup_cache(job_id)

    # Phase 3: Delete the Firestore document
    db.collection(config.JOBS_COLLECTION).document(job_id).delete()
    logger.info("Content job deleted", extra={"job_id": job_id})


def mark_delete_failed(db, job_id: str, error_msg: str) -> None:
    """Record a delete failure on the job document so the admin can see it."""
    db.collection(config.JOBS_COLLECTION).document(job_id).update(
        {
            "deleteError": error_msg,
            "deleteErrorCode": classify_error(error_msg),
            "deleteInProgress": False,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
