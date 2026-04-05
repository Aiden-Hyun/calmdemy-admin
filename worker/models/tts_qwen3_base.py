"""Qwen3 Base TTS adapter using local voice-clone references."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import soundfile as sf

from .tts_base import TTSBase
from observability import get_logger

logger = get_logger(__name__)

_DEFAULT_MODEL_DIR_NAMES = (
    "Qwen3-TTS-12Hz-0.6B-Base",
    "qwen3-tts-12hz-0.6b-base",
    "qwen3-base",
)
_DEFAULT_VOICE_ID = "declutter_the_mind_7s"


def _looks_like_model_dir(path: Path) -> bool:
    return (
        path.is_dir()
        and (path / "config.json").is_file()
        and (path / "model.safetensors").is_file()
    )


def _resolve_model_dir(model_root: str) -> Path:
    candidates: list[Path] = []

    env_override = os.getenv("QWEN_TTS_MODEL_DIR", "").strip()
    if env_override:
        candidates.append(Path(env_override).expanduser())

    root = Path(model_root).expanduser()
    candidates.append(root)
    for name in _DEFAULT_MODEL_DIR_NAMES:
        candidates.append(root / name)

    for candidate in candidates:
        if _looks_like_model_dir(candidate):
            return candidate

    searched = ", ".join(str(candidate) for candidate in candidates)
    raise RuntimeError(
        "Qwen3 Base model directory not found. "
        f"Searched: {searched}. "
        "Set QWEN_TTS_MODEL_DIR or place the model under MODEL_DIR."
    )


def _sample_voice_dirs(model_dir: Path) -> list[Path]:
    candidates: list[Path] = []

    worker_dir = Path(__file__).resolve().parent.parent
    workspace_dir = worker_dir.parent
    candidates.extend(
        [
            workspace_dir / "sample_voices",
            worker_dir / "sample_voices",
            model_dir.parent / "sample_voices",
        ]
    )

    env_override = os.getenv("QWEN_TTS_SAMPLE_VOICES_DIR", "").strip()
    if env_override:
        candidates.append(Path(env_override).expanduser())

    deduped: list[Path] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _resolve_reference_pair(voice_id: str, model_dir: Path) -> tuple[Path, str | None]:
    base_name = (voice_id or "").strip() or os.getenv("QWEN_TTS_DEFAULT_VOICE_ID", _DEFAULT_VOICE_ID)

    voice_dirs = _sample_voice_dirs(model_dir)
    audio_suffixes = (".wav", ".mp3", ".flac", ".m4a")

    for voice_dir in voice_dirs:
        for suffix in audio_suffixes:
            audio_path = voice_dir / f"{base_name}{suffix}"
            if not audio_path.is_file():
                continue

            transcript_candidates = (
                voice_dir / f"{base_name}_script.txt",
                voice_dir / f"{base_name}.txt",
            )
            for transcript_path in transcript_candidates:
                if transcript_path.is_file():
                    return audio_path, transcript_path.read_text(encoding="utf-8").strip()
            return audio_path, None

    searched = ", ".join(str(path) for path in voice_dirs)
    raise RuntimeError(
        f"Qwen3 reference voice '{base_name}' not found in sample_voices. "
        f"Searched: {searched}"
    )


def _resolve_device() -> tuple[str, object, object]:
    try:
        import torch
    except Exception as exc:
        raise RuntimeError(
            "torch is required for Qwen3 Base TTS. Install worker dependencies first."
        ) from exc

    device_arg = os.getenv("QWEN_TTS_DEVICE", "auto").strip().lower() or "auto"

    if device_arg == "auto":
        if torch.cuda.is_available():
            return "cuda:0", torch.bfloat16, torch
        if torch.backends.mps.is_available():
            return "mps", torch.float16, torch
        return "cpu", torch.float32, torch

    if device_arg.startswith("cuda"):
        return device_arg, torch.bfloat16, torch
    if device_arg == "mps":
        return "mps", torch.float16, torch
    return "cpu", torch.float32, torch


class Qwen3BaseTTSAdapter(TTSBase):
    """Adapter for Qwen3-TTS-12Hz-0.6B-Base voice cloning."""

    def __init__(self):
        self._model = None
        self._torch = None
        self._device = "cpu"
        self._voice_id = None
        self._ref_audio = None
        self._ref_text = None
        self._language = os.getenv("QWEN_TTS_LANGUAGE", "English").strip() or "English"
        self._x_vector_only_mode = os.getenv("QWEN_TTS_X_VECTOR_ONLY_MODE", "false").lower() == "true"
        self._max_new_tokens = int(os.getenv("QWEN_TTS_MAX_NEW_TOKENS", "1200"))
        self._model_path = None

    def load(self, model_dir: str, voice_id: str) -> None:
        try:
            from qwen_tts import Qwen3TTSModel
        except Exception as exc:
            raise RuntimeError(
                "qwen-tts is required for Qwen3 Base TTS. "
                "Install dependencies in worker/requirements.qwen.txt using a dedicated Python 3.12 env."
            ) from exc

        model_path = _resolve_model_dir(model_dir)
        ref_audio, ref_text = _resolve_reference_pair(voice_id, model_path)
        device, dtype, torch = _resolve_device()

        if ref_text is None and not self._x_vector_only_mode:
            raise RuntimeError(
                f"Reference transcript missing for voice '{voice_id or _DEFAULT_VOICE_ID}'. "
                "Add '<voice>_script.txt' or enable QWEN_TTS_X_VECTOR_ONLY_MODE=true."
            )

        load_kwargs = {"dtype": dtype}
        if device.startswith("cuda"):
            load_kwargs["attn_implementation"] = "flash_attention_2"

        logger.info(
            "Loading Qwen3 Base TTS",
            extra={
                "model_path": str(model_path),
                "voice_id": voice_id or _DEFAULT_VOICE_ID,
                "ref_audio": str(ref_audio),
                "device": device,
            },
        )

        model = Qwen3TTSModel.from_pretrained(str(model_path), **load_kwargs)
        if device != "cpu":
            model.model.to(device)
            model.device = torch.device(device)

        self._model = model
        self._torch = torch
        self._device = device
        self._voice_id = voice_id or _DEFAULT_VOICE_ID
        self._ref_audio = ref_audio
        self._ref_text = ref_text
        self._model_path = model_path

    def synthesize(self, text: str, output_path: str) -> None:
        if self._model is None or self._ref_audio is None:
            raise RuntimeError("Qwen3 Base TTS model not loaded. Call load() first.")

        word_count = len(text.split())
        logger.info(
            "Qwen3 Base TTS synthesizing",
            extra={
                "voice_id": self._voice_id,
                "words": word_count,
                "device": self._device,
            },
        )

        wavs, sample_rate = self._model.generate_voice_clone(
            text=text,
            language=self._language,
            ref_audio=str(self._ref_audio),
            ref_text=self._ref_text,
            x_vector_only_mode=self._x_vector_only_mode,
            max_new_tokens=self._max_new_tokens,
        )

        wav = np.asarray(wavs[0], dtype=np.float32)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        sf.write(output_path, wav, sample_rate)

        duration = len(wav) / sample_rate if sample_rate else 0
        logger.info(
            "Qwen3 Base TTS audio generated",
            extra={
                "voice_id": self._voice_id,
                "duration_sec": duration,
                "sample_rate": sample_rate,
            },
        )

    def unload(self) -> None:
        self._model = None
        if self._torch is not None and self._device.startswith("cuda"):
            try:
                self._torch.cuda.empty_cache()
            except Exception:
                pass
        if self._torch is not None and self._device == "mps":
            try:
                self._torch.mps.empty_cache()
            except Exception:
                pass
        self._torch = None
        self._device = "cpu"
        self._voice_id = None
        self._ref_audio = None
        self._ref_text = None
        self._model_path = None
