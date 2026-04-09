"""Entry point for a single Calmdemy content-factory worker process.

Architectural Role:
    Each worker process claims queued content jobs from Firestore and
    executes them through the V2 factory pipeline (plan -> script ->
    synthesise -> TTS -> publish).  The companion process spawns one or
    more of these workers, each running as an independent OS process.

Lifecycle (see ``main()``):
    1. Read worker configuration from environment variables.
    2. Initialise Firebase (with service-account credentials when
       available, or Application Default Credentials in the cloud).
    3. Build a ``WorkerMain`` instance that encapsulates the claim loop,
       step executor, and optional dispatcher.
    4. Enter ``run_forever()`` -- a blocking poll loop that claims and
       processes jobs until the process is terminated.

Key Dependencies:
    ``config``, ``observability``, ``factory_v2.interfaces.worker_main``,
    ``firebase_admin``.

Consumed By:
    Spawned by ``companion/stacks.py`` via ``subprocess``.  Not imported
    by any other module.
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
    """Initialise the Firebase Admin SDK and return a Firestore client.

    Uses a local ``service-account-key.json`` file when available (typical
    for local development).  Falls back to Application Default Credentials
    in cloud environments (GCE, Cloud Run) where the SDK can auto-discover
    credentials from the metadata server.

    The ``_apps`` guard ensures we never initialise the SDK twice in the
    same process, which would raise a ``ValueError``.
    """
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
            # Cloud environment: rely on ADC (Application Default Credentials).
            firebase_admin.initialize_app(
                options={
                    "projectId": config.PROJECT_ID,
                    "storageBucket": config.STORAGE_BUCKET,
                }
            )

    return firestore.client()


def main() -> None:
    """Configure and run the worker until the process is terminated.

    All behaviour is driven by environment variables so the companion
    can launch multiple workers with different TTS-model assignments or
    capability sets without code changes.
    """
    configure_logging()
    worker_id = os.getenv("WORKER_ID", "local-v2")
    process_id = os.getpid()
    poll_seconds = float(os.getenv("V2_POLL_INTERVAL_SECONDS", "1.0"))

    # WORKER_DISPATCH takes precedence over the older V2_ENABLE_DISPATCH
    # flag.  This two-layer lookup keeps backward compatibility.
    worker_dispatch_raw = os.getenv("WORKER_DISPATCH")
    if worker_dispatch_raw is None:
        enable_dispatch = os.getenv("V2_ENABLE_DISPATCH", "true").lower() == "true"
    else:
        enable_dispatch = worker_dispatch_raw.lower() == "true"

    accept_non_tts_steps = os.getenv("WORKER_ACCEPT_NON_TTS", "true").lower() == "true"
    tts_models_raw = os.getenv("WORKER_TTS_MODELS", "").strip()
    extra_capability_keys_raw = os.getenv("WORKER_EXTRA_CAPABILITY_KEYS", "").strip()

    # Parse the TTS model allow-list.  A wildcard "*" means "accept any
    # TTS model" and is represented as None internally.
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

    # Capability keys are string tags written into each claimed step so
    # the queue can route jobs to workers that support the required
    # models/features.
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
