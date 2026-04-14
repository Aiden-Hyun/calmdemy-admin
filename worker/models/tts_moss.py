"""MOSS-TTS adapter -- local voice-clone synthesis via HuggingFace.

Concrete Strategy (``TTSBase``) that runs the MOSS-TTS-Local-Transformer
(1.7B) model locally for zero-shot voice cloning.  Unlike the Qwen3
adapter, MOSS-TTS does NOT require a reference transcript — only the
reference audio clip is needed for voice cloning.

Key Dependencies:
    - ``transformers`` (5.0+) with ``trust_remote_code=True``
    - ``torch`` / ``torchaudio``
    - ``soundfile`` (fallback WAV writer)

Consumed By:
    - ``models.registry`` -- registered as ``"moss-tts"``
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from observability import get_logger
from .tts_base import TTSBase

logger = get_logger(__name__)

_DEFAULT_MODEL_NAME = "OpenMOSS-Team/MOSS-TTS-Local-Transformer"
_DEFAULT_VOICE_ID = "declutter_the_mind_7s"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sample_voice_dirs() -> list[Path]:
    """Build the search path for ``sample_voices/`` directories."""
    candidates: list[Path] = []
    worker_dir = Path(__file__).resolve().parent.parent
    workspace_dir = worker_dir.parent
    candidates.extend([
        workspace_dir / "sample_voices",
        worker_dir / "sample_voices",
    ])
    env_override = os.getenv("MOSS_TTS_SAMPLE_VOICES_DIR", "").strip()
    if env_override:
        candidates.append(Path(env_override).expanduser())
    deduped: list[Path] = []
    for c in candidates:
        if c not in deduped:
            deduped.append(c)
    return deduped


def _resolve_reference_audio(voice_id: str) -> Path:
    """Locate a reference audio file for voice cloning.

    MOSS-TTS only needs the audio file — no transcript required.
    """
    base_name = (voice_id or "").strip() or os.getenv(
        "MOSS_TTS_DEFAULT_VOICE_ID", _DEFAULT_VOICE_ID
    )
    voice_dirs = _sample_voice_dirs()
    audio_suffixes = (".wav", ".mp3", ".flac", ".m4a")

    for voice_dir in voice_dirs:
        for suffix in audio_suffixes:
            audio_path = voice_dir / f"{base_name}{suffix}"
            if audio_path.is_file():
                return audio_path

    searched = ", ".join(str(p) for p in voice_dirs)
    raise RuntimeError(
        f"MOSS-TTS reference voice '{base_name}' not found. Searched: {searched}"
    )


def _resolve_device() -> tuple[str, Any, Any]:
    """Detect the best available compute device.

    Resolution: MPS (Apple Silicon) > CPU.
    MOSS-TTS Local uses float32 on both MPS and CPU.
    """
    try:
        import torch
    except Exception as exc:
        raise RuntimeError(
            "torch is required for MOSS-TTS. "
            "Install dependencies in .venv-moss."
        ) from exc

    device_arg = os.getenv("MOSS_TTS_DEVICE", "auto").strip().lower() or "auto"

    if device_arg == "auto":
        if torch.backends.mps.is_available():
            return "mps", torch.float32, torch
        return "cpu", torch.float32, torch

    if device_arg.startswith("cuda"):
        return device_arg, torch.bfloat16, torch
    if device_arg == "mps":
        return "mps", torch.float32, torch
    return "cpu", torch.float32, torch


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

class MossTTSAdapter(TTSBase):
    """Local voice-cloning TTS using the MOSS-TTS-Local-Transformer model.

    Uses HuggingFace AutoModel/AutoProcessor with zero-shot voice cloning.
    Only requires a reference audio clip (no transcript needed).
    """

    def __init__(self):
        self._model = None
        self._processor = None
        self._torch = None
        self._device = "cpu"
        self._dtype = None
        self._voice_id = None
        self._ref_audio: Path | None = None
        self._max_new_tokens = int(
            os.getenv("MOSS_TTS_MAX_NEW_TOKENS", "4096")
        )

    def load(self, model_dir: str, voice_id: str) -> None:
        """Load the MOSS-TTS model and configure the target voice."""
        try:
            from transformers import AutoModel, AutoProcessor
        except ImportError as exc:
            raise RuntimeError(
                "transformers 5.0+ is required for MOSS-TTS. "
                "Install dependencies in worker/.venv-moss."
            ) from exc

        self._device, self._dtype, self._torch = _resolve_device()
        self._voice_id = voice_id
        self._ref_audio = _resolve_reference_audio(voice_id)

        model_name = os.getenv(
            "MOSS_TTS_MODEL_NAME", _DEFAULT_MODEL_NAME
        ).strip()

        logger.info("Loading MOSS-TTS", extra={
            "model": model_name,
            "device": self._device,
            "voice_id": voice_id,
            "ref_audio": str(self._ref_audio),
        })

        attn_impl = "eager"
        if self._device.startswith("cuda"):
            attn_impl = "flash_attention_2"

        self._processor = AutoProcessor.from_pretrained(
            model_name, trust_remote_code=True
        )
        self._processor.audio_tokenizer = (
            self._processor.audio_tokenizer.to(self._device)
        )

        self._model = AutoModel.from_pretrained(
            model_name,
            trust_remote_code=True,
            attn_implementation=attn_impl,
            torch_dtype=self._dtype,
        ).to(self._device)
        self._model.eval()

        logger.info("MOSS-TTS loaded", extra={
            "device": self._device, "model": model_name,
        })

    def synthesize(self, text: str, output_path: str) -> None:
        """Generate voice-cloned speech and write it as a WAV file."""
        if not self._model or not self._processor or not self._ref_audio:
            raise RuntimeError("MOSS-TTS not loaded. Call load() first.")

        import numpy as np

        word_count = len(text.split())
        logger.info("MOSS-TTS synthesizing", extra={
            "voice_id": self._voice_id,
            "words": word_count,
            "device": self._device,
        })

        conversation = [
            self._processor.build_user_message(
                text=text,
                reference=[str(self._ref_audio)],
            )
        ]

        batch = self._processor([conversation], mode="generation")
        input_ids = batch["input_ids"].to(self._device)
        attention_mask = batch["attention_mask"].to(self._device)

        with self._torch.no_grad():
            outputs = self._model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                max_new_tokens=self._max_new_tokens,
            )

        decoded = list(self._processor.decode(outputs))
        if not decoded or not decoded[0].audio_codes_list:
            raise RuntimeError("MOSS-TTS returned no audio output")

        audio = decoded[0].audio_codes_list[0]
        sample_rate = self._processor.model_config.sampling_rate

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Try torchaudio first, fall back to soundfile
        try:
            import torchaudio
            torchaudio.save(output_path, audio.unsqueeze(0), sample_rate)
        except (ImportError, RuntimeError):
            import soundfile as sf
            sf.write(output_path, audio.cpu().numpy(), sample_rate)

        duration = len(audio) / sample_rate if sample_rate else 0
        logger.info("MOSS-TTS audio generated", extra={
            "voice_id": self._voice_id,
            "duration_sec": round(duration, 2),
            "sample_rate": sample_rate,
        })

    def unload(self) -> None:
        """Release model weights and free memory."""
        self._model = None
        self._processor = None
        if self._torch is not None:
            try:
                if self._device == "mps":
                    self._torch.mps.empty_cache()
                elif self._device.startswith("cuda"):
                    self._torch.cuda.empty_cache()
            except Exception:
                pass
        self._voice_id = None
        self._ref_audio = None
        logger.info("MOSS-TTS unloaded")
