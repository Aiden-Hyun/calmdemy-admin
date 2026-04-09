"""Gemini API LLM adapter -- calls Google Gemini via the ``google-genai`` SDK.

Architectural Role:
    Concrete **Strategy** (``LLMBase``) for cloud-hosted Google Gemini
    models.  Also acts as an **Adapter** -- it translates our simple
    ``generate(prompt)`` interface into the Gemini SDK's richer
    ``generate_content`` call with typed config objects.

Design Patterns:
    - **Strategy** -- plugs into the registry as one of several LLM
      providers behind the ``LLMBase`` interface.
    - **Adapter** -- wraps the ``google.genai.Client`` so the rest of
      the worker never imports or configures the Google SDK directly.

Key Dependencies:
    - ``google-genai`` SDK (``google.genai``)
    - ``GEMINI_API_KEY`` environment variable

Consumed By:
    - ``worker.models.registry`` (via ``_gemini_flash_factory`` /
      ``_gemini_pro_factory``)
"""

import os
from google import genai
from .llm_base import LLMBase
from observability import get_logger


logger = get_logger(__name__)


class GeminiAPIAdapter(LLMBase):
    """Adapter that wraps the Google Gemini API behind ``LLMBase``.

    Supported model IDs:
        - ``gemini-2.5-flash``  (fast, cost-effective)
        - ``gemini-2.5-pro``    (higher quality, slower)

    Attributes:
        MODEL_MAP: Translates our short model IDs to the full Gemini API
            preview model names, which include version suffixes.
    """

    # Indirection layer: our stable model IDs -> Gemini's versioned preview names.
    # Update the right-hand side when Google promotes a new preview.
    MODEL_MAP = {
        "gemini-2.5-flash": "gemini-2.5-flash-preview-05-20",
        "gemini-2.5-pro": "gemini-2.5-pro-preview-05-06",
    }

    def __init__(self, model_id: str = "gemini-2.5-flash"):
        self._model_id = model_id
        self._client = None  # Initialized lazily in load()

    def load(self, model_dir: str) -> None:
        """Initialize the Gemini API client.

        Unlike local adapters, there are no weights to load -- this just
        authenticates with the API.

        Args:
            model_dir: Ignored for cloud models; kept for interface compat.
        """
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY environment variable is not set. "
                "Get one at https://aistudio.google.com/apikey"
            )
        self._client = genai.Client(api_key=api_key)
        # Fall back to raw model_id if it's not in our map (forward compat)
        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        logger.info("Gemini API initialized", extra={"model": model_name})

    def generate(self, prompt: str, max_tokens: int = 4096) -> str:
        """Generate text by calling the Gemini ``generate_content`` endpoint.

        Args:
            prompt: Full prompt string.
            max_tokens: Maximum output tokens.

        Returns:
            Generated text, whitespace-stripped.
        """
        if self._client is None:
            raise RuntimeError("Client not initialized. Call load() first.")

        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        logger.info("Generating with Gemini API", extra={"model": model_name})

        response = self._client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                max_output_tokens=max_tokens,
                temperature=0.7,   # Moderate creativity for meditation scripts
                top_p=0.9,
            ),
        )

        text = response.text or ""
        logger.info("Gemini API generated text", extra={"model": model_name, "chars": len(text)})
        return text.strip()

    def unload(self) -> None:
        """Drop the API client reference.  No GPU resources to free."""
        self._client = None
