"""Base class for LLM adapters."""

from abc import ABC, abstractmethod


class LLMBase(ABC):
    """Abstract base for all LLM model adapters."""

    @abstractmethod
    def load(self, model_dir: str) -> None:
        """Load model weights from disk."""

    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 4096) -> str:
        """Generate text from a prompt."""

    def unload(self) -> None:
        """Optional: free GPU memory after generation."""
