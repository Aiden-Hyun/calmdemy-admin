"""Ollama LLM adapter — calls a local Ollama server via its REST API."""

import os
import json
import urllib.request
import urllib.error
from .llm_base import LLMBase
from observability import get_logger


logger = get_logger(__name__)


class OllamaAdapter(LLMBase):
    """LLM adapter that uses a locally running Ollama server.

    Ollama manages model downloads and loading. The user selects a model
    in Ollama (e.g. gemma3, llama3, mistral) and this adapter calls it.
    """

    DEFAULT_HOST = "http://localhost:11434"

    def __init__(self, model_name: str = "gemma3"):
        self._model_name = model_name
        self._host = os.getenv("OLLAMA_HOST", self.DEFAULT_HOST)

    def load(self, model_dir: str) -> None:
        """Verify Ollama is reachable. No model weights to load ourselves."""
        logger.info("Checking Ollama", extra={"host": self._host})
        try:
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
        """Generate text using the Ollama API."""
        logger.info("Generating with Ollama", extra={"model": self._model_name})

        payload = json.dumps({
            "model": self._model_name,
            "prompt": prompt,
            "stream": False,
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
        """No resources to free — Ollama manages its own models."""
        pass
