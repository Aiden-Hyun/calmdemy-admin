"""Gemini API LLM adapter — calls Google Gemini via the google-genai SDK."""

import os
from google import genai
from .llm_base import LLMBase
from observability import get_logger


logger = get_logger(__name__)


class GeminiAPIAdapter(LLMBase):
    """LLM adapter that uses the Google Gemini API.

    Supported model IDs:
      - gemini-2.5-flash  (maps to gemini-2.5-flash)
      - gemini-2.5-pro    (maps to gemini-2.5-pro)
    """

    # Map our model IDs to Gemini API model names
    MODEL_MAP = {
        "gemini-2.5-flash": "gemini-2.5-flash-preview-05-20",
        "gemini-2.5-pro": "gemini-2.5-pro-preview-05-06",
    }

    def __init__(self, model_id: str = "gemini-2.5-flash"):
        self._model_id = model_id
        self._client = None

    def load(self, model_dir: str) -> None:
        """Initialize the Gemini API client. No model weights to load."""
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY environment variable is not set. "
                "Get one at https://aistudio.google.com/apikey"
            )
        self._client = genai.Client(api_key=api_key)
        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        logger.info("Gemini API initialized", extra={"model": model_name})

    def generate(self, prompt: str, max_tokens: int = 4096) -> str:
        """Generate text using the Gemini API."""
        if self._client is None:
            raise RuntimeError("Client not initialized. Call load() first.")

        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        logger.info("Generating with Gemini API", extra={"model": model_name})

        response = self._client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                max_output_tokens=max_tokens,
                temperature=0.7,
                top_p=0.9,
            ),
        )

        text = response.text or ""
        logger.info("Gemini API generated text", extra={"model": model_name, "chars": len(text)})
        return text.strip()

    def unload(self) -> None:
        """No resources to free for API-based model."""
        self._client = None
