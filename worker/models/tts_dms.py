"""Kyutai DMS TTS adapter — PyTorch implementation via moshi."""

import os

import numpy as np
import torch
import sphn

from .tts_base import TTSBase
from observability import get_logger

logger = get_logger(__name__)


class DMSTTSAdapter(TTSBase):
    """Adapter for Kyutai DMS TTS (kyutai-tts-1.6b-en_fr)."""

    def __init__(self):
        self._tts_model = None
        self._voice_id = None
        self._voice_path = None
        self._device = None
        self._cfg_coef = 2.0

    def load(self, model_dir: str, voice_id: str) -> None:
        """Load Kyutai DMS TTS model and voice embedding."""
        try:
            from moshi.models.loaders import CheckpointInfo
            from moshi.models.tts import (
                TTSModel,
                DEFAULT_DSM_TTS_REPO,
                DEFAULT_DSM_TTS_VOICE_REPO,
            )
        except Exception as e:
            raise RuntimeError(
                "moshi is required for Kyutai DMS TTS. "
                "Install dependencies in worker/requirements.txt."
            ) from e

        repo = os.getenv("DMS_TTS_REPO", DEFAULT_DSM_TTS_REPO)
        voice_repo = os.getenv("DMS_TTS_VOICE_REPO", DEFAULT_DSM_TTS_VOICE_REPO)
        default_voice = os.getenv(
            "DMS_DEFAULT_VOICE_ID",
            "expresso/ex03-ex01_happy_001_channel1_334s.wav",
        )

        self._voice_id = voice_id or default_voice

        n_q = int(os.getenv("DMS_N_Q", "32"))
        temp = float(os.getenv("DMS_TEMP", "0.6"))
        self._cfg_coef = float(os.getenv("DMS_CFG_COEF", "2.0"))

        device = os.getenv("DMS_DEVICE", "").strip()
        if not device:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        self._device = device

        logger.info("DMS loading model", extra={"repo": repo, "device": device})
        checkpoint_info = CheckpointInfo.from_hf_repo(repo)
        self._tts_model = TTSModel.from_checkpoint_info(
            checkpoint_info,
            n_q=n_q,
            temp=temp,
            device=device,
        )

        # Resolve voice embedding path
        if self._voice_id.endswith(".safetensors"):
            self._voice_path = self._voice_id
        else:
            try:
                self._voice_path = self._tts_model.get_voice_path(
                    self._voice_id, repo=voice_repo
                )
            except TypeError:
                # Older moshi versions don't accept repo kwarg
                self._voice_path = self._tts_model.get_voice_path(self._voice_id)

        logger.info("DMS voice loaded", extra={"voice_id": self._voice_id})

    def synthesize(self, text: str, output_path: str) -> None:
        """Convert text to audio and save as WAV file."""
        if self._tts_model is None:
            raise RuntimeError("DMS TTS model not loaded. Call load() first.")

        word_count = len(text.split())
        logger.info("DMS synthesizing", extra={"words": word_count, "voice_id": self._voice_id})

        entries = self._tts_model.prepare_script([text], padding_between=1)
        condition_attributes = self._tts_model.make_condition_attributes(
            [self._voice_path],
            cfg_coef=self._cfg_coef,
        )

        result = self._tts_model.generate(
            [entries],
            [condition_attributes],
            on_frame=None,
        )

        with self._tts_model.mimi.streaming(1), torch.no_grad():
            pcms = []
            for frame in result.frames[self._tts_model.delay_steps:]:
                pcm = self._tts_model.mimi.decode(frame[:, 1:, :]).cpu().numpy()
                pcms.append(np.clip(pcm[0, 0], -1, 1))

        pcm = np.concatenate(pcms, axis=-1) if pcms else np.zeros((1,), dtype=np.float32)
        sphn.write_wav(output_path, pcm, self._tts_model.mimi.sample_rate)

        duration = pcm.shape[-1] / self._tts_model.mimi.sample_rate
        logger.info("DMS audio generated", extra={"duration_sec": duration, "voice_id": self._voice_id})

    def unload(self) -> None:
        self._tts_model = None
        self._voice_id = None
        self._voice_path = None
        self._device = None
