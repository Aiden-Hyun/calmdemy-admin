"""Gemini TTS adapter — uses Gemini API for text-to-speech synthesis."""

import os
import wave
import struct
from google import genai
from .tts_base import TTSBase
from observability import get_logger


logger = get_logger(__name__)


class GeminiTTSAdapter(TTSBase):
    """TTS adapter using Google Gemini TTS API.

    Supported model IDs:
      - gemini-tts-flash  (maps to gemini-2.5-flash-preview-tts)
      - gemini-tts-pro    (maps to gemini-2.5-pro-preview-tts)
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
        """Initialize the Gemini API client for TTS."""
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
        """Convert text to audio using the Gemini TTS API and save as WAV."""
        if self._client is None:
            raise RuntimeError("Client not initialized. Call load() first.")

        model_name = self.MODEL_MAP.get(self._model_id, self._model_id)
        word_count = len(text.split())
        logger.info(
            "Gemini TTS synthesizing",
            extra={"model": model_name, "words": word_count, "voice_id": self._voice_id},
        )

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

        # Extract audio data from the response
        audio_data = None
        sample_rate = 24000  # Gemini TTS default sample rate

        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                audio_data = part.inline_data.data
                # Try to get sample rate from mime type
                mime = part.inline_data.mime_type or ""
                if "rate=" in mime:
                    try:
                        rate_str = mime.split("rate=")[1].split(";")[0]
                        sample_rate = int(rate_str)
                    except (ValueError, IndexError):
                        pass
                break

        if audio_data is None:
            raise RuntimeError("Gemini TTS did not return audio data")

        # Write raw PCM data as WAV file
        # Gemini returns linear16 PCM audio
        with wave.open(output_path, "w") as wf:
            wf.setnchannels(1)  # mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data)

        # Report duration
        num_samples = len(audio_data) // 2  # 16-bit = 2 bytes per sample
        duration = num_samples / sample_rate
        logger.info(
            "Gemini TTS audio generated",
            extra={"duration_sec": duration, "model": model_name, "voice_id": self._voice_id},
        )

    def unload(self) -> None:
        """No resources to free for API-based TTS."""
        self._client = None
