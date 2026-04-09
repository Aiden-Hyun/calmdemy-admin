"""Abstract base class for LLM (Large Language Model) provider adapters.

Architectural Role:
    Defines the **Strategy interface** for text generation. Every LLM
    provider (Gemini API, Ollama, LM Studio, etc.) implements this ABC
    so the rest of the worker can swap providers without changing any
    calling code.

Design Patterns:
    - **Strategy** -- callers program against ``LLMBase``, not a concrete
      class.  The registry (``registry.py``) picks the right concrete
      strategy at runtime based on a model-ID string from the job config.
    - **Template Method** (lightweight) -- ``unload()`` provides a default
      no-op so subclasses only override it when they hold GPU resources.

Key Dependencies:
    None -- this module is intentionally dependency-free so it can be
    imported without pulling in heavy ML libraries.

Consumed By:
    - ``worker.models.registry`` (type annotations for factory dicts)
    - ``worker.pipeline`` (calls ``load`` / ``generate`` / ``unload``)
"""

from abc import ABC, abstractmethod


class LLMBase(ABC):
    """Strategy interface that every LLM adapter must implement.

    Lifecycle:
        1. ``load(model_dir)``   -- acquire resources (API client, weights)
        2. ``generate(prompt)``  -- produce text
        3. ``unload()``          -- release resources (optional)
    """

    @abstractmethod
    def load(self, model_dir: str) -> None:
        """Acquire model resources (download weights, init API client, etc.).

        Args:
            model_dir: Filesystem path where model weights are stored.
                       API-based adapters may ignore this.
        """

    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 4096) -> str:
        """Generate text from a prompt.

        Args:
            prompt: The full prompt string to send to the model.
            max_tokens: Upper bound on generated tokens.

        Returns:
            The generated text, stripped of leading/trailing whitespace.
        """

    def unload(self) -> None:
        """Release GPU memory or API resources after generation.

        Default is a no-op.  Override in subclasses that hold heavyweight
        resources (e.g. GPU tensors, open connections).
        """
