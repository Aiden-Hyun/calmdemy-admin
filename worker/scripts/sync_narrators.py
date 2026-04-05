#!/usr/bin/env python3
"""
Sync narrator display names in Firestore and ensure narrator docs exist.

Usage:
  ./sync_narrators.py --dry-run
  ./sync_narrators.py --apply
"""

import argparse
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

# Ensure local imports work when run from other cwd
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

import config  # noqa: E402
from factory_v2.shared.voice_utils import (  # noqa: E402
    DEFAULT_VOICE_NAME_OVERRIDES,
    get_voice_display_name,
)


COLLECTIONS = [
    ("guided_meditations", "instructor"),
    ("sleep_meditations", "instructor"),
    ("bedtime_stories", "narrator"),
    ("emergency_meditations", "narrator"),
    ("courses", "instructor"),
]


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
            }
        )
    return firestore.client()


def is_voice_id(value: str) -> bool:
    if not value:
        return False
    if value in DEFAULT_VOICE_NAME_OVERRIDES:
        return True
    return bool(
        value.startswith("xtts-")
        or value.startswith("gemini-")
    )


def _normalize_narrator_id(name: str) -> str:
    return name.strip().lower().replace(" ", "_")


def cleanup_random_ids(db, apply: bool) -> int:
    """Re-key any narrator docs with random IDs to normalized name IDs."""
    updated = 0
    for doc in db.collection("narrators").stream():
        data = doc.to_dict() or {}
        name = (data.get("name") or "").strip()
        if not name:
            continue
        normalized_id = _normalize_narrator_id(name)
        if doc.id == normalized_id:
            continue

        target_ref = db.collection("narrators").document(normalized_id)
        if apply:
            target_ref.set(
                {
                    **data,
                    "name": name,
                    "id": normalized_id,
                },
                merge=True,
            )
            doc.reference.delete()
        updated += 1
        print(f"  [narrators] rekey: {doc.id} -> {normalized_id}")
    return updated


def ensure_narrators(db, apply: bool, cleanup_duplicates: bool) -> int:
    names = sorted({v for v in DEFAULT_VOICE_NAME_OVERRIDES.values()})
    updated = 0
    for name in names:
        normalized_id = _normalize_narrator_id(name)
        target_ref = db.collection("narrators").document(normalized_id)
        target_snap = target_ref.get()

        # If a correct-id doc exists, make sure name/id are set
        if target_snap.exists:
            data = target_snap.to_dict() or {}
            needs_update = data.get("name") != name or data.get("id") != normalized_id
            if apply and needs_update:
                target_ref.set(
                    {"name": name, "id": normalized_id},
                    merge=True,
                )
                updated += 1
                print(f"  [narrators] update: {normalized_id}")
            continue

        # Look for existing docs by name (likely random IDs)
        q = db.collection("narrators").where("name", "==", name)
        matches = list(q.get())
        if matches:
            source_doc = matches[0]
            source_data = source_doc.to_dict() or {}
            if apply:
                target_ref.set(
                    {
                        **source_data,
                        "name": name,
                        "id": normalized_id,
                    },
                    merge=True,
                )
            updated += 1
            print(f"  [narrators] fix id: {source_doc.id} -> {normalized_id}")

            if cleanup_duplicates:
                for doc in matches:
                    if doc.id == normalized_id:
                        continue
                    if apply:
                        doc.reference.delete()
                    print(f"  [narrators] delete duplicate: {doc.id}")
            continue

        # No existing doc at all — create a new one with deterministic id
        if apply:
            target_ref.set(
                {
                    "name": name,
                    "id": normalized_id,
                    "bio": "",
                    "photoUrl": "",
                    "createdAt": firestore.SERVER_TIMESTAMP,
                }
            )
        updated += 1
        print(f"  [narrators] create: {normalized_id}")

    return updated


def update_content_docs(db, apply: bool) -> int:
    updated = 0
    for collection_name, field in COLLECTIONS:
        docs = db.collection(collection_name).stream()
        for doc in docs:
            data = doc.to_dict() or {}
            current = (data.get(field) or "").strip()
            voice_id = (data.get("ttsVoiceId") or "").strip()

            if not voice_id and is_voice_id(current):
                voice_id = current

            if not voice_id:
                continue

            display_name = get_voice_display_name(voice_id)
            if current == display_name:
                continue

            # Update only if current is empty or looks like a voice id
            if current and not is_voice_id(current):
                continue

            if apply:
                doc.reference.update(
                    {
                        field: display_name,
                        "ttsVoiceId": voice_id,
                    }
                )
            updated += 1
            print(f"  [{collection_name}] {doc.id}: {current or '(empty)'} -> {display_name}")
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync narrator display names in Firestore.")
    parser.add_argument("--apply", action="store_true", help="Apply changes.")
    parser.add_argument("--dry-run", action="store_true", help="Do not write changes.")
    parser.add_argument(
        "--cleanup-duplicates",
        action="store_true",
        help="Delete duplicate narrator docs with random IDs after fixing.",
    )
    parser.add_argument(
        "--cleanup-only",
        action="store_true",
        help="Only clean up duplicate narrator docs (no content doc updates).",
    )
    parser.add_argument(
        "--cleanup-all",
        action="store_true",
        help="Re-key ALL narrator docs with random IDs to normalized name IDs.",
    )
    args = parser.parse_args()

    apply = (args.apply or args.cleanup_only) and not args.dry_run
    if args.dry_run or not apply:
        print("Running in dry-run mode (no writes). Use --apply to write changes.")

    db = init_firebase()

    if args.cleanup_all:
        print("Re-keying narrator docs with random IDs...")
        rekeyed = cleanup_random_ids(db, apply=apply)
        print(f"  narrator docs re-keyed: {rekeyed}")

    print("Ensuring narrator docs...")
    cleanup = args.cleanup_duplicates or args.cleanup_only
    created = ensure_narrators(db, apply=apply, cleanup_duplicates=cleanup)
    print(f"  narrator docs created/updated: {created}")

    if args.cleanup_only:
        print("Skipping content doc updates (--cleanup-only).")
    else:
        print("Updating content docs...")
        updated = update_content_docs(db, apply=apply)
        print(f"  content docs updated: {updated}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
