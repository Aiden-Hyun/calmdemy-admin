"""Model registry -- maps model-ID strings from job configs to adapter classes.

Architectural Role:
    Central look-up table that decouples the pipeline from concrete model
    implementations.  The pipeline calls ``get_llm("gemini-2.5-flash")``
    and gets back a ready-to-use ``LLMBase`` instance without knowing
    *anything* about the Gemini SDK.

Design Patterns:
    - **Registry** -- ``LLM_FACTORIES`` and ``TTS_FACTORIES`` are
      dictionaries keyed by model-ID whose values are zero-arg factory
      callables.  Adding a new provider is a two-line change: write the
      adapter class, then register a factory here.
    - **Lazy Import via Factory** -- each factory uses ``importlib`` so
      heavy provider SDKs (``google-genai``, ``torch``, ``qwen-tts``)
      are only imported when that specific model is requested.  This
      keeps startup fast and avoids import errors for providers the
      current deployment doesn't use.

Key Dependencies:
    - ``importlib`` (stdlib) -- for deferred module loading
    - ``.llm_base.LLMBase`` / ``.tts_base.TTSBase`` -- type annotations

Consumed By:
    - ``worker.pipeline`` (calls ``get_llm`` / ``get_tts``)
    - Admin UI constants must stay in sync (``src/features/admin/constants/models.ts``)

To add a new model:
    1. Write an adapter in ``models/llm_<name>.py`` or ``models/tts_<name>.py``
    2. Add an entry to ``LLM_FACTORIES`` or ``TTS_FACTORIES`` below
    3. Add the model ID to the admin UI constants
"""

from __future__ import annotations

import importlib
from typing import Callable

from .llm_base import LLMBase
from .tts_base import TTSBase


# ---------------------------------------------------------------------------
# Lazy-import helpers
# ---------------------------------------------------------------------------

def _load_symbol(module_name: str, symbol: str):
    """Import *module_name* (relative to this package) and return *symbol*.

    This avoids top-level imports of heavy SDKs -- they are only pulled in
    when the corresponding factory function is actually called.
    """
    module = importlib.import_module(module_name, package=__package__)
    return getattr(module, symbol)


def _factory(module_name: str, symbol: str, **kwargs):
    """Generic factory: lazily import *symbol* from *module_name*, then instantiate it.

    Args:
        module_name: Dotted relative module path (e.g. ``".llm_gemini_api"``).
        symbol: Class name to import from the module.
        **kwargs: Forwarded to the class constructor.
    """
    cls = _load_symbol(module_name, symbol)
    return cls(**kwargs) if kwargs else cls()


# ---------------------------------------------------------------------------
# Individual factory functions (one per model ID)
# ---------------------------------------------------------------------------
# Each thin wrapper exists so ``LLM_FACTORIES`` / ``TTS_FACTORIES`` values
# are plain callables with the signature ``() -> LLMBase | TTSBase``.

def _gemini_flash_factory():
    return _factory(".llm_gemini_api", "GeminiAPIAdapter", model_id="gemini-2.5-flash")


def _gemini_pro_factory():
    return _factory(".llm_gemini_api", "GeminiAPIAdapter", model_id="gemini-2.5-pro")


def _gemini_tts_flash_factory():
    return _factory(".tts_gemini", "GeminiTTSAdapter", model_id="gemini-tts-flash")


def _gemini_tts_pro_factory():
    return _factory(".tts_gemini", "GeminiTTSAdapter", model_id="gemini-tts-pro")


def _qwen3_base_tts_factory():
    return _factory(".tts_qwen3_base", "Qwen3BaseTTSAdapter")


def _ollama_factory():
    return _factory(".llm_ollama", "OllamaAdapter")


def _lmstudio_factory():
    return _factory(".llm_lmstudio", "LMStudioAdapter")


# ==================== LLM REGISTRY ====================
# Keys are the model-ID strings that appear in Firestore job documents.
# Values are zero-arg callables that return a fresh LLMBase instance.

LLM_FACTORIES: dict[str, Callable[[], LLMBase]] = {}
LLM_FACTORIES.update({
    "gemini-2.5-flash": _gemini_flash_factory,
    "gemini-2.5-pro": _gemini_pro_factory,
    "lmstudio-local": _lmstudio_factory,
    "ollama-local": _ollama_factory,
})

# ==================== TTS REGISTRY ====================

TTS_FACTORIES: dict[str, Callable[[], TTSBase]] = {
    "qwen3-base": _qwen3_base_tts_factory,
    "gemini-tts-flash": _gemini_tts_flash_factory,
    "gemini-tts-pro": _gemini_tts_pro_factory,
}

# Keep backward-compatible dict names used by older pipeline code.
LLM_MODELS: dict[str, Callable[[], LLMBase]] = {}

TTS_MODELS: dict[str, Callable[[], TTSBase]] = dict(TTS_FACTORIES)


# ---------------------------------------------------------------------------
# Public look-up API
# ---------------------------------------------------------------------------

def get_llm(model_id: str) -> LLMBase:
    """Look up *model_id* in the LLM registry, instantiate, and return.

    Args:
        model_id: A key from ``LLM_FACTORIES`` (e.g. ``"gemini-2.5-flash"``).

    Returns:
        A fresh ``LLMBase`` instance ready for ``load()`` / ``generate()``.

    Raises:
        ValueError: If *model_id* is not registered.
    """
    factory = LLM_FACTORIES.get(model_id)
    if factory is None:
        available = ", ".join(LLM_FACTORIES.keys())
        raise ValueError(f"Unknown LLM model '{model_id}'. Available: {available}")
    return factory()


def get_tts(model_id: str) -> TTSBase:
    """Look up *model_id* in the TTS registry, instantiate, and return.

    Args:
        model_id: A key from ``TTS_FACTORIES`` (e.g. ``"qwen3-base"``).

    Returns:
        A fresh ``TTSBase`` instance ready for ``load()`` / ``synthesize()``.

    Raises:
        ValueError: If *model_id* is not registered.
    """
    factory = TTS_FACTORIES.get(model_id)
    if factory is None:
        available = ", ".join(TTS_FACTORIES.keys())
        raise ValueError(f"Unknown TTS model '{model_id}'. Available: {available}")
    return factory()
