"""Tiny adapter layer that hides model-registry lookups from callers."""

from __future__ import annotations

from models.registry import get_llm, get_tts

import config


class LLMGateway:
    """Load the requested LLM adapter and ask it to generate text."""

    def generate(self, model_id: str, prompt: str, max_tokens: int) -> str:
        adapter = get_llm(model_id)
        adapter.load(config.MODEL_DIR)
        return adapter.generate(prompt, max_tokens=max_tokens)


class TTSGateway:
    """Load the requested TTS adapter and synthesize one script to a file."""

    def synthesize(self, model_id: str, voice_id: str, script: str, output_path: str) -> str:
        adapter = get_tts(model_id)
        adapter.load(config.MODEL_DIR, voice_id)
        adapter.synthesize(script, output_path)
        return output_path
