"""Helpers for mapping TTS voice IDs to display names."""

import json
import os
import re


DEFAULT_VOICE_NAME_OVERRIDES = {
    # Coqui XTTS
    "xtts-female-calm": "Emma",
    "xtts-male-soothing": "James",
    # Qwen cloned sample voices
    "declutter_the_mind_7s": "John",
    "laura_qwen": "Laura",
    "daniel_16s": "Daniel",
    # Gemini
    "gemini-default": "Kore",
    "gemini-default-pro": "Kore",
}


def _load_env_overrides() -> dict[str, str]:
    raw = os.getenv("TTS_VOICE_NAME_OVERRIDES", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def get_voice_display_name(voice_id: str | None) -> str:
    """Return a human-friendly narrator name for a TTS voice id."""
    if not voice_id:
        return "Guide"

    overrides = {**DEFAULT_VOICE_NAME_OVERRIDES, **_load_env_overrides()}
    if voice_id in overrides:
        return overrides[voice_id]

    # Fallback: use the first segment, title-cased
    name = re.split(r"[-_]", voice_id)[0]
    return name.capitalize() if name else "Guide"
