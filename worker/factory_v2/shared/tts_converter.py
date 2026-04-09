"""Step 3 -- Convert formatted script text to audio using TTS.

Architectural Role:
    Turns a cleaned narration script into a single WAV file.  The script
    may contain ``[PAUSE Xs]`` markers (inserted by the LLM) that represent
    intentional silence gaps.  This module:

    1. Splits the script on pause markers into text segments and silence gaps.
    2. For each text segment, either restores a cached WAV from cloud storage
       (segment cache) or synthesizes it via the TTS adapter.
    3. Generates silence WAV files of the requested duration.
    4. Concatenates all parts (text + silence) into one continuous WAV.

    The segment-cache layer (course_tts_segment_cache.py) avoids
    re-synthesizing unchanged segments when a course is regenerated --
    a significant time saver for long courses with minor edits.

Key Dependencies:
    - models.registry.get_tts       -- adapter factory for TTS backends
    - course_tts_segment_cache      -- cloud-backed per-segment audio cache
    - config.MODEL_DIR              -- local model weights directory

Consumed By:
    - factory_v2 pipeline step ``synthesize_audio``
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

# ---------------------------------------------------------------------------
# TTS model caching -- keeps the model in memory across sequential jobs so
# we avoid the expensive load/unload cycle when the model+voice pair matches.
# ---------------------------------------------------------------------------
_cached_tts = None
_cached_tts_id = None
_cached_voice_id = None

# Fallback WAV parameters used when a script contains only pauses (no text
# segments to infer the parameters from).  22050 Hz / 16-bit / mono is the
# standard "telephone quality" format most TTS models produce.
DEFAULT_SAMPLE_RATE = 22050
DEFAULT_CHANNELS = 1
DEFAULT_SAMPLE_WIDTH = 2  # 16-bit PCM (2 bytes per sample)


def _generate_silence(
    duration_sec: float,
    output_path: str,
    sample_rate: int,
    channels: int,
    sample_width: int,
):
    """Generate a silent WAV file of the specified duration.

    Silence is simply a buffer of zero-valued bytes.  The total byte count is:
        ``sample_rate * duration_sec * channels * sample_width``.
    """
    num_frames = int(round(sample_rate * duration_sec))
    # Each frame contains one sample per channel, each sample is sample_width bytes
    frame_bytes = channels * sample_width
    silence = b'\x00' * (num_frames * frame_bytes)
    with wave.open(output_path, 'w') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(silence)


def _split_on_pauses(script: str) -> list[dict]:
    """Split script into an ordered list of text segments and pause markers.

    Example input::

        "Welcome to this session. [PAUSE 3s] Let us begin."

    Returns::

        [
            {"type": "text",  "content": "Welcome to this session."},
            {"type": "pause", "seconds": 3},
            {"type": "text",  "content": "Let us begin."},
        ]
    """
    parts = []
    pattern = r'\[PAUSE (\d+)s\]'
    last_end = 0

    for match in re.finditer(pattern, script):
        # Capture any text that precedes this pause marker
        text = script[last_end:match.start()].strip()
        if text:
            parts.append({"type": "text", "content": text})
        # Record the pause duration
        parts.append({"type": "pause", "seconds": int(match.group(1))})
        last_end = match.end()

    # Remaining text after the last pause marker (or the entire script
    # if there are no pauses at all)
    text = script[last_end:].strip()
    if text:
        parts.append({"type": "text", "content": text})

    return parts


def _concatenate_wavs(wav_paths: list[str], output_path: str):
    """Concatenate multiple WAV files into one continuous file.

    All input WAVs must share identical audio parameters (channels, sample
    width, frame rate, compression).  A mismatch raises ``ValueError`` so
    that we never silently produce garbled audio.

    Raises:
        ValueError: If the list is empty or WAV parameters differ.
    """
    if not wav_paths:
        raise ValueError("No WAV files to concatenate")

    # Read the reference parameters from the first file
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
                # Append raw PCM frames directly -- no re-encoding needed
                out.writeframes(wf.readframes(wf.getnframes()))


def _read_wav_params(wav_path: str) -> tuple[int, int, int]:
    """Return ``(channels, sample_width, sample_rate)`` from a WAV file header."""
    with wave.open(wav_path, 'r') as wf:
        return wf.getnchannels(), wf.getsampwidth(), wf.getframerate()


def _stash_wav_part(source_path: str, stable_path: str) -> None:
    """Copy a generated WAV part to a stable path for final concatenation.

    We write TTS output to a scratch directory and then copy to a "stable"
    directory so that partial failures don't leave half-written files in the
    final concat list.
    """
    os.makedirs(os.path.dirname(stable_path), exist_ok=True)
    shutil.copyfile(source_path, stable_path)


def convert_to_audio(script: str, job_data: dict) -> str:
    """Convert a narration script to a single WAV audio file.

    High-level flow:
        1. Load (or reuse) the TTS model for the requested model + voice.
        2. Split the script on ``[PAUSE Xs]`` markers into text and silence.
        3. For each text segment, try the segment cache first; synthesize on miss.
        4. For each pause, generate a silent WAV with matching audio params.
        5. Concatenate all parts into ``full_output.wav``.

    A chicken-and-egg problem arises with leading pauses: we need the WAV
    parameters (sample rate, channels, bit depth) from a synthesized segment
    to generate silence, but the first segment(s) might be pauses.  The
    ``pending_silences`` list defers silence generation until the first text
    segment reveals the correct WAV parameters.

    Args:
        script: The formatted narration text (with ``[PAUSE Xs]`` markers).
        job_data: Full Firestore job document.

    Returns:
        Absolute path to the concatenated WAV file.
    """
    global _cached_tts, _cached_tts_id, _cached_voice_id

    tts_model_id = job_data.get("ttsModel", "qwen3-base")
    voice_id = job_data.get("ttsVoice", "expresso/ex03-ex01_happy_001_channel1_334s.wav")

    logger.info(
        "Converting to audio",
        extra={"tts_model": tts_model_id, "voice_id": voice_id},
    )

    # Hot-swap the TTS model if the requested model or voice changed
    if (_cached_tts is None
            or _cached_tts_id != tts_model_id
            or _cached_voice_id != voice_id):
        if _cached_tts is not None:
            _cached_tts.unload()
        _cached_tts = get_tts(tts_model_id)
        _cached_tts.load(config.MODEL_DIR, voice_id)
        _cached_tts_id = tts_model_id
        _cached_voice_id = voice_id

    # Split script on pause markers into an ordered list of segments
    segments = _split_on_pauses(script)
    cache_enabled = is_segment_cache_enabled(job_data)
    logger.info(
        "Script split into segments",
        extra={"segment_count": len(segments), "segment_cache_enabled": cache_enabled},
    )

    # Synthesize each segment into individual WAV files, then concatenate.
    # Two directories: "parts" for raw TTS output, "stable" for verified copies.
    tmp_dir = tempfile.mkdtemp(prefix="calmdemy_tts_")
    parts_dir = os.path.join(tmp_dir, "parts")
    stable_dir = os.path.join(tmp_dir, "stable")
    os.makedirs(parts_dir, exist_ok=True)
    os.makedirs(stable_dir, exist_ok=True)
    wav_parts = []  # Ordered list of stable WAV paths for final concatenation
    tts_params = None  # Discovered (channels, sample_width, sample_rate) from first text segment
    pending_silences: list[tuple[float, str, str]] = []  # Leading pauses waiting for WAV params
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
