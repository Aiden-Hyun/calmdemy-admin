"""Step 4 -- Post-process audio: normalize loudness and encode to MP3.

Architectural Role:
    Takes the raw WAV output from TTS synthesis and produces a
    distribution-ready MP3.  Two DSP operations happen via ffmpeg:

    1. **Loudness normalization** -- targets -16 LUFS (Loudness Units Full
       Scale), the broadcast standard for spoken-word content.  This ensures
       every piece of Calmdemy audio plays at a consistent volume regardless
       of which TTS model or voice produced it.
    2. **MP3 encoding** -- 192 kbps / 44.1 kHz / mono via libmp3lame.
       This balances quality and file size for mobile streaming.

    After encoding, the original WAV is deleted to conserve disk space on
    the worker VM.

Key Dependencies:
    - ffmpeg binary (system-installed or ``FFMPEG_BIN`` env override)

Consumed By:
    - factory_v2 pipeline step ``post_process_audio``
"""

import os
import subprocess
import shutil
import json

from observability import get_logger

logger = get_logger(__name__)

def _get_loudness(wav_path: str) -> float | None:
    """Measure integrated loudness in LUFS using ffmpeg's ``loudnorm`` filter.

    The ``loudnorm`` filter in "print_format=json" mode writes a JSON blob
    to stderr containing measurement results.  We parse the last JSON object
    in stderr (ffmpeg may print other diagnostics before it) and extract the
    ``input_i`` field -- the integrated loudness in LUFS.

    Returns:
        Integrated loudness in LUFS, or None if measurement failed.
    """
    try:
        ffmpeg_bin = _resolve_ffmpeg_bin()
        result = subprocess.run(
            [
                ffmpeg_bin, "-i", wav_path,
                "-af", "loudnorm=print_format=json",
                # "-f null -" discards the output; we only want the measurement
                "-f", "null", "-"
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        # The loudnorm JSON is the *last* JSON object in stderr
        output = result.stderr
        json_start = output.rfind('{')
        json_end = output.rfind('}') + 1
        if json_start >= 0 and json_end > json_start:
            data = json.loads(output[json_start:json_end])
            return float(data.get("input_i", -99))
    except Exception as e:
        logger.warning("Loudness measurement failed", extra={"error": str(e)})
    return None


def post_process_audio(wav_path: str) -> str:
    """Normalize audio to -16 LUFS and encode as 192 kbps MP3.

    The normalization is skipped when the measured loudness is already within
    a 3 LUFS tolerance of the target.  This avoids unnecessary re-encoding
    artifacts on audio that is already well-leveled.

    ``loudnorm`` parameters:
        - ``I=-16``   -- target integrated loudness
        - ``LRA=11``  -- loudness range (dynamic range target)
        - ``TP=-1.5`` -- true-peak ceiling (prevents clipping)

    Args:
        wav_path: Absolute path to the input WAV file.

    Returns:
        Absolute path to the output MP3 file.
    """
    logger.info("Post-processing audio")

    mp3_path = wav_path.replace(".wav", ".mp3")

    # Measure current loudness to decide if normalization is needed
    current_lufs = _get_loudness(wav_path)
    target_lufs = -16.0
    tolerance = 3.0  # LUFS -- small enough to catch quiet/loud outliers

    needs_normalize = (
        current_lufs is None
        or abs(current_lufs - target_lufs) > tolerance
    )

    if needs_normalize:
        logger.info(
            "Normalizing loudness",
            extra={"current_lufs": current_lufs, "target_lufs": target_lufs},
        )
        audio_filter = (
            f"loudnorm=I={target_lufs}:LRA=11:TP=-1.5"
        )
    else:
        logger.info(
            "Loudness OK, skipping normalize",
            extra={"current_lufs": round(current_lufs, 1)},
        )
        audio_filter = None

    # Build the ffmpeg command: optional loudnorm filter + MP3 encoding
    ffmpeg_bin = _resolve_ffmpeg_bin()
    cmd = [ffmpeg_bin, "-y", "-i", wav_path]
    if audio_filter:
        cmd.extend(["-af", audio_filter])
    cmd.extend([
        "-codec:a", "libmp3lame",
        "-b:a", "192k",       # Constant bitrate -- good balance for speech
        "-ar", "44100",        # Upsample to CD-quality sample rate
        "-ac", "1",            # Mono -- narration does not need stereo
        mp3_path,
    ])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg encoding failed: {result.stderr[-500:]}")

    if not os.path.isfile(mp3_path):
        raise RuntimeError(f"MP3 file not created: {mp3_path}")

    size_mb = os.path.getsize(mp3_path) / (1024 * 1024)
    logger.info("MP3 encoded", extra={"size_mb": round(size_mb, 1)})

    # Clean up the (large) WAV to save disk space on the worker VM
    try:
        os.remove(wav_path)
    except OSError:
        pass

    return mp3_path


def _resolve_ffmpeg_bin() -> str:
    """Find the ffmpeg binary, checking (in order):

    1. ``FFMPEG_BIN`` environment variable (explicit override).
    2. System PATH via ``shutil.which``.
    3. Common Homebrew install locations on macOS.

    Raises:
        RuntimeError: If ffmpeg cannot be found anywhere.
    """
    env_override = os.environ.get("FFMPEG_BIN", "").strip()
    if env_override:
        return env_override

    found = shutil.which("ffmpeg")
    if found:
        return found

    # Homebrew on Apple Silicon vs. Intel Mac
    for path in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path

    raise RuntimeError(
        "ffmpeg not found. Install it (e.g., `brew install ffmpeg`) or set FFMPEG_BIN."
    )
