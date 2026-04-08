from __future__ import annotations

import json
import os
from typing import Any

from observability import get_logger
from factory_v2.shared.queue_capabilities import worker_capability_keys

logger = get_logger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
DEFAULT_STACKS_FILE = os.path.join(WORKER_DIR, "worker_stacks.json")

_DEFAULT_STACKS = [
    {
        "id": "local-primary",
        "role": "v2",
        "venv": ".venv",
        "enabled": True,
        "dispatch": True,
        "acceptNonTtsSteps": True,
        "ttsModels": ["gemini-tts-flash", "gemini-tts-pro"],
        "extraCapabilityKeys": [],
    },
    {
        "id": "local-image",
        "role": "image",
        "venv": ".venv",
        "enabled": True,
        "dispatch": False,
        "acceptNonTtsSteps": False,
        "ttsModels": [],
        "extraCapabilityKeys": ["image"],
    },
    {
        "id": "local-tts-qwen",
        "role": "tts",
        "venv": ".venv-qwen",
        "replicas": 7,
        "enabled": True,
        "dispatch": False,
        "acceptNonTtsSteps": False,
        "ttsModels": ["qwen3-base"],
        "extraCapabilityKeys": [],
    },
]


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def _normalize_tts_models(raw: Any) -> list[str]:
    if raw is None:
        return []
    values: list[str] = []
    if isinstance(raw, str):
        values = [part.strip() for part in raw.split(",")]
    elif isinstance(raw, (list, tuple, set)):
        values = [str(item).strip() for item in raw]
    normalized: list[str] = []
    for value in values:
        if not value:
            continue
        lowered = value.lower()
        if lowered not in normalized:
            normalized.append(lowered)
    return normalized


def _normalize_capability_keys(raw: Any) -> list[str]:
    return _normalize_tts_models(raw)


def _as_int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return default
    return default


def _legacy_single_stack() -> list[dict]:
    return [
        {
            "id": os.getenv("V2_STACK_ID", "local-v2"),
            "role": "v2",
            "venv": os.getenv("V2_VENV", ".venv"),
            "enabled": True,
            "dispatch": True,
            "acceptNonTtsSteps": True,
            "ttsModels": ["*"],
        }
    ]


def _normalize_stack(raw: dict, index: int) -> dict:
    stack_id = str(raw.get("id") or f"stack-{index + 1}").strip()
    role = str(raw.get("role") or "v2").strip()
    venv = str(raw.get("venv") or ".venv").strip()
    enabled = _as_bool(raw.get("enabled"), True)
    replicas = max(1, _as_int(raw.get("replicas"), 1))

    dispatch_raw = raw.get("dispatch")
    dispatch = _as_bool(dispatch_raw, role in {"pre", "dispatcher"})

    accept_non_tts_raw = raw.get("acceptNonTtsSteps")
    accept_non_tts = _as_bool(accept_non_tts_raw, role not in {"tts"})

    tts_models = _normalize_tts_models(raw.get("ttsModels"))
    extra_capability_keys = _normalize_capability_keys(raw.get("extraCapabilityKeys"))
    if not tts_models and accept_non_tts:
        # Backward-compatible wildcard for old single-stack setups.
        tts_models = ["*"]

    return {
        "id": stack_id,
        "role": role or "v2",
        "venv": venv or ".venv",
        "replicas": replicas,
        "enabled": enabled,
        "dispatch": dispatch,
        "acceptNonTtsSteps": accept_non_tts,
        "ttsModels": tts_models,
        "extraCapabilityKeys": extra_capability_keys,
    }


def _expand_replicated_stacks(stacks: list[dict]) -> list[dict]:
    expanded: list[dict] = []
    for stack in stacks:
        replicas = max(1, _as_int(stack.get("replicas"), 1))
        for replica_index in range(1, replicas + 1):
            concrete = dict(stack)
            concrete["replicas"] = replicas
            concrete["replicaIndex"] = replica_index
            if replica_index > 1:
                concrete["id"] = f"{stack['id']}-{replica_index}"
            expanded.append(concrete)
    return expanded


def _enforce_dispatcher(stacks: list[dict]) -> list[dict]:
    enabled_indices = [idx for idx, stack in enumerate(stacks) if stack.get("enabled", True)]
    if not enabled_indices:
        return stacks

    dispatch_indices = [
        idx for idx in enabled_indices if bool(stacks[idx].get("dispatch", False))
    ]
    if not dispatch_indices:
        first = enabled_indices[0]
        stacks[first]["dispatch"] = True
        logger.warning(
            "No dispatcher stack defined; defaulting first enabled stack as dispatcher",
            extra={"stack_id": stacks[first].get("id")},
        )
        return stacks

    primary = dispatch_indices[0]
    for idx in dispatch_indices[1:]:
        stacks[idx]["dispatch"] = False
    if len(dispatch_indices) > 1:
        logger.warning(
            "Multiple dispatcher stacks configured; keeping only the first",
            extra={
                "primary": stacks[primary].get("id"),
                "disabled": [stacks[idx].get("id") for idx in dispatch_indices[1:]],
            },
        )
    return stacks


def load_stack_config(config_path: str | None = None) -> list[dict]:
    path = config_path or os.getenv("WORKER_STACKS_FILE", DEFAULT_STACKS_FILE)
    raw_stacks: list[dict]

    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if isinstance(payload, list):
                raw_stacks = [item for item in payload if isinstance(item, dict)]
            else:
                raw_stacks = []
        except Exception as exc:
            logger.warning(
                "Failed to parse worker stack config; using fallback",
                extra={"path": path, "error": str(exc)},
            )
            raw_stacks = []
    else:
        raw_stacks = []

    if not raw_stacks:
        if os.getenv("V2_STACK_ID") or os.getenv("V2_VENV"):
            raw_stacks = _legacy_single_stack()
        else:
            raw_stacks = list(_DEFAULT_STACKS)

    normalized = [_normalize_stack(stack, idx) for idx, stack in enumerate(raw_stacks)]
    expanded = _expand_replicated_stacks(normalized)
    return _enforce_dispatcher(expanded)


def stack_supports_tts_model(stack: dict, tts_model: str) -> bool:
    model = (tts_model or "").strip().lower()
    if not model:
        return True
    models = [str(value).strip().lower() for value in (stack.get("ttsModels") or []) if str(value).strip()]
    if not models:
        return bool(stack.get("acceptNonTtsSteps", True))
    if "*" in models:
        return True
    return model in models


def stack_capability_keys(stack: dict) -> list[str]:
    models = [
        str(value).strip().lower()
        for value in (stack.get("ttsModels") or [])
        if str(value).strip()
    ]
    supported_tts_models = None if "*" in models else set(models)
    return worker_capability_keys(
        accept_non_tts_steps=bool(stack.get("acceptNonTtsSteps", True)),
        supported_tts_models=supported_tts_models,
        extra_capability_keys=set(stack.get("extraCapabilityKeys") or []),
    )


def any_enabled_stack_supports_tts_model(stacks: list[dict], tts_model: str) -> bool:
    for stack in stacks:
        if not stack.get("enabled", True):
            continue
        if stack_supports_tts_model(stack, tts_model):
            return True
    return False
