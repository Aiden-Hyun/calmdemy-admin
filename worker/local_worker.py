"""
Calmdemy Content Factory — Local Worker (V2 only).

This is the primary worker entrypoint used by the companion.
"""

from __future__ import annotations

import os

import firebase_admin
from firebase_admin import credentials, firestore

import config
from observability import configure_logging, get_logger
from factory_v2.interfaces.worker_main import WorkerMain
from factory_v2.shared.queue_capabilities import worker_capability_keys

logger = get_logger(__name__)


# Load .env file if present
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def init_firebase():
    if not firebase_admin._apps:
        key_path = os.getenv(
            "GOOGLE_APPLICATION_CREDENTIALS",
            os.path.join(os.path.dirname(__file__), "service-account-key.json"),
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


def main() -> None:
    configure_logging()
    worker_id = os.getenv("WORKER_ID", "local-v2")
    process_id = os.getpid()
    poll_seconds = float(os.getenv("V2_POLL_INTERVAL_SECONDS", "1.0"))
    worker_dispatch_raw = os.getenv("WORKER_DISPATCH")
    if worker_dispatch_raw is None:
        enable_dispatch = os.getenv("V2_ENABLE_DISPATCH", "true").lower() == "true"
    else:
        enable_dispatch = worker_dispatch_raw.lower() == "true"
    accept_non_tts_steps = os.getenv("WORKER_ACCEPT_NON_TTS", "true").lower() == "true"
    tts_models_raw = os.getenv("WORKER_TTS_MODELS", "").strip()
    extra_capability_keys_raw = os.getenv("WORKER_EXTRA_CAPABILITY_KEYS", "").strip()
    supported_tts_models: set[str] | None = None
    if tts_models_raw:
        parsed = {item.strip().lower() for item in tts_models_raw.split(",") if item.strip()}
        supported_tts_models = None if "*" in parsed else parsed
    extra_capability_keys = {
        item.strip().lower()
        for item in extra_capability_keys_raw.split(",")
        if item.strip()
    }
    max_step_retries = int(os.getenv("V2_MAX_STEP_RETRIES", "2"))
    claim_candidate_limit = int(os.getenv("V2_QUEUE_CLAIM_CANDIDATE_LIMIT", "200"))
    tts_per_job_soft_limit = int(os.getenv("V2_TTS_PER_JOB_SOFT_LIMIT", "2"))
    capability_keys = worker_capability_keys(
        accept_non_tts_steps=accept_non_tts_steps,
        supported_tts_models=supported_tts_models,
        extra_capability_keys=extra_capability_keys,
    )

    db = init_firebase()
    logger.info(
        "Starting Content Factory V2 worker",
        extra={
            "worker_id": worker_id,
            "poll_seconds": poll_seconds,
            "enable_dispatch": enable_dispatch,
            "accept_non_tts_steps": accept_non_tts_steps,
            "supported_tts_models": sorted(supported_tts_models) if supported_tts_models else ["*"],
            "extra_capability_keys": sorted(extra_capability_keys),
            "capability_keys": capability_keys,
            "max_step_retries": max_step_retries,
            "claim_candidate_limit": claim_candidate_limit,
            "tts_per_job_soft_limit": tts_per_job_soft_limit,
            "step_watchdog_enabled": os.getenv("V2_STEP_WATCHDOG_ENABLED", "false").lower() == "true",
            "process_id": process_id,
        },
    )

    runner = WorkerMain(
        db=db,
        worker_id=worker_id,
        poll_seconds=poll_seconds,
        enable_dispatch=enable_dispatch,
        can_dispatch=enable_dispatch,
        accept_non_tts_steps=accept_non_tts_steps,
        supported_tts_models=supported_tts_models,
        extra_capability_keys=extra_capability_keys,
        max_step_retries=max_step_retries,
        claim_candidate_limit=claim_candidate_limit,
        tts_per_job_soft_limit=tts_per_job_soft_limit,
        worker_type="local",
        stack_id=worker_id,
        process_id=process_id,
        capability_keys=capability_keys,
    )
    runner.run_forever()


if __name__ == "__main__":
    main()
