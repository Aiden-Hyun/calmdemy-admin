"""LM Studio LLM adapter — calls the OpenAI-compatible API at localhost:1234."""

import os
import json
import urllib.request
import urllib.error
from .llm_base import LLMBase
from observability import get_logger


logger = get_logger(__name__)


class LMStudioAdapter(LLMBase):
    """LLM adapter that uses a locally running LM Studio server.

    LM Studio exposes an OpenAI-compatible API at http://localhost:1234/v1.
    The user loads any model in LM Studio's UI; this adapter calls it via
    the chat completions endpoint.
    """

    DEFAULT_HOST = "http://localhost:1234"

    def __init__(self):
        self._host = os.getenv("LMSTUDIO_HOST", self.DEFAULT_HOST)

    def load(self, model_dir: str) -> None:
        """Verify LM Studio is reachable and a model is loaded."""
        logger.info("Checking LM Studio", extra={"host": self._host})
        try:
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
        """Generate text using the LM Studio OpenAI-compatible API."""
        logger.info("Generating with LM Studio")

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
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = json.loads(resp.read().decode())
                choices = data.get("choices", [])
                if not choices:
                    raise RuntimeError("LM Studio returned no choices")
                text = choices[0].get("message", {}).get("content", "")
                logger.info("LM Studio generated text", extra={"chars": len(text)})
                return text.strip()
        except urllib.error.URLError as e:
            raise RuntimeError(f"LM Studio API call failed: {e}")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from LM Studio: {e}")

    def unload(self) -> None:
        """No resources to free — LM Studio manages its own models."""
        pass
