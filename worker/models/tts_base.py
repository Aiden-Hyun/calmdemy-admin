"""Base class for TTS adapters."""

from abc import ABC, abstractmethod


class TTSBase(ABC):
    """Abstract base for all TTS model adapters."""

    @abstractmethod
    def load(self, model_dir: str, voice_id: str) -> None:
        """Load model and voice configuration."""

    @abstractmethod
    def synthesize(self, text: str, output_path: str) -> None:
        """Convert text to audio and save as WAV file."""

    def unload(self) -> None:
        """Optional: free resources after synthesis."""
