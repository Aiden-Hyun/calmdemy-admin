"""Qwen3 Base TTS adapter -- local voice-clone synthesis on GPU.

Architectural Role:
    Concrete **Strategy** (``TTSBase``) that runs the Qwen3-TTS-0.6B
    model locally for voice-cloning TTS.  Unlike the Gemini TTS adapter
    (cloud API), this one loads real model weights onto a GPU (CUDA or
    MPS) and generates audio in-process.

Design Patterns:
    - **Strategy** -- interchangeable with ``GeminiTTSAdapter`` behind
      ``TTSBase``.
    - **Adapter** -- wraps the ``qwen-tts`` library's
      ``Qwen3TTSModel.generate_voice_clone()`` into our
      ``synthesize(text, output_path)`` contract.

Key Dependencies:
    - ``qwen-tts`` (must be installed in a **dedicated Python 3.12 venv**
      -- see ``worker/requirements.qwen.txt``)
    - ``torch`` (CUDA / MPS / CPU)
    - ``numpy``, ``soundfile`` for WAV writing
    - Reference voice audio + transcript in ``sample_voices/``

Consumed By:
    - ``worker.models.registry`` (via ``_qwen3_base_tts_factory``)
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import soundfile as sf

from .tts_base import TTSBase
from observability import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Module-level constants and resolution helpers
# ---------------------------------------------------------------------------
# These helpers locate model weights and voice reference files on disk.
# The resolution order supports env-var overrides, multiple directory name
# conventions, and common workspace layouts.

# Possible directory names for the Qwen3 model weights (checked in order).
_DEFAULT_MODEL_DIR_NAMES = (
    "Qwen3-TTS-12Hz-0.6B-Base",
    "qwen3-tts-12hz-0.6b-base",
    "qwen3-base",
)
_DEFAULT_VOICE_ID = "declutter_the_mind_7s"


def _looks_like_model_dir(path: Path) -> bool:
    """Return True if *path* contains the two files every HuggingFace model has."""
    return (
        path.is_dir()
        and (path / "config.json").is_file()
        and (path / "model.safetensors").is_file()
    )


def _resolve_model_dir(model_root: str) -> Path:
    """Find the Qwen3 model directory by searching several candidate paths.

    Resolution order:
        1. ``QWEN_TTS_MODEL_DIR`` env var (highest priority)
        2. *model_root* itself
        3. *model_root* / each of ``_DEFAULT_MODEL_DIR_NAMES``

    Args:
        model_root: Base directory passed from the pipeline config.

    Returns:
        Path to a valid model directory.

    Raises:
        RuntimeError: If no candidate contains model files.
    """
    candidates: list[Path] = []

    # Env var override has highest priority
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
    """Build the search path for ``sample_voices/`` directories.

    Looks in the workspace root, the worker directory, next to the model
    directory, and finally an env-var override.

    Returns:
        De-duplicated list of candidate directories (may not all exist).
    """
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

    # Preserve insertion order while removing duplicates
    deduped: list[Path] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _resolve_reference_pair(voice_id: str, model_dir: Path) -> tuple[Path, str | None]:
    """Locate a reference audio file and its optional transcript.

    Voice-cloning needs a short audio clip of the target voice.  For best
    quality, a transcript of that clip is also provided so the model knows
    what words are spoken in the reference audio.

    File layout expected in ``sample_voices/``:
        ``<voice_id>.wav``              -- reference audio
        ``<voice_id>_script.txt``       -- transcript (preferred)
        ``<voice_id>.txt``              -- transcript (fallback)

    Args:
        voice_id: Name of the voice (doubles as filename stem).
        model_dir: Used to derive additional search paths.

    Returns:
        Tuple of (audio_path, transcript_text_or_None).

    Raises:
        RuntimeError: If no audio file is found.
    """
    base_name = (voice_id or "").strip() or os.getenv("QWEN_TTS_DEFAULT_VOICE_ID", _DEFAULT_VOICE_ID)

    voice_dirs = _sample_voice_dirs(model_dir)
    audio_suffixes = (".wav", ".mp3", ".flac", ".m4a")

    for voice_dir in voice_dirs:
        for suffix in audio_suffixes:
            audio_path = voice_dir / f"{base_name}{suffix}"
            if not audio_path.is_file():
                continue

            # Look for a transcript alongside the audio file
            transcript_candidates = (
                voice_dir / f"{base_name}_script.txt",
                voice_dir / f"{base_name}.txt",
            )
            for transcript_path in transcript_candidates:
                if transcript_path.is_file():
                    return audio_path, transcript_path.read_text(encoding="utf-8").strip()
            # Audio found but no transcript -- still usable in x-vector-only mode
            return audio_path, None

    searched = ", ".join(str(path) for path in voice_dirs)
    raise RuntimeError(
        f"Qwen3 reference voice '{base_name}' not found in sample_voices. "
        f"Searched: {searched}"
    )


def _resolve_device() -> tuple[str, object, object]:
    """Detect the best available compute device and matching dtype.

    Resolution order (when ``QWEN_TTS_DEVICE=auto`` or unset):
        1. CUDA GPU  -> ``bfloat16`` (fastest, needs NVIDIA GPU)
        2. Apple MPS -> ``float16``  (Apple Silicon GPU)
        3. CPU       -> ``float32``  (fallback, very slow for TTS)

    Returns:
        Tuple of ``(device_str, torch_dtype, torch_module)``.
        The ``torch`` module is returned so callers don't need their
        own import (torch is heavy and may not be installed system-wide).
    """
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

    # Explicit device override via env var
    if device_arg.startswith("cuda"):
        return device_arg, torch.bfloat16, torch
    if device_arg == "mps":
        return "mps", torch.float16, torch
    return "cpu", torch.float32, torch


class Qwen3BaseTTSAdapter(TTSBase):
    """Local voice-cloning TTS using the Qwen3-TTS-12Hz-0.6B-Base model.

    This adapter loads real model weights onto a GPU and runs inference
    in-process.  It supports two voice-cloning modes:

    - **Full clone** (default): requires a reference audio clip *and* its
      transcript so the model can learn both timbre and prosody.
    - **X-vector only** (``QWEN_TTS_X_VECTOR_ONLY_MODE=true``): uses only
      the speaker embedding from the audio clip -- no transcript needed,
      but quality may be lower.

    Environment variables:
        ``QWEN_TTS_DEVICE``                -- ``auto`` | ``cuda:N`` | ``mps`` | ``cpu``
        ``QWEN_TTS_LANGUAGE``              -- synthesis language (default ``English``)
        ``QWEN_TTS_MAX_NEW_TOKENS``        -- max decoder tokens (default ``1200``)
        ``QWEN_TTS_X_VECTOR_ONLY_MODE``    -- ``true`` to skip transcript requirement
        ``QWEN_TTS_MODEL_DIR``             -- override model weights path
        ``QWEN_TTS_SAMPLE_VOICES_DIR``     -- override voice samples path
        ``QWEN_TTS_DEFAULT_VOICE_ID``      -- fallback voice if none specified
    """

    def __init__(self):
        self._model = None
        self._torch = None          # Cached torch module (avoids re-import)
        self._device = "cpu"
        self._voice_id = None
        self._ref_audio = None      # Path to reference audio clip
        self._ref_text = None       # Transcript of the reference audio
        self._language = os.getenv("QWEN_TTS_LANGUAGE", "English").strip() or "English"
        self._x_vector_only_mode = os.getenv("QWEN_TTS_X_VECTOR_ONLY_MODE", "false").lower() == "true"
        self._max_new_tokens = int(os.getenv("QWEN_TTS_MAX_NEW_TOKENS", "1200"))
        self._model_path = None

    def load(self, model_dir: str, voice_id: str) -> None:
        """Load Qwen3 model weights onto GPU and resolve the voice reference.

        Steps:
            1. Lazily import ``qwen_tts`` (only available in the dedicated venv)
            2. Resolve model directory + voice reference files on disk
            3. Detect best device (CUDA > MPS > CPU)
            4. Load model with appropriate dtype and attention impl
            5. Move model to device

        Args:
            model_dir: Root directory to search for model weights.
            voice_id: Stem name of the reference voice in ``sample_voices/``.
        """
        # Lazy import -- qwen_tts is only installed in the dedicated venv
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

        # Full-clone mode requires a transcript alongside the reference audio
        if ref_text is None and not self._x_vector_only_mode:
            raise RuntimeError(
                f"Reference transcript missing for voice '{voice_id or _DEFAULT_VOICE_ID}'. "
                "Add '<voice>_script.txt' or enable QWEN_TTS_X_VECTOR_ONLY_MODE=true."
            )

        load_kwargs = {"dtype": dtype}
        # Flash Attention 2 drastically speeds up generation on NVIDIA GPUs
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
            # Move the inner transformer to GPU; update the library's device attr
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
        """Generate voice-cloned speech and write it as a WAV file.

        Args:
            text: The script to synthesize.
            output_path: Destination ``.wav`` file path (directories are
                         created automatically).
        """
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

        # generate_voice_clone returns (list[ndarray], sample_rate)
        wavs, sample_rate = self._model.generate_voice_clone(
            text=text,
            language=self._language,
            ref_audio=str(self._ref_audio),
            ref_text=self._ref_text,
            x_vector_only_mode=self._x_vector_only_mode,
            max_new_tokens=self._max_new_tokens,
        )

        # Take the first (and usually only) waveform from the batch
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
        """Release model weights and free GPU memory.

        Explicitly calls ``torch.cuda.empty_cache()`` or
        ``torch.mps.empty_cache()`` to return VRAM to the OS so the
        next job (which may use a different model) has headroom.
        """
        self._model = None
        # Flush CUDA VRAM cache so memory is actually returned to the OS
        if self._torch is not None and self._device.startswith("cuda"):
            try:
                self._torch.cuda.empty_cache()
            except Exception:
                pass
        # Same for Apple Silicon MPS
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
