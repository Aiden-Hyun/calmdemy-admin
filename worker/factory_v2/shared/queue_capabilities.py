"""Helpers for encoding what kind of worker capability a queue item needs."""

from __future__ import annotations

TTS_STEP_NAMES = {
    "synthesize_audio",
    "synthesize_audio_chunk",
    "synthesize_course_audio",
    "synthesize_course_audio_chunk",
}

IMAGE_STEP_NAMES = {
    "generate_image",
    "generate_course_thumbnail",
}


def normalize_tts_model(tts_model: str | None) -> str:
    return str(tts_model or "").strip().lower()


def is_tts_step(step_name: str | None) -> bool:
    return str(step_name or "").strip() in TTS_STEP_NAMES


def is_image_step(step_name: str | None) -> bool:
    return str(step_name or "").strip() in IMAGE_STEP_NAMES


def capability_key_for_step(
    step_name: str | None,
    required_tts_model: str | None = None,
) -> str:
    """Collapse step requirements into one capability key stored on queue docs."""
    if is_image_step(step_name):
        return "image"

    if not is_tts_step(step_name):
        return "default"

    model = normalize_tts_model(required_tts_model)
    if model:
        return f"tts:{model}"
    return "tts:any"


def capability_key_for_payload(payload: dict) -> str:
    capability_key = str(payload.get("capability_key") or "").strip().lower()
    if capability_key:
        return capability_key
    return capability_key_for_step(
        payload.get("step_name"),
        payload.get("required_tts_model"),
    )


def payload_has_capability_key(payload: dict) -> bool:
    return bool(str(payload.get("capability_key") or "").strip())


def worker_has_tts_support(supported_tts_models: set[str] | None) -> bool:
    return supported_tts_models is None or bool(supported_tts_models)


def worker_supports_capability(
    capability_key: str,
    *,
    accept_non_tts_steps: bool,
    supported_tts_models: set[str] | None,
    extra_capability_keys: set[str] | None = None,
) -> bool:
    """Return whether a worker stack is allowed to claim a capability key."""
    normalized_key = str(capability_key or "").strip().lower()
    if not normalized_key or normalized_key == "default":
        return accept_non_tts_steps

    if extra_capability_keys and normalized_key in extra_capability_keys:
        return True

    if normalized_key == "tts:any":
        return worker_has_tts_support(supported_tts_models)

    if not normalized_key.startswith("tts:"):
        return False

    if supported_tts_models is None:
        return True

    required_model = normalize_tts_model(normalized_key.split(":", 1)[1])
    return bool(required_model and required_model in supported_tts_models)


def worker_capability_keys(
    *,
    accept_non_tts_steps: bool,
    supported_tts_models: set[str] | None,
    extra_capability_keys: set[str] | None = None,
) -> list[str]:
    """List every capability key a worker should query for during queue scans."""
    keys: list[str] = []
    if accept_non_tts_steps:
        keys.append("default")

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

    if supported_tts_models is None:
        keys.append("tts:any")
        return keys

    for model in sorted({normalize_tts_model(value) for value in supported_tts_models if normalize_tts_model(value)}):
        keys.append(f"tts:{model}")

    if supported_tts_models:
        keys.append("tts:any")

    return keys
