"""
Step 3: Convert formatted script text to audio using TTS.

Handles [PAUSE Xs] markers by splitting the script into segments,
synthesizing each segment, and concatenating with silence gaps.
"""

import os
import re
import tempfile
import wave
import shutil

from models.registry import get_tts
from factory_v2.shared.course_tts_segment_cache import (
    is_segment_cache_enabled,
    persist_segment_audio,
    restore_segment_audio,
)
import config
from observability import get_logger

logger = get_logger(__name__)

# Cache loaded TTS model across jobs
_cached_tts = None
_cached_tts_id = None
_cached_voice_id = None

DEFAULT_SAMPLE_RATE = 22050
DEFAULT_CHANNELS = 1
DEFAULT_SAMPLE_WIDTH = 2  # 16-bit


def _generate_silence(
    duration_sec: float,
    output_path: str,
    sample_rate: int,
    channels: int,
    sample_width: int,
):
    """Generate a silent WAV file of the specified duration."""
    num_frames = int(round(sample_rate * duration_sec))
    frame_bytes = channels * sample_width
    silence = b'\x00' * (num_frames * frame_bytes)
    with wave.open(output_path, 'w') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(silence)


def _split_on_pauses(script: str) -> list[dict]:
    """Split script into segments and pause markers."""
    parts = []
    pattern = r'\[PAUSE (\d+)s\]'
    last_end = 0

    for match in re.finditer(pattern, script):
        # Text before the pause
        text = script[last_end:match.start()].strip()
        if text:
            parts.append({"type": "text", "content": text})
        # The pause itself
        parts.append({"type": "pause", "seconds": int(match.group(1))})
        last_end = match.end()

    # Remaining text after last pause
    text = script[last_end:].strip()
    if text:
        parts.append({"type": "text", "content": text})

    return parts


def _concatenate_wavs(wav_paths: list[str], output_path: str):
    """Concatenate multiple WAV files into one."""
    if not wav_paths:
        raise ValueError("No WAV files to concatenate")

    with wave.open(wav_paths[0], 'r') as first:
        params = first.getparams()
        expected = (params.nchannels, params.sampwidth, params.framerate, params.comptype, params.compname)

    with wave.open(output_path, 'w') as out:
        out.setparams(params)
        for path in wav_paths:
            with wave.open(path, 'r') as wf:
                wf_params = wf.getparams()
                current = (
                    wf_params.nchannels,
                    wf_params.sampwidth,
                    wf_params.framerate,
                    wf_params.comptype,
                    wf_params.compname,
                )
                if current != expected:
                    raise ValueError(
                        f"WAV params mismatch during concat: {path} has {wf_params}, "
                        f"expected {params}"
                    )
                out.writeframes(wf.readframes(wf.getnframes()))


def _read_wav_params(wav_path: str) -> tuple[int, int, int]:
    """Return (channels, sample_width, sample_rate) from a WAV file."""
    with wave.open(wav_path, 'r') as wf:
        return wf.getnchannels(), wf.getsampwidth(), wf.getframerate()


def _stash_wav_part(source_path: str, stable_path: str) -> None:
    """Copy a generated WAV part to a stable path for final concatenation."""
    os.makedirs(os.path.dirname(stable_path), exist_ok=True)
    shutil.copyfile(source_path, stable_path)


