#!/usr/bin/env python3
"""
Migrate Firebase Storage thumbnails from PNG (512x512) to JPEG (384x384).

Updates all Firestore documents that reference the old PNG URLs.

Usage:
  ./migrate_thumbnails.py --dry-run   # preview changes (default)
  ./migrate_thumbnails.py --apply     # execute migration
"""

import argparse
import os
import sys
import tempfile
import uuid
import urllib.parse

import firebase_admin
from firebase_admin import credentials, firestore, storage
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

import config  # noqa: E402

TARGET_SIZE = (384, 384)
JPEG_QUALITY = 85

# Collections and the field name that stores the thumbnail URL.
COLLECTIONS = [
    ("guided_meditations", "thumbnailUrl"),
    ("sleep_meditations", "thumbnailUrl"),
    ("bedtime_stories", "thumbnail_url"),
    ("emergency_meditations", "thumbnailUrl"),
    ("courses", "thumbnailUrl"),
    ("course_sessions", "thumbnailUrl"),
    ("albums", "thumbnailUrl"),
    ("series", "thumbnailUrl"),
    ("sleep_sounds", "thumbnailUrl"),
    ("background_sounds", "thumbnailUrl"),
    ("white_noise", "thumbnailUrl"),
    ("music", "thumbnailUrl"),
    ("asmr", "thumbnailUrl"),
    ("content_jobs", "thumbnailUrl"),
]

STORAGE_IMAGE_PREFIX = "images/"


def init_firebase():
    if firebase_admin._apps:
        return firestore.client()

    key_path = os.getenv(
        "GOOGLE_APPLICATION_CREDENTIALS",
        os.path.join(WORKER_DIR, "service-account-key.json"),
    )
    if not os.path.isfile(key_path):
        fallback = os.path.join(WORKER_DIR, "..", "serviceAccountKey.json")
        if os.path.isfile(fallback):
            key_path = fallback

    if os.path.isfile(key_path):
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(
            cred,
            options={
                "projectId": config.PROJECT_ID,
                "storageBucket": config.STORAGE_BUCKET,
            },
        )
    else:
        firebase_admin.initialize_app(
            options={
                "projectId": config.PROJECT_ID,
                "storageBucket": config.STORAGE_BUCKET,
            },
        )
    return firestore.client()


def _build_download_url(storage_path: str, token: str) -> str:
    encoded_path = urllib.parse.quote(storage_path, safe="")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{config.STORAGE_BUCKET}"
        f"/o/{encoded_path}?alt=media&token={token}"
    )


def migrate_storage_blobs(bucket, *, dry_run: bool) -> dict[str, str]:
    """Convert PNG blobs to JPEG at 384x384.

    Returns a mapping of old_storage_path -> new_download_url.
    """
    url_map: dict[str, str] = {}
    blobs = list(bucket.list_blobs(prefix=STORAGE_IMAGE_PREFIX))
    png_blobs = [b for b in blobs if b.name.lower().endswith(".png")]

    print(f"\nFound {len(png_blobs)} PNG images in Storage under '{STORAGE_IMAGE_PREFIX}'")

    for i, blob in enumerate(png_blobs, 1):
        old_path = blob.name
        new_path = old_path.rsplit(".", 1)[0] + ".jpg"
        print(f"  [{i}/{len(png_blobs)}] {old_path} -> {new_path}")

        if dry_run:
            url_map[old_path] = f"(dry-run) {new_path}"
            continue

        # Download
        tmp_dir = tempfile.mkdtemp(prefix="migrate_thumb_")
        tmp_png = os.path.join(tmp_dir, "original.png")
        blob.download_to_filename(tmp_png)

        # Resize and convert
        tmp_jpg = os.path.join(tmp_dir, "thumbnail.jpg")
        with Image.open(tmp_png) as img:
            img = img.convert("RGB")
            img = img.resize(TARGET_SIZE, Image.LANCZOS)
            img.save(tmp_jpg, format="JPEG", quality=JPEG_QUALITY)

        old_size = os.path.getsize(tmp_png)
        new_size = os.path.getsize(tmp_jpg)
        print(f"         {old_size // 1024}KB PNG -> {new_size // 1024}KB JPEG")

        # Upload new JPEG
        download_token = uuid.uuid4().hex
        new_blob = bucket.blob(new_path)
        # Preserve existing metadata keys if the blob already exists
        new_blob.metadata = {
            "firebaseStorageDownloadTokens": download_token,
        }
        new_blob.upload_from_filename(tmp_jpg, content_type="image/jpeg")
        new_blob.cache_control = "public, max-age=31536000"
        new_blob.patch()

        # Delete old PNG
        blob.delete()
        print(f"         Deleted old PNG blob")

        new_url = _build_download_url(new_path, download_token)
        url_map[old_path] = new_url

        # Cleanup temp files
        try:
            os.remove(tmp_png)
            os.remove(tmp_jpg)
            os.rmdir(tmp_dir)
        except OSError:
            pass

    return url_map


def update_firestore_docs(db, url_map: dict[str, str], *, dry_run: bool):
    """Update Firestore documents that reference old PNG storage paths."""
    if not url_map:
        print("\nNo URL mappings to update in Firestore.")
        return

    total_updated = 0

    for collection_name, field_name in COLLECTIONS:
        docs = db.collection(collection_name).stream()
        batch_updates: list[tuple] = []

        for doc in docs:
            data = doc.to_dict() or {}
            current_url = data.get(field_name, "")
            if not current_url:
                continue

            # Check if the current URL references any of the old PNG paths
            for old_path, new_url in url_map.items():
                encoded_old = urllib.parse.quote(old_path, safe="")
                if encoded_old in current_url:
                    batch_updates.append((doc.reference, field_name, new_url, current_url))
                    break

        if batch_updates:
            print(f"\n  {collection_name}: {len(batch_updates)} doc(s) to update")
            for ref, field, new_url, old_url in batch_updates:
                print(f"    {ref.id}: {field}")
                if not dry_run:
                    ref.update({field: new_url})
            total_updated += len(batch_updates)

    print(f"\n{'Would update' if dry_run else 'Updated'} {total_updated} Firestore document(s) total.")


def main():
    parser = argparse.ArgumentParser(description="Migrate thumbnails from PNG to JPEG")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    group.add_argument("--apply", action="store_true", help="Apply the migration")
    args = parser.parse_args()

    dry_run = args.dry_run
    mode = "DRY RUN" if dry_run else "APPLY"
    print(f"=== Thumbnail Migration ({mode}) ===")

    db = init_firebase()
    bucket = storage.bucket(config.STORAGE_BUCKET)

    # Step 1: Migrate storage blobs
    print("\n--- Step 1: Migrate Storage blobs ---")
    url_map = migrate_storage_blobs(bucket, dry_run=dry_run)

    # Step 2: Update Firestore references
    print("\n--- Step 2: Update Firestore documents ---")
    update_firestore_docs(db, url_map, dry_run=dry_run)

    print(f"\n=== Migration complete ({mode}) ===")


if __name__ == "__main__":
    main()
