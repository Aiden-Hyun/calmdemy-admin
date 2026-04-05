from __future__ import annotations

from firebase_admin import storage

import config
from observability import get_logger

logger = get_logger(__name__)


def _is_supported_path(storage_path: str, allowed_prefixes: tuple[str, ...]) -> bool:
    return any(storage_path.startswith(prefix) for prefix in allowed_prefixes)


def delete_storage_paths(
    paths: list[str] | set[str] | tuple[str, ...],
    allowed_prefixes: tuple[str, ...] = ("audio/", "images/"),
) -> None:
    """
    Best-effort storage cleanup for known-safe object prefixes.
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