def convert_to_audio(script: str, job_data: dict) -> str:
    """Convert script to WAV audio, handling pause markers."""
    global _cached_tts, _cached_tts_id, _cached_voice_id

    tts_model_id = job_data.get("ttsModel", "dms")
    voice_id = job_data.get("ttsVoice", "expresso/ex03-ex01_happy_001_channel1_334s.wav")

    logger.info(
        "Converting to audio",
        extra={"tts_model": tts_model_id, "voice_id": voice_id},
    )

    # Load TTS model (reuse if same)
    if (_cached_tts is None
            or _cached_tts_id != tts_model_id
            or _cached_voice_id != voice_id):
        if _cached_tts is not None:
            _cached_tts.unload()
        _cached_tts = get_tts(tts_model_id)
        _cached_tts.load(config.MODEL_DIR, voice_id)
        _cached_tts_id = tts_model_id
        _cached_voice_id = voice_id

    # Split script on pause markers
    segments = _split_on_pauses(script)
    cache_enabled = is_segment_cache_enabled(job_data)
    logger.info(
        "Script split into segments",
        extra={"segment_count": len(segments), "segment_cache_enabled": cache_enabled},
    )

    # Synthesize each segment
    tmp_dir = tempfile.mkdtemp(prefix="calmdemy_tts_")
    parts_dir = os.path.join(tmp_dir, "parts")
    stable_dir = os.path.join(tmp_dir, "stable")
    os.makedirs(parts_dir, exist_ok=True)
    os.makedirs(stable_dir, exist_ok=True)
    wav_parts = []
    tts_params = None  # (channels, sample_width, sample_rate)
    pending_silences: list[tuple[float, str, str]] = []
    cache_hits = 0
    synthesized_segments = 0

    try:
        for i, seg in enumerate(segments):
            part_path = os.path.join(parts_dir, f"part_{i:04d}.wav")
            stable_part_path = os.path.join(stable_dir, f"part_{i:04d}.wav")

            if seg["type"] == "pause":
                if tts_params:
                    channels, sample_width, sample_rate = tts_params
                    _generate_silence(
                        seg["seconds"],
                        part_path,
                        sample_rate=sample_rate,
                        channels=channels,
                        sample_width=sample_width,
                    )
                    _stash_wav_part(part_path, stable_part_path)
                else:
                    # Defer silence generation until we know TTS WAV params
                    pending_silences.append((seg["seconds"], part_path, stable_part_path))
            else:
                segment_text = str(seg["content"] or "").strip()
                restored = cache_enabled and restore_segment_audio(job_data, segment_text, part_path)
                if restored:
                    cache_hits += 1
                else:
                    _cached_tts.synthesize(segment_text, part_path)
                    synthesized_segments += 1
                    if cache_enabled:
                        persist_segment_audio(job_data, segment_text, part_path)
                if tts_params is None:
                    tts_params = _read_wav_params(part_path)
                    # Backfill any leading pauses now that we know WAV params
                    channels, sample_width, sample_rate = tts_params
                    for seconds, pause_path, pause_stable_path in pending_silences:
                        _generate_silence(
                            seconds,
                            pause_path,
                            sample_rate=sample_rate,
                            channels=channels,
                            sample_width=sample_width,
                        )
                        _stash_wav_part(pause_path, pause_stable_path)
                    pending_silences = []
                _stash_wav_part(part_path, stable_part_path)

            wav_parts.append(stable_part_path)

        if pending_silences:
            # Script had only pauses; fall back to defaults
            logger.warning("No audio segments found; using default WAV params for silence.")
            for seconds, pause_path, pause_stable_path in pending_silences:
                _generate_silence(
                    seconds,
                    pause_path,
                    sample_rate=DEFAULT_SAMPLE_RATE,
                    channels=DEFAULT_CHANNELS,
                    sample_width=DEFAULT_SAMPLE_WIDTH,
                )
                _stash_wav_part(pause_path, pause_stable_path)

        # Concatenate all parts
        output_path = os.path.join(tmp_dir, "full_output.wav")
        _concatenate_wavs(wav_parts, output_path)

        # Get duration
        with wave.open(output_path, 'r') as wf:
            duration = wf.getnframes() / wf.getframerate()
        logger.info(
            "Full audio generated",
            extra={
                "duration_sec": round(duration, 1),
                "segment_cache_hits": cache_hits,
                "synthesized_segments": synthesized_segments,
            },
        )

        return output_path

    except Exception:
        # Clean up on error
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
