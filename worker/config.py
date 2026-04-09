"""Central configuration for the Calmdemy content-factory worker.

Architectural Role:
    This module is the single source of truth for every tuneable setting in
    the worker process.  All values are read from environment variables at
    import time, with sensible defaults baked in so the worker can start
    locally without any env file.

Design Pattern:
    *Module-as-singleton* -- Python imports are cached, so importing this
    module anywhere gives the same pre-resolved values without needing a
    Config class or dependency-injection container.

Key Dependencies:
    * ``python-dotenv`` (optional) -- when installed, a ``.env`` file in the
      repo root is loaded before the first ``os.getenv`` call.

Consumed By:
    Nearly every module in the worker: ``local_worker``, ``local_companion``,
    all ``factory_v2/`` infrastructure and step modules, ``companion/``,
    ``models/``, and utility scripts under ``scripts/``.
"""

import os

# Load .env early so every os.getenv() below can see its values.
# The try/except keeps python-dotenv an optional dependency -- in
# production containers it is not installed.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------------------------------------------------------------------------
# GCP / Firebase
# ---------------------------------------------------------------------------
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "calmnest-e910e")
STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "calmnest-e910e.firebasestorage.app")

# ---------------------------------------------------------------------------
# GCE (for self-shutdown on idle cloud VMs)
# ---------------------------------------------------------------------------
GCE_ZONE = os.getenv("GCE_ZONE", "us-central1-a")
GCE_VM_NAME = os.getenv("GCE_VM_NAME", "calmdemy-worker")

# ---------------------------------------------------------------------------
# Model / cache paths -- persistent disk is mounted at /models in prod
# ---------------------------------------------------------------------------
MODEL_DIR = os.getenv("MODEL_DIR", "/models")
JOB_CACHE_DIR = os.getenv("JOB_CACHE_DIR", os.path.join(MODEL_DIR, "job_cache"))

# ---------------------------------------------------------------------------
# Worker behaviour
# ---------------------------------------------------------------------------
IDLE_SHUTDOWN_MINUTES = int(os.getenv("IDLE_SHUTDOWN_MINUTES", "5"))
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "2"))

# Watchdog: marks a job as stale when it exceeds this timeout, letting
# another worker reclaim it.
STALE_JOB_TIMEOUT_MINUTES = int(os.getenv("STALE_JOB_TIMEOUT_MINUTES", "30"))
WATCHDOG_CHECK_INTERVAL_SECONDS = int(os.getenv("WATCHDOG_CHECK_INTERVAL_SECONDS", "300"))

# ---------------------------------------------------------------------------
# Firestore collection name (shared by all workers and the admin UI)
# ---------------------------------------------------------------------------
JOBS_COLLECTION = "content_jobs"

# ---------------------------------------------------------------------------
# LLM backends -- the factory selects one at runtime based on the job
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Local LLM servers (for 'local' backend -- LM Studio or Ollama)
LMSTUDIO_HOST = os.getenv("LMSTUDIO_HOST", "http://localhost:1234")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------
IMAGE_BACKEND = os.getenv("IMAGE_BACKEND", "diffusers").strip().lower()
IMAGE_MODEL_ID = os.getenv("IMAGE_MODEL_ID", "stabilityai/sd-turbo")
IMAGE_WIDTH = int(os.getenv("IMAGE_WIDTH", "384"))
IMAGE_HEIGHT = int(os.getenv("IMAGE_HEIGHT", "384"))
IMAGE_STEPS = int(os.getenv("IMAGE_STEPS", "10"))
IMAGE_GUIDANCE = float(os.getenv("IMAGE_GUIDANCE", "3.5"))
# Pipeline caching keeps the Diffusers pipeline in memory between jobs.
# Disabled by default to reduce idle RAM usage on small machines.
IMAGE_PIPELINE_CACHE_ENABLED = (
    os.getenv("IMAGE_PIPELINE_CACHE_ENABLED", "false").strip().lower() == "true"
)

# CoreML-specific settings (macOS hardware-accelerated image generation)
IMAGE_COREML_PYTHON = os.getenv("IMAGE_COREML_PYTHON", "").strip()
IMAGE_COREML_RESOURCES_DIR = os.getenv("IMAGE_COREML_RESOURCES_DIR", "").strip()
IMAGE_COREML_MODEL_VERSION = os.getenv(
    "IMAGE_COREML_MODEL_VERSION",
    "stabilityai/stable-diffusion-xl-base-1.0",
).strip()
IMAGE_COREML_COMPUTE_UNIT = os.getenv("IMAGE_COREML_COMPUTE_UNIT", "CPU_AND_GPU").strip()
IMAGE_COREML_TIMEOUT_SECONDS = int(os.getenv("IMAGE_COREML_TIMEOUT_SECONDS", "900"))
IMAGE_SEED = int(os.getenv("IMAGE_SEED", "93"))
HF_TOKEN = os.getenv("HF_TOKEN", "")
