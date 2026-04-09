"""Ollama LLM adapter -- calls a local Ollama server via its REST API.

Architectural Role:
    Concrete **Strategy** (``LLMBase``) for locally-hosted models managed
    by `Ollama <https://ollama.com>`_.  Ollama handles downloading,
    quantising, and serving models; this adapter simply makes HTTP calls
    to Ollama's ``/api/generate`` endpoint.

Design Patterns:
    - **Strategy** -- interchangeable with ``GeminiAPIAdapter`` and
      ``LMStudioAdapter`` behind the ``LLMBase`` interface.
    - **Adapter** -- translates ``generate(prompt)`` into Ollama's
      JSON-over-HTTP protocol using only ``urllib`` (no third-party
      HTTP client needed).

Key Dependencies:
    - A running Ollama server (default ``http://localhost:11434``)
    - Override host via ``OLLAMA_HOST`` env var

Consumed By:
    - ``worker.models.registry`` (via ``_ollama_factory``)
"""

import os
import json
import urllib.request
import urllib.error
from .llm_base import LLMBase
from observability import get_logger


logger = get_logger(__name__)


class OllamaAdapter(LLMBase):
    """LLM adapter that delegates generation to a local Ollama server.

    Ollama manages model downloads and GPU loading.  The user selects a
    model in Ollama (e.g. ``gemma3``, ``llama3``, ``mistral``) and this
    adapter forwards prompts to it.

    Attributes:
        DEFAULT_HOST: Ollama's default listen address.
    """

    DEFAULT_HOST = "http://localhost:11434"

    def __init__(self, model_name: str = "gemma3"):
        self._model_name = model_name
        self._host = os.getenv("OLLAMA_HOST", self.DEFAULT_HOST)

    def load(self, model_dir: str) -> None:
        """Verify Ollama is reachable and list available models.

        We do not load weights ourselves -- Ollama does that on first
        ``/api/generate`` call.  This is purely a connectivity health check.

        Args:
            model_dir: Ignored; Ollama manages its own model storage.
        """
        logger.info("Checking Ollama", extra={"host": self._host})
        try:
            # Hit the /api/tags endpoint to list models Ollama has pulled
            req = urllib.request.Request(f"{self._host}/api/tags")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                model_names = [m.get("name", "") for m in data.get("models", [])]
                logger.info("Ollama models", extra={"models": model_names})
        except urllib.error.URLError as e:
            raise RuntimeError(
                f"Cannot connect to Ollama at {self._host}. "
                f"Make sure Ollama is running: ollama serve\n"
                f"Error: {e}"
            )
        logger.info("Ollama model selected", extra={"model": self._model_name})

    def generate(self, prompt: str, max_tokens: int = 4096) -> str:
        """Send *prompt* to Ollama's ``/api/generate`` endpoint.

        Args:
            prompt: Full prompt string.
            max_tokens: Maps to Ollama's ``num_predict`` option.

        Returns:
            Generated text, whitespace-stripped.
        """
        logger.info("Generating with Ollama", extra={"model": self._model_name})

        payload = json.dumps({
            "model": self._model_name,
            "prompt": prompt,
            "stream": False,  # Get the full response in one shot (no SSE)
            "options": {
                "num_predict": max_tokens,
                "temperature": 0.7,
                "top_p": 0.9,
            },
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self._host}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
        )

        try:
            # 10-minute timeout: local generation can be slow on CPU
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = json.loads(resp.read().decode())
                text = data.get("response", "")
                logger.info(
                    "Ollama generated text",
                    extra={"model": self._model_name, "chars": len(text)},
                )
                return text.strip()
        except urllib.error.URLError as e:
            raise RuntimeError(f"Ollama API call failed: {e}")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from Ollama: {e}")

    def unload(self) -> None:
        """No-op -- Ollama manages its own GPU memory lifecycle."""
        pass
