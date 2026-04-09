"""Cloud storage cleanup for orphaned or deleted content files.

Architectural Role:
    When a content job is deleted or regenerated, the old audio/image blobs
    in Firebase Cloud Storage need to be removed.  This module provides a
    safe deletion helper that only operates on paths under explicitly allowed
    prefixes (``audio/`` and ``images/``), preventing accidental deletion of
    unrelated storage objects.

    All deletions are best-effort: failures are logged but do not propagate,
    since storage cleanup is a secondary concern compared to the primary
    Firestore document operations.

Key Dependencies:
    - firebase_admin.storage  -- Firebase Cloud Storage SDK
    - config.STORAGE_BUCKET   -- target GCS bucket

Consumed By:
    - delete_job.process_delete_job
    - factory_v2 regeneration flows (replace old assets)
"""

from __future__ import annotations

from firebase_admin import storage

import config
from observability import get_logger

logger = get_logger(__name__)


def _is_supported_path(storage_path: str, allowed_prefixes: tuple[str, ...]) -> bool:
    """Return True if the path starts with one of the allowed prefixes."""
    return any(storage_path.startswith(prefix) for prefix in allowed_prefixes)


def delete_storage_paths(
    paths: list[str] | set[str] | tuple[str, ...],
    allowed_prefixes: tuple[str, ...] = ("audio/", "images/"),
) -> None:
    """Best-effort deletion of storage objects under allowed prefixes.

    Paths that do not match any allowed prefix are silently skipped (logged
    at info level).  Individual deletion failures are caught and logged at
    warning level to avoid aborting the entire cleanup batch.

    Args:
        paths: Collection of Cloud Storage object paths to delete.
        allowed_prefixes: Only paths starting with one of these are deleted.
    """
    bucket = storage.bucket(config.STORAGE_BUCKET)
    unique_paths = sorted({str(path or "").strip() for path in paths if str(path or "").strip()})

    for storage_path in unique_paths:
        if not _is_supported_path(storage_path, allowed_prefixes):
            logger.info("Delete skipped unsupported path", extra={"path": storage_path})
            continue

        blob = bucket.blob(storage_path)
        try:
            if blob.exists():
                blob.delete()
                logger.info("Deleted storage object", extra={"path": storage_path})
        except Exception as exc:
            logger.warning(
                "Failed to delete storage object",
                extra={"path": storage_path, "error": str(exc)},
            )
