"""
Model registry — maps model IDs from job config to adapter classes.

To add a new model:
  1. Write an adapter in models/llm_<name>.py or models/tts_<name>.py
  2. Add an entry to LLM_FACTORIES or TTS_FACTORIES below
  3. Add the model ID to the admin UI constants (src/features/admin/constants/models.ts)
"""

from __future__ import annotations

import importlib
from typing import Callable

from .llm_base import LLMBase
from .tts_base import TTSBase

def _load_symbol(module_name: str, symbol: str):
    module = importlib.import_module(module_name, package=__package__)
    return getattr(module, symbol)


def _factory(module_name: str, symbol: str, **kwargs):
    cls = _load_symbol(module_name, symbol)
    return cls(**kwargs) if kwargs else cls()


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

# Keep backward-compatible dict names
LLM_MODELS: dict[str, Callable[[], LLMBase]] = {}

TTS_MODELS: dict[str, Callable[[], TTSBase]] = dict(TTS_FACTORIES)


def get_llm(model_id: str) -> LLMBase:
    """Instantiate an LLM adapter by ID."""
    factory = LLM_FACTORIES.get(model_id)
    if factory is None:
        available = ", ".join(LLM_FACTORIES.keys())
        raise ValueError(f"Unknown LLM model '{model_id}'. Available: {available}")
    return factory()


def get_tts(model_id: str) -> TTSBase:
    """Instantiate a TTS adapter by ID."""
    factory = TTS_FACTORIES.get(model_id)
    if factory is None:
        available = ", ".join(TTS_FACTORIES.keys())
        raise ValueError(f"Unknown TTS model '{model_id}'. Available: {available}")
    return factory()
