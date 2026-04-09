"""Helpers for mapping TTS voice IDs to human-friendly display names.

Architectural Role:
    TTS voice identifiers are technical strings (file paths, model slugs,
    etc.) that should never appear in user-facing UI.  This module maps
    them to friendly narrator names like "Emma" or "Daniel" for display
    in the app and admin dashboard.

    Override precedence:
        1. ``TTS_VOICE_NAME_OVERRIDES`` environment variable (JSON dict).
        2. ``DEFAULT_VOICE_NAME_OVERRIDES`` hard-coded below.
        3. Auto-derived: first segment of the voice ID, title-cased.

Key Dependencies:
    None -- pure logic + env read.

Consumed By:
    - content_publisher (sets the ``instructor`` / ``narrator`` field)
    - Admin dashboard voice picker
"""

import json
import os
import re


# Hard-coded voice ID -> display name mappings.
# Extend this dict when adding new voice presets.
DEFAULT_VOICE_NAME_OVERRIDES = {
    # Coqui XTTS voices
    "xtts-female-calm": "Emma",
    "xtts-male-soothing": "James",
    # Qwen cloned sample voices
    "declutter_the_mind_7s": "John",
    "laura_qwen": "Laura",
    "daniel_16s": "Daniel",
    # Gemini TTS voices
    "gemini-default": "Kore",
    "gemini-default-pro": "Kore",
}


def _load_env_overrides() -> dict[str, str]:
    """Parse the ``TTS_VOICE_NAME_OVERRIDES`` env var (JSON dict) if set.

    Allows runtime override of voice display names without a code deploy.
    Returns an empty dict on missing or malformed input.
    """
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
    """Return a human-friendly narrator name for a TTS voice ID.

    Args:
        voice_id: The technical voice identifier (e.g. ``"laura_qwen"``).

    Returns:
        A display name like ``"Laura"``, or ``"Guide"`` as the ultimate fallback.
    """
    if not voice_id:
        return "Guide"

    # Env overrides take precedence over hard-coded defaults
    overrides = {**DEFAULT_VOICE_NAME_OVERRIDES, **_load_env_overrides()}
    if voice_id in overrides:
        return overrides[voice_id]

    # Fallback: split on hyphens/underscores and title-case the first segment
    name = re.split(r"[-_]", voice_id)[0]
    return name.capitalize() if name else "Guide"
