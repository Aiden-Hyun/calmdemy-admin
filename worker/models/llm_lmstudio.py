"""LM Studio LLM adapter -- calls the OpenAI-compatible API at localhost:1234.

Architectural Role:
    Concrete **Strategy** (``LLMBase``) for locally-hosted models served
    by `LM Studio <https://lmstudio.ai>`_.  LM Studio exposes an
    OpenAI-compatible REST API, so this adapter uses the
    ``/v1/chat/completions`` endpoint -- the same shape as the OpenAI
    Python SDK would use, but we call it with plain ``urllib`` to avoid
    an extra dependency.

Design Patterns:
    - **Strategy** -- interchangeable with ``GeminiAPIAdapter`` /
      ``OllamaAdapter`` behind the ``LLMBase`` interface.
    - **Adapter** -- translates ``generate(prompt)`` into OpenAI
      chat-completions JSON.

Key Dependencies:
    - A running LM Studio local server (default ``http://localhost:1234``)
    - Override host via ``LMSTUDIO_HOST`` env var

Consumed By:
    - ``worker.models.registry`` (via ``_lmstudio_factory``)
"""

import os
import json
import urllib.request
import urllib.error
from .llm_base import LLMBase
from observability import get_logger


logger = get_logger(__name__)


class LMStudioAdapter(LLMBase):
    """LLM adapter that delegates generation to a local LM Studio server.

    LM Studio exposes an OpenAI-compatible API at
    ``http://localhost:1234/v1``.  The user loads any GGUF model in
    LM Studio's GUI; this adapter talks to whichever model is currently
    active via the ``/v1/chat/completions`` endpoint.

    Attributes:
        DEFAULT_HOST: LM Studio's default listen address.
    """

    DEFAULT_HOST = "http://localhost:1234"

    def __init__(self):
        self._host = os.getenv("LMSTUDIO_HOST", self.DEFAULT_HOST)

    def load(self, model_dir: str) -> None:
        """Verify LM Studio is reachable and at least one model is loaded.

        Args:
            model_dir: Ignored; LM Studio manages its own model storage.
        """
        logger.info("Checking LM Studio", extra={"host": self._host})
        try:
            # OpenAI-compatible /v1/models endpoint lists loaded models
            req = urllib.request.Request(f"{self._host}/v1/models")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                models = data.get("data", [])
                model_ids = [m.get("id", "") for m in models]
                if model_ids:
                    logger.info("LM Studio loaded models", extra={"models": model_ids})
                else:
                    logger.warning("LM Studio has no models loaded")
        except urllib.error.URLError as e:
            raise RuntimeError(
                f"Cannot connect to LM Studio at {self._host}. "
                f"Make sure LM Studio is running with the local server enabled.\n"
                f"Error: {e}"
            )

    def generate(self, prompt: str, max_tokens: int = 4096) -> str:
        """Send *prompt* to LM Studio's ``/v1/chat/completions`` endpoint.

        The prompt is wrapped in a single ``user`` message, matching the
        OpenAI chat-completions format that LM Studio expects.

        Args:
            prompt: Full prompt string.
            max_tokens: Maximum output tokens.

        Returns:
            Generated text, whitespace-stripped.
        """
        logger.info("Generating with LM Studio")

        # Wrap prompt as a chat message -- LM Studio uses OpenAI's
        # chat/completions format, not a raw prompt string.
        payload = json.dumps({
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.7,
            "top_p": 0.9,
            "stream": False,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self._host}/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json"},
        )

        try:
            # 10-minute timeout: local generation can be slow on CPU
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = json.loads(resp.read().decode())
                choices = data.get("choices", [])
                if not choices:
                    raise RuntimeError("LM Studio returned no choices")
                # Navigate OpenAI response shape: choices[0].message.content
                text = choices[0].get("message", {}).get("content", "")
                logger.info("LM Studio generated text", extra={"chars": len(text)})
                return text.strip()
        except urllib.error.URLError as e:
            raise RuntimeError(f"LM Studio API call failed: {e}")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from LM Studio: {e}")

    def unload(self) -> None:
        """No-op -- LM Studio manages its own GPU memory lifecycle."""
        pass
