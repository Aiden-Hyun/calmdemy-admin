#!/usr/bin/env python3
"""Bootstrap a V2 workflow run from an existing content_jobs id."""

from __future__ import annotations

import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

import config
from factory_v2.interfaces.bootstrap import bootstrap_from_content_job


# Load .env if present
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def init_firebase():
    if not firebase_admin._apps:
        key_path = os.getenv(
            "GOOGLE_APPLICATION_CREDENTIALS",
            os.path.join(WORKER_DIR, "service-account-key.json"),
        )
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


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/bootstrap_v2_job.py <content_job_id>")
        return 1

    content_job_id = sys.argv[1]
    db = init_firebase()
    run_id = bootstrap_from_content_job(db, content_job_id)
    print(f"Bootstrapped V2 run: {run_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
