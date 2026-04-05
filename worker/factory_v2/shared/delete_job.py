"""Delete job artifacts (local cache + remote audio) and remove content job doc."""

from firebase_admin import firestore as fs

import config
from observability import get_logger

from .error_codes import classify_error
from .job_cache import cleanup as cleanup_cache
from .storage_cleanup import delete_storage_paths

logger = get_logger(__name__)


def process_delete_job(db, job_id: str, job_data: dict) -> None:
    paths: list[str] = []
    for key in ("audioPath", "imagePath"):
        value = job_data.get(key)
        if value:
            paths.append(str(value))

    preview_sessions = job_data.get("coursePreviewSessions") or []
    for session in preview_sessions:
        if not isinstance(session, dict):
            continue
        session_path = session.get("audioPath")
        if session_path:
            paths.append(str(session_path))

    audio_results = job_data.get("courseAudioResults") or {}
    if isinstance(audio_results, dict):
        for payload in audio_results.values():
            if not isinstance(payload, dict):
                continue
            storage_path = payload.get("storagePath")
            if storage_path:
                paths.append(str(storage_path))

    delete_storage_paths(paths, allowed_prefixes=("audio/", "images/"))

    cleanup_cache(job_id)
    db.collection(config.JOBS_COLLECTION).document(job_id).delete()
    logger.info("Content job deleted", extra={"job_id": job_id})


def mark_delete_failed(db, job_id: str, error_msg: str) -> None:
    db.collection(config.JOBS_COLLECTION).document(job_id).update(
        {
            "deleteError": error_msg,
            "deleteErrorCode": classify_error(error_msg),
            "deleteInProgress": False,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
