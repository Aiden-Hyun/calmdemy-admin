"""Helpers for encoding what kind of worker capability a queue item needs.

Architectural Role:
    Each queue item in the content factory carries a "capability key" that
    describes what hardware/software stack is needed to execute it (e.g. a
    specific TTS model, an image diffusion GPU, or just a generic CPU worker).
    This module computes those keys and checks whether a given worker can
    claim a particular queue item.  The routing is intentionally decoupled
    from the step implementations so that the queue poller can skip items
    it cannot service without importing heavy ML dependencies.

Key Dependencies:
    None -- pure logic, no I/O or ML imports.

Consumed By:
    - factory_v2 queue poller (worker loop that scans Firestore for pending work)
    - factory_v2 step dispatcher (assigns work to the correct worker)
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Step-name sets -- used to classify a pipeline step into a capability bucket
# ---------------------------------------------------------------------------

# Steps that require a Text-to-Speech model (and potentially a specific one)
TTS_STEP_NAMES = {
    "synthesize_audio",
    "synthesize_audio_chunk",
    "synthesize_course_audio",
    "synthesize_course_audio_chunk",
}

# Steps that require an image-generation pipeline (e.g. Stable Diffusion)
IMAGE_STEP_NAMES = {
    "generate_image",
    "generate_course_thumbnail",
}


def normalize_tts_model(tts_model: str | None) -> str:
    """Lowercase and strip a TTS model name for case-insensitive comparison."""
    return str(tts_model or "").strip().lower()


def is_tts_step(step_name: str | None) -> bool:
    """Return True if *step_name* is one of the TTS-related pipeline steps."""
    return str(step_name or "").strip() in TTS_STEP_NAMES


def is_image_step(step_name: str | None) -> bool:
    """Return True if *step_name* is one of the image-generation pipeline steps."""
    return str(step_name or "").strip() in IMAGE_STEP_NAMES


def capability_key_for_step(
    step_name: str | None,
    required_tts_model: str | None = None,
) -> str:
    """Collapse step requirements into one capability key stored on queue docs.

    The returned key follows a simple taxonomy:
        - ``"image"``       -- needs an image-generation GPU
        - ``"tts:<model>"`` -- needs a specific TTS model loaded
        - ``"tts:any"``     -- needs *some* TTS model, any will do
        - ``"default"``     -- no special hardware required (LLM, QA, upload, etc.)
    """
    if is_image_step(step_name):
        return "image"

    if not is_tts_step(step_name):
        # Non-TTS, non-image steps are "default" (CPU-only work)
        return "default"

    # TTS step -- pin to a specific model when the job requires one
    model = normalize_tts_model(required_tts_model)
    if model:
        return f"tts:{model}"
    return "tts:any"


def capability_key_for_payload(payload: dict) -> str:
    """Extract or compute the capability key from a queue-item payload.

    If the payload already carries an explicit ``capability_key`` (set at
    enqueue time), use it directly; otherwise derive one from the step name.
    """
    capability_key = str(payload.get("capability_key") or "").strip().lower()
    if capability_key:
        return capability_key
    return capability_key_for_step(
        payload.get("step_name"),
        payload.get("required_tts_model"),
    )


def payload_has_capability_key(payload: dict) -> bool:
    """Check whether the queue payload has an explicit capability key set."""
    return bool(str(payload.get("capability_key") or "").strip())


def worker_has_tts_support(supported_tts_models: set[str] | None) -> bool:
    """Return True if the worker can handle at least one TTS model.

    ``None`` means "all models supported" (wildcard), a non-empty set means
    specific models, and an empty set means no TTS support at all.
    """
    return supported_tts_models is None or bool(supported_tts_models)


def worker_supports_capability(
    capability_key: str,
    *,
    accept_non_tts_steps: bool,
    supported_tts_models: set[str] | None,
    extra_capability_keys: set[str] | None = None,
) -> bool:
    """Return whether a worker stack is allowed to claim a capability key.

    Args:
        capability_key: The key from the queue item (e.g. ``"tts:qwen3-base"``).
        accept_non_tts_steps: If True the worker will accept ``"default"`` items.
        supported_tts_models: The set of TTS model IDs loaded on this worker.
            ``None`` is a wildcard -- the worker claims *any* TTS key.
        extra_capability_keys: Optional additional keys the worker advertises
            (e.g. ``{"image"}`` for a GPU worker).

    Returns:
        True if the worker can execute the work described by *capability_key*.
    """
    normalized_key = str(capability_key or "").strip().lower()

    # "default" items (LLM, QA, upload) are gated by the flag
    if not normalized_key or normalized_key == "default":
        return accept_non_tts_steps

    # Allow any explicitly registered extra capability (e.g. "image")
    if extra_capability_keys and normalized_key in extra_capability_keys:
        return True

    # "tts:any" -- the item just needs *some* TTS model
    if normalized_key == "tts:any":
        return worker_has_tts_support(supported_tts_models)

    # Unknown non-TTS key -- reject
    if not normalized_key.startswith("tts:"):
        return False

    # Wildcard TTS worker (None) can handle any specific model
    if supported_tts_models is None:
        return True

    # Check if the specific required model is in the worker's loaded set
    required_model = normalize_tts_model(normalized_key.split(":", 1)[1])
    return bool(required_model and required_model in supported_tts_models)


def worker_capability_keys(
    *,
    accept_non_tts_steps: bool,
    supported_tts_models: set[str] | None,
    extra_capability_keys: set[str] | None = None,
) -> list[str]:
    """List every capability key a worker should query for during queue scans.

    The queue poller uses this list to build Firestore queries like
    ``WHERE capability_key IN [...]``, so the returned keys must cover
    every kind of work this worker is willing to accept.

    Returns:
        A deterministically-ordered list of capability key strings.
    """
    keys: list[str] = []

    # Generic CPU work (LLM generation, formatting, uploading, publishing)
    if accept_non_tts_steps:
        keys.append("default")

    # Explicitly registered extras (e.g. "image" for GPU workers)
    if extra_capability_keys:
        for capability_key in sorted(
            {
                str(value).strip().lower()
                for value in extra_capability_keys
                if str(value).strip()
            }
        ):
            if capability_key not in keys:
                keys.append(capability_key)

    # Wildcard TTS worker -- claim "tts:any" only; specific model keys are
    # unnecessary because such a worker can handle any model.
    if supported_tts_models is None:
        keys.append("tts:any")
        return keys

    # Specific TTS models this worker has loaded
    for model in sorted({normalize_tts_model(value) for value in supported_tts_models if normalize_tts_model(value)}):
        keys.append(f"tts:{model}")

    # If we support at least one model we can also grab generic "tts:any" items
    if supported_tts_models:
        keys.append("tts:any")

    return keys
