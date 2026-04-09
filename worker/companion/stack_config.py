"""
============================================================
stack_config.py — Worker Stack Configuration (Configuration Layer)
============================================================

Architectural Role:
    Configuration Layer — reads, normalizes, and expands the worker stack
    definitions that drive the companion's control loop.  Every worker
    process the companion manages is described by a "stack" dict produced
    here.  This module is the single source of truth for what stacks exist,
    what capabilities they have, and how many replicas should be spawned.

Design Patterns:
    - Normalizer / Canonicalizer:  Raw JSON from worker_stacks.json is
      messy (optional fields, mixed types, missing defaults).
      _normalize_stack() produces a clean, fully-typed dict so downstream
      code never has to guess whether a field is present.
    - Replica Expansion:  A single logical stack with ``replicas: 5``
      becomes five concrete stack dicts, each with a unique ID
      (``local-tts-qwen``, ``local-tts-qwen-2``, ... ``-5``).  The
      control loop treats every expanded entry as an independent worker.
    - Invariant Enforcement:  _enforce_dispatcher() guarantees exactly one
      enabled stack has ``dispatch: True``.  Without a dispatcher, no jobs
      would ever be dequeued.

Data Flow:
    worker_stacks.json  →  load_stack_config()
                              ├─ _normalize_stack()   (clean each entry)
                              ├─ _expand_replicated_stacks()  (1→N)
                              └─ _enforce_dispatcher()  (exactly-one invariant)
                           → list[dict]  (consumed by control_loop, stacks, dispatcher)

Key Dependencies:
    - factory_v2.shared.queue_capabilities (capability key computation)

Consumed By:
    - companion/control_loop.py  (scaling decisions, memory guard)
    - companion/stacks.py  (start/stop worker processes)
    - factory_v2/interfaces/dispatcher.py  (capability-based step routing)
"""
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

# Fallback memory budget (in MB) assigned to a worker when the stack config
# doesn't specify memoryPerWorkerMB.
#
# Why this exists:
#   The control loop (control_loop.py) needs to know how much RAM each worker
#   will consume so it can decide how many workers fit in memory at once.
#   Each stack *should* declare its own memoryPerWorkerMB in worker_stacks.json
#   (e.g. the image stack declares 6000 because image models are huge).
#   But if someone adds a new stack and forgets to set memoryPerWorkerMB,
#   we don't want the memory guard to assume 0 and spawn unlimited workers.
#   This constant provides a safe middle-ground default (3 GB).
#
# How it's used:
#   _normalize_stack() below reads memoryPerWorkerMB from the raw JSON config.
#   If the field is missing or not a valid integer, _as_int() returns this
#   value instead.  The control loop then reads the normalized value from
#   each stack dict when summing up total memory demand.
#
# When to change:
#   Increase if your "typical" worker uses more than 3 GB (e.g. you've
#   upgraded model sizes).  Decrease if you're running on a lower-RAM
#   machine and want tighter default limits.
DEFAULT_MEMORY_PER_WORKER_MB = 3000

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
    """Coerce a loosely-typed JSON value to bool, tolerating strings like "true"/"yes"/"1"."""
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
    """
    Parse TTS model identifiers from JSON (string, list, or None) into a
    deduplicated, lowercased list.  Accepts comma-separated strings for
    backward compatibility with older single-value configs.
    """
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
    """Coerce a loosely-typed JSON value to int.  Bools are rejected (True != 1 here)."""
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
    """
    Backward-compatibility fallback: build a single-stack config from legacy
    V2_STACK_ID / V2_VENV env vars.  Used only when worker_stacks.json is
    missing *and* the old env vars are set.  The wildcard TTS model ``"*"``
    means "accept any TTS step regardless of model".
    """
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
    """
    Canonicalize a single raw stack dict from JSON into a fully-typed dict
    with guaranteed keys and sane defaults.

    This is the Normalizer pattern: downstream code (control_loop, stacks,
    dispatcher) never has to check for missing fields or handle type coercion —
    _normalize_stack does it once at load time.

    Args:
        raw:   One element from the worker_stacks.json array.
        index: Position in the array, used to generate a fallback ID.

    Returns:
        A clean dict with every field present and correctly typed.
    """
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

    # --- Memory budget per worker ---
    # Each stack declares how many MB a single worker instance is expected to
    # consume (model weights + inference scratch space).  The control loop's
    # memory guard sums these budgets to decide whether the desired worker set
    # fits in available RAM.  Clamped to >= 0; missing or non-numeric values
    # fall back to DEFAULT_MEMORY_PER_WORKER_MB (3 000 MB).
    memory_per_worker_mb = max(0, _as_int(raw.get("memoryPerWorkerMB"), DEFAULT_MEMORY_PER_WORKER_MB))

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
        "memoryPerWorkerMB": memory_per_worker_mb,
    }


def _expand_replicated_stacks(stacks: list[dict]) -> list[dict]:
    """
    Fan out logical stacks with ``replicas > 1`` into N concrete entries.

    Each replica gets a unique ID (``<base>-2``, ``<base>-3``, ...) so the
    control loop can manage them independently — start, stop, and track
    PIDs per replica.  Replica 1 keeps the original ID for backward compat.
    """
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
    """
    Invariant enforcement: exactly one enabled stack must be the dispatcher.

    The dispatcher is the stack responsible for dequeuing pending content_jobs
    and creating the factory step queue entries.  Without a dispatcher, new
    jobs sit in "pending" forever.  With multiple dispatchers, the same job
    could be picked up twice.

    Rules applied (in order):
      1. No dispatcher among enabled stacks → promote the first enabled stack.
      2. Multiple dispatchers → keep only the first, demote the rest.
    """
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
    """
    Main entry point: load, normalize, expand, and validate worker stacks.

    Resolution order for the config source:
      1. Explicit ``config_path`` argument.
      2. ``WORKER_STACKS_FILE`` env var.
      3. ``worker/worker_stacks.json`` (co-located with the worker directory).

    If the file is missing or unparseable, falls back to env-var-based
    legacy config or hard-coded _DEFAULT_STACKS.  This makes the companion
    robust to first-run / missing-config scenarios.

    Returns:
        Fully expanded list of stack dicts (one per replica), with exactly
        one dispatcher guaranteed.
    """
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
    """
    Check whether a stack can handle a TTS step targeting a specific model.

    Matching rules:
      - Wildcard ``"*"`` in ttsModels → accepts any model.
      - Empty model string → treated as non-TTS work, defers to acceptNonTtsSteps.
      - Otherwise, exact case-insensitive match against the stack's model list.

    Used by the control loop's auto-scaler to pick which stacks to spin up
    for queued TTS work.
    """
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
    """
    Compute the full set of capability keys a stack can serve.

    Delegates to the shared ``worker_capability_keys()`` which produces keys
    like ``"default"``, ``"tts:qwen3-base"``, ``"image"``, etc.  These keys
    are matched against queue entries' ``capability_key`` field to decide
    which worker should lease which step.
    """
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
    """Quick check: can *any* enabled stack handle this TTS model?"""
    for stack in stacks:
        if not stack.get("enabled", True):
            continue
        if stack_supports_tts_model(stack, tts_model):
            return True
    return False
