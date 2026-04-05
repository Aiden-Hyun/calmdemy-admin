"""Minimal wrapper around Firebase Storage writes used by factory helpers."""

from __future__ import annotations

from firebase_admin import storage

import config


class StorageGateway:
    """Thin wrapper around Firebase Storage side effects."""

    def __init__(self, bucket_name: str | None = None):
        self.bucket = storage.bucket(bucket_name or config.STORAGE_BUCKET)

    def upload_file(self, local_path: str, storage_path: str, content_type: str) -> str:
        """Upload a local file and return the storage path callers should persist."""
        blob = self.bucket.blob(storage_path)
        blob.upload_from_filename(local_path, content_type=content_type)
        return storage_path
