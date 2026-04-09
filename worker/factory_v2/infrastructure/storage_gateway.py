"""Gateway adapter for Firebase Cloud Storage uploads.

Architectural Role
------------------
Infrastructure Layer -- "driven" adapter that hides the Cloud Storage
SDK behind a simple ``upload_file`` method.  Domain code never imports
``firebase_admin.storage`` directly.

Design Patterns
---------------
* **Gateway** -- a thin boundary object whose purpose is to keep the
  infrastructure dependency (Firebase Storage SDK) from leaking into
  application or domain layers.  If the project ever migrates to S3 or
  GCS client libraries, only this file changes.
* **Constructor injection** -- the bucket name defaults to
  ``config.STORAGE_BUCKET`` but can be overridden, which is useful for
  tests or multi-tenant deployments.

Key Dependencies
----------------
* ``firebase_admin.storage`` -- Firebase Cloud Storage SDK.
* ``config.STORAGE_BUCKET`` -- default bucket name from env / config.

Consumed By
-----------
* Step executors that produce audio or image files and need to persist
  them in cloud storage (e.g. ``synthesize_audio``, ``generate_image``).
"""

from __future__ import annotations

from firebase_admin import storage

import config


class StorageGateway:
    """Thin wrapper around Firebase Cloud Storage uploads.

    Encapsulates bucket resolution and blob creation so that callers
    only deal with local file paths and logical storage paths.
    """

    def __init__(self, bucket_name: str | None = None):
        # Resolve the bucket once at construction time.  The bucket
        # object is reusable across multiple uploads.
        self.bucket = storage.bucket(bucket_name or config.STORAGE_BUCKET)

    def upload_file(self, local_path: str, storage_path: str, content_type: str) -> str:
        """Upload a local file to Cloud Storage.

        Args:
            local_path: Absolute path to the file on the local filesystem.
            storage_path: Destination path *inside* the bucket
                (e.g. ``"audio/job123/chapter1.mp3"``).
            content_type: MIME type (e.g. ``"audio/mpeg"``).

        Returns:
            The ``storage_path`` that was written, so callers can
            persist it in Firestore without building the path again.
        """
        blob = self.bucket.blob(storage_path)
        blob.upload_from_filename(local_path, content_type=content_type)
        return storage_path
