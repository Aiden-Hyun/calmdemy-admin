"""Worker configuration — reads from environment variables."""

import os

# Load .env early so config defaults can pick it up.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# GCP / Firebase
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "calmnest-e910e")
STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "calmnest-e910e.firebasestorage.app")

# GCE (for self-shutdown)
GCE_ZONE = os.getenv("GCE_ZONE", "us-central1-a")
GCE_VM_NAME = os.getenv("GCE_VM_NAME", "calmdemy-worker")

# Model paths (persistent disk mounted at /models)
MODEL_DIR = os.getenv("MODEL_DIR", "/models")
JOB_CACHE_DIR = os.getenv("JOB_CACHE_DIR", os.path.join(MODEL_DIR, "job_cache"))

# Worker behavior
IDLE_SHUTDOWN_MINUTES = int(os.getenv("IDLE_SHUTDOWN_MINUTES", "5"))
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "2"))

# Watchdog: stale job detection
STALE_JOB_TIMEOUT_MINUTES = int(os.getenv("STALE_JOB_TIMEOUT_MINUTES", "30"))
WATCHDOG_CHECK_INTERVAL_SECONDS = int(os.getenv("WATCHDOG_CHECK_INTERVAL_SECONDS", "300"))

# Firestore collection
JOBS_COLLECTION = "content_jobs"

# Gemini API (for 'api' backend)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Local LLM servers (for 'local' backend)
LMSTUDIO_HOST = os.getenv("LMSTUDIO_HOST", "http://localhost:1234")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Image generation
IMAGE_BACKEND = os.getenv("IMAGE_BACKEND", "diffusers").strip().lower()
IMAGE_MODEL_ID = os.getenv("IMAGE_MODEL_ID", "stabilityai/sd-turbo")
IMAGE_WIDTH = int(os.getenv("IMAGE_WIDTH", "384"))
IMAGE_HEIGHT = int(os.getenv("IMAGE_HEIGHT", "384"))
IMAGE_STEPS = int(os.getenv("IMAGE_STEPS", "10"))
IMAGE_GUIDANCE = float(os.getenv("IMAGE_GUIDANCE", "3.5"))
IMAGE_PIPELINE_CACHE_ENABLED = (
    os.getenv("IMAGE_PIPELINE_CACHE_ENABLED", "false").strip().lower() == "true"
)
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
