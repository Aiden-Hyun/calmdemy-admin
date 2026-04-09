"""Gateway adapters for LLM and TTS model calls.

Architectural Role
------------------
Infrastructure Layer -- "driven" (right-hand) adapters in hexagonal
architecture.  These gateways sit between domain/application code and
the concrete model implementations registered in ``models.registry``.

Design Patterns
---------------
* **Gateway / Adapter** -- the application layer calls
  ``LLMGateway.generate(model_id, ...)`` without knowing *which*
  concrete model library (OpenAI, local GGUF, etc.) fulfils the
  request.  The gateway delegates to whatever adapter the registry
  returns for ``model_id``.  This makes it trivial to swap models
  (e.g. switching TTS engines) without touching orchestration code.
* **Service Locator** -- ``get_llm`` / ``get_tts`` look up the right
  adapter at runtime by model ID, so new models can be registered
  without modifying this file.

Key Dependencies
----------------
* ``models.registry`` -- runtime model lookup (returns adapter objects
  with ``.load()`` / ``.generate()`` / ``.synthesize()`` interfaces).
* ``config.MODEL_DIR`` -- filesystem path where model weights live.

Consumed By
-----------
* Step executors (``generate_script``, ``synthesize_audio``, etc.).
"""

from __future__ import annotations

from models.registry import get_llm, get_tts

import config


class LLMGateway:
    """Gateway for Large Language Model text generation.

    Callers provide a ``model_id`` string; the gateway resolves it to the
    matching adapter, loads weights if needed, and returns generated text.
    """

    def generate(self, model_id: str, prompt: str, max_tokens: int) -> str:
        """Generate text from a prompt using the specified LLM.

        Args:
            model_id: Registry key identifying the LLM (e.g. ``"gpt-4"``).
            prompt: The input prompt / instruction.
            max_tokens: Upper bound on the generated token count.

        Returns:
            The generated text string.
        """
        adapter = get_llm(model_id)
        # load() is idempotent -- adapters cache weights after first call.
        adapter.load(config.MODEL_DIR)
        return adapter.generate(prompt, max_tokens=max_tokens)


class TTSGateway:
    """Gateway for Text-to-Speech synthesis.

    Resolves ``model_id`` to a TTS adapter, loads the voice, and writes
    an audio file to ``output_path``.
    """

    def synthesize(self, model_id: str, voice_id: str, script: str, output_path: str) -> str:
        """Synthesize a script into an audio file.

        Args:
            model_id: Registry key for the TTS engine (e.g. ``"qwen3"``).
            voice_id: Voice preset to use within that engine.
            script: The text to speak.
            output_path: Where to write the resulting audio file.

        Returns:
            The same ``output_path`` for convenience in chaining.
        """
        adapter = get_tts(model_id)
        adapter.load(config.MODEL_DIR, voice_id)
        adapter.synthesize(script, output_path)
        return output_path
