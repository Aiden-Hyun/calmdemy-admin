"""Gemini TTS adapter -- uses the Google Gemini API for text-to-speech synthesis.

Architectural Role:
    Concrete **Strategy** (``TTSBase``) for cloud-hosted speech synthesis
    via Google Gemini.  Gemini's TTS is a multimodal endpoint: you send
    text and request ``AUDIO`` modality back, receiving raw PCM bytes
    that this adapter wraps into a standard WAV file.

Design Patterns:
    - **Strategy** -- interchangeable with ``Qwen3BaseTTSAdapter``
      behind the ``TTSBase`` interface.
    - **Adapter** -- wraps Gemini's multimodal ``generate_content`` call
      (with ``response_modalities=["AUDIO"]``) into the simpler
      ``synthesize(text, output_path)`` contract.

Key Dependencies:
    - ``google-genai`` SDK (``google.genai``)
    - ``GEMINI_API_KEY`` environment variable
    - ``wave`` (stdlib) for WAV file writing

Consumed By:
    - ``worker.models.registry`` (via ``_gemini_tts_flash_factory`` /
      ``_gemini_tts_pro_factory``)
"""

import os
import wave
import struct
from google import genai
from .tts_base import TTSBase
from observability import get_logger


logger = get_logger(__name__)


class GeminiTTSAdapter(TTSBase):
    """Adapter that wraps Google Gemini's multimodal TTS behind ``TTSBase``.

    Gemini returns raw linear-16 PCM audio bytes.  This adapter parses
    the sample rate from the response MIME type and writes a valid WAV.

    Supported model IDs:
        - ``gemini-tts-flash``  (fast, cost-effective)
        - ``gemini-tts-pro``    (higher quality, slower)

    Attributes:
        MODEL_MAP: Our stable model IDs -> Gemini's versioned TTS preview names.
    """

    MODEL_MAP = {
        "gemini-tts-flash": "gemini-2.5-flash-preview-tts",
        "gemini-tts-pro": "gemini-2.5-pro-preview-tts",
    }

    def __init__(self, model_id: str = "gemini-tts-flash"):
        self._model_id = model_id
        self._client = None
        self._voice_id = None

    def load(self, model_dir: str, voice_id: str) -> None:
        """Initialize the Gemini API client for TTS.

        Args:
            model_dir: Ignored for cloud models.
            voice_id: Stored but currently overridden by the hardcoded
                      ``"Kore"`` voice in ``synthesize()``.
        """
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY environment variable is not set. "
                "Get one at https://aistudio.google.com/apikey"
            )
        self._client = genai.Client(api_key=api_key)
        self._voice_id = voice_id
        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        logger.info("Gemini TTS initialized", extra={"model": model_name, "voice_id": voice_id})

    def synthesize(self, text: str, output_path: str) -> None:
        """Convert text to speech via Gemini and write a WAV file.

        The flow is:
            1. Send text + AUDIO modality config to ``generate_content``
            2. Parse raw PCM bytes + sample rate from the response
            3. Wrap the PCM data in a WAV header and write to disk

        Args:
            text: Script to synthesize.
            output_path: Destination ``.wav`` file path.
        """
        if self._client is None:
            raise RuntimeError("Client not initialized. Call load() first.")

        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        word_count = len(text.split())
        logger.info(
            "Gemini TTS synthesizing",
            extra={"model": model_name, "words": word_count, "voice_id": self._voice_id},
        )

        # Request audio output from Gemini's multimodal endpoint.
        # The prompt prefix steers the voice style toward calm meditation.
        response = self._client.models.generate_content(
            model=model_name,
            contents=f"Please read this script aloud in a calm, soothing voice:\n\n{text}",
            config=genai.types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=genai.types.SpeechConfig(
                    voice_config=genai.types.VoiceConfig(
                        prebuilt_voice_config=genai.types.PrebuiltVoiceConfig(
                            voice_name="Kore",  # calm, soothing voice
                        )
                    )
                ),
            ),
        )

        # --- Extract raw PCM bytes from the multimodal response ----------
        audio_data = None
        sample_rate = 24000  # Gemini TTS default when MIME doesn't specify

        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                audio_data = part.inline_data.data
                # MIME type may look like "audio/L16;rate=24000" --
                # parse the sample rate if present.
                mime = part.inline_data.mime_type or ""
                if "rate=" in mime:
                    try:
                        rate_str = mime.split("rate=")[1].split(";")[0]
                        sample_rate = int(rate_str)
                    except (ValueError, IndexError):
                        pass  # Fall back to default 24 kHz
                break  # Only need the first audio part

        if audio_data is None:
            raise RuntimeError("Gemini TTS did not return audio data")

        # --- Write raw PCM data as a WAV file ----------------------------
        # Gemini returns linear-16 PCM (16-bit signed, mono).
        with wave.open(output_path, "w") as wf:
            wf.setnchannels(1)          # mono
            wf.setsampwidth(2)          # 16-bit = 2 bytes per sample
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data)

        # --- Report duration for observability ---------------------------
        num_samples = len(audio_data) // 2  # 16-bit = 2 bytes per sample
        duration = num_samples / sample_rate
        logger.info(
            "Gemini TTS audio generated",
            extra={"duration_sec": duration, "model": model_name, "voice_id": self._voice_id},
        )

    def unload(self) -> None:
        """Drop the API client reference.  No GPU resources to free."""
        self._client = None
