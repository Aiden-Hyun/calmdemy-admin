"""Abstract base class for TTS (Text-to-Speech) provider adapters.

Architectural Role:
    Defines the **Strategy interface** for speech synthesis.  Every TTS
    provider (Gemini TTS API, Qwen3 local model, etc.) implements this
    ABC so the pipeline can swap voices/providers without changing
    calling code.

Design Patterns:
    - **Strategy** -- callers program against ``TTSBase``, not a concrete
      class.  ``registry.py`` resolves the concrete strategy at runtime.
    - **Template Method** (lightweight) -- ``unload()`` defaults to a
      no-op; GPU-backed subclasses override it to free VRAM.

Key Dependencies:
    None -- kept dependency-free like ``LLMBase``.

Consumed By:
    - ``worker.models.registry`` (type annotations for factory dicts)
    - ``worker.pipeline`` (calls ``load`` / ``synthesize`` / ``unload``)
"""

from abc import ABC, abstractmethod


class TTSBase(ABC):
    """Strategy interface that every TTS adapter must implement.

    Lifecycle:
        1. ``load(model_dir, voice_id)``    -- acquire model + voice config
        2. ``synthesize(text, output_path)`` -- generate WAV audio
        3. ``unload()``                      -- release resources (optional)
    """

    @abstractmethod
    def load(self, model_dir: str, voice_id: str) -> None:
        """Acquire model resources and configure the target voice.

        Args:
            model_dir: Filesystem path where model weights are stored.
            voice_id: Identifier for the voice to use (e.g. a reference
                      audio filename or a cloud voice name).
        """

    @abstractmethod
    def synthesize(self, text: str, output_path: str) -> None:
        """Convert text to speech audio and write a WAV file.

        Args:
            text: The script/text to speak.
            output_path: Destination path for the output WAV file.
        """

    def unload(self) -> None:
        """Release GPU memory or API resources after synthesis.

        Default is a no-op.  Override in subclasses that hold heavyweight
        resources (e.g. GPU tensors).
        """
