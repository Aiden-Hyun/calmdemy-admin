"""Utilities for splitting long course scripts into chunk-sized TTS work units.

Architectural Role:
    Course sessions can contain thousands of words.  Synthesizing the entire
    session as a single TTS call is slow and non-resumable -- if it fails at
    80% we lose everything.  This module splits a session script into
    smaller *chunks* (target ~180 words each) that can be:

    - Enqueued as independent queue items (parallel TTS across workers).
    - Individually retried on failure without re-synthesizing the whole session.
    - Cached per-segment so unchanged text is not re-synthesized on edits.

    Splitting respects natural language boundaries (sentence > clause > word)
    and preserves ``[PAUSE Xs]`` markers at chunk boundaries.

    The module also provides temp-directory and WAV-path helpers so that
    every step in the chunked TTS pipeline reads/writes to predictable
    filesystem locations keyed by ``(run_id, session_code, chunk_index)``.

Key Dependencies:
    - wave (stdlib) -- WAV concatenation for reassembly

Consumed By:
    - factory_v2 course TTS orchestrator (chunk splitting + reassembly)
    - course_tts_progress (chunk word counts for progress calculation)
    - factory_v2 single-content chunked TTS pipeline
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import wave
from pathlib import Path

# Chunk-size thresholds (configurable via env vars for tuning)
CHUNK_TARGET_WORDS = max(40, int(os.getenv("COURSE_TTS_CHUNK_TARGET_WORDS", "180")))
CHUNK_MAX_WORDS = max(CHUNK_TARGET_WORDS, int(os.getenv("COURSE_TTS_CHUNK_MAX_WORDS", "220")))
CHUNK_MIN_WORDS = max(20, min(CHUNK_TARGET_WORDS, int(os.getenv("COURSE_TTS_CHUNK_MIN_WORDS", "80"))))

_PAUSE_PATTERN = re.compile(r"\[PAUSE (\d+)s\]")
# Sentence boundary: period/exclamation/question followed by space and uppercase
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")
# Clause boundary: comma/semicolon/colon followed by space
_CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:])\s+")


def _word_count(text: str) -> int:
    """Count whitespace-delimited words in *text*."""
    return len(text.split())


def _split_on_pauses(script: str) -> list[dict]:
    """Split script on ``[PAUSE Xs]`` markers (same logic as tts_converter)."""
    parts: list[dict] = []
    last_end = 0

    for match in _PAUSE_PATTERN.finditer(script):
        text = script[last_end:match.start()].strip()
        if text:
            parts.append({"type": "text", "content": text})
        parts.append({"type": "pause", "seconds": int(match.group(1))})
        last_end = match.end()

    text = script[last_end:].strip()
    if text:
        parts.append({"type": "text", "content": text})

    return parts


def _split_text_unit(text: str, max_words: int) -> list[str]:
    """Recursively split a text block into pieces of at most *max_words*.

    Split hierarchy (preferred to least preferred):
        1. Sentence boundaries (``.``, ``!``, ``?`` followed by uppercase).
        2. Clause boundaries (``,``, ``;``, ``:``).
        3. Hard word-count split (last resort).

    The greedy-buffer algorithm packs consecutive sentences/clauses into
    one piece until adding the next would exceed *max_words*, then flushes.
    """
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return []
    if _word_count(cleaned) <= max_words:
        return [cleaned]

    # Try splitting on sentence boundaries first
    pieces = [piece.strip() for piece in _SENTENCE_BOUNDARY.split(cleaned) if piece.strip()]
    if len(pieces) == 1:
        # Fall back to clause boundaries
        pieces = [piece.strip() for piece in _CLAUSE_BOUNDARY.split(cleaned) if piece.strip()]

    if len(pieces) == 1:
        # Last resort: hard split on word count
        words = cleaned.split()
        return [" ".join(words[index:index + max_words]) for index in range(0, len(words), max_words)]

    # Greedy packing: combine consecutive pieces until the buffer is full
    result: list[str] = []
    buffer: list[str] = []
    buffer_words = 0

    for piece in pieces:
        piece_words = _word_count(piece)
        if piece_words > max_words:
            # Recursively split oversized pieces
            if buffer:
                result.append(" ".join(buffer).strip())
                buffer = []
                buffer_words = 0
            result.extend(_split_text_unit(piece, max_words))
            continue

        if buffer and buffer_words + piece_words > max_words:
            result.append(" ".join(buffer).strip())
            buffer = [piece]
            buffer_words = piece_words
            continue

        buffer.append(piece)
        buffer_words += piece_words

    if buffer:
        result.append(" ".join(buffer).strip())

    return [piece for piece in result if piece]


def split_course_tts_chunks(script: str) -> list[str]:
    """Split a session script into retry-friendly chunks while preserving pause markers.

    Each returned chunk is a self-contained text fragment (possibly with
    embedded ``[PAUSE Xs]`` markers) sized between CHUNK_MIN_WORDS and
    CHUNK_MAX_WORDS.  If the last chunk is very short it is merged into the
    previous one to avoid producing a tiny trailing audio file.

    Returns:
        Ordered list of chunk strings ready for individual TTS synthesis.
    """
    units: list[dict] = []
    for segment in _split_on_pauses(script):
        if segment["type"] == "pause":
            units.append(segment)
            continue
        for piece in _split_text_unit(str(segment.get("content") or ""), CHUNK_MAX_WORDS):
            units.append({"type": "text", "content": piece})

    if not units:
        return []

    chunks: list[list[str]] = []
    current: list[str] = []
    current_words = 0

    def flush() -> None:
        nonlocal current, current_words
        if not current:
            return
        text = " ".join(current).strip()
        if text:
            chunks.append([text])
        current = []
        current_words = 0

    for index, unit in enumerate(units):
        unit_type = str(unit.get("type") or "")
        if unit_type == "pause":
            if current:
                current.append(f"[PAUSE {int(unit['seconds'])}s]")
                has_more_text = any(next_unit.get("type") == "text" for next_unit in units[index + 1:])
                if has_more_text and current_words >= CHUNK_MIN_WORDS:
                    flush()
            continue

        content = str(unit.get("content") or "").strip()
        if not content:
            continue

        content_words = _word_count(content)
        if current and (
            current_words >= CHUNK_TARGET_WORDS
            or (current_words >= CHUNK_MIN_WORDS and current_words + content_words > CHUNK_MAX_WORDS)
        ):
            flush()

        current.append(content)
        current_words += content_words

    if current:
        flush()

    flattened = [chunk[0] for chunk in chunks if chunk and chunk[0].strip()]
    if len(flattened) >= 2 and _word_count(flattened[-1]) < CHUNK_MIN_WORDS:
        flattened[-2] = f"{flattened[-2]} {flattened[-1]}".strip()
        flattened.pop()
    return flattened


def make_chunk_shard_key(session_shard: str, chunk_index: int) -> str:
    """Build the persisted shard key format used by chunk queue items and step runs."""
    return f"{str(session_shard).strip().upper()}-P{int(chunk_index) + 1:02d}"


def parse_chunk_shard_key(shard_key: str) -> tuple[str, int] | None:
    """Parse a persisted chunk shard key back into `(session_shard, chunk_index)`."""
    match = re.match(r"^([A-Z0-9]+)-P(\d+)$", str(shard_key or "").strip().upper())
    if not match:
        return None
    return match.group(1), max(0, int(match.group(2)) - 1)


def session_temp_dir(run_id: str, session_code: str) -> Path:
    """Return (and create) the temp directory for a course session's TTS chunks."""
    root = Path(tempfile.gettempdir()) / "calmdemy_course_tts" / str(run_id).strip() / str(session_code).strip()
    root.mkdir(parents=True, exist_ok=True)
    return root


def chunk_wav_path(run_id: str, session_code: str, chunk_index: int) -> Path:
    """Return the expected WAV path for a specific course chunk."""
    return session_temp_dir(run_id, session_code) / f"chunk_{int(chunk_index) + 1:02d}.wav"


def assembled_wav_path(run_id: str, session_code: str) -> Path:
    """Return the path where the fully-assembled session WAV will be written."""
    return session_temp_dir(run_id, session_code) / "session_full.wav"


def cleanup_session_temp_dir(run_id: str, session_code: str) -> None:
    """Remove the temp directory for a course session after upload."""
    shutil.rmtree(session_temp_dir(run_id, session_code), ignore_errors=True)


# ---------------------------------------------------------------------------
# Single-content chunk helpers -- same pattern as course chunks but without
# the session_code dimension (there is only one "session").
# ---------------------------------------------------------------------------

def make_single_chunk_shard_key(chunk_index: int) -> str:
    """Build shard key for a single-content audio chunk, e.g. ``P01``."""
    return f"P{int(chunk_index) + 1:02d}"


def parse_single_chunk_shard_key(shard_key: str) -> int | None:
    """Parse a single-content chunk shard key back into a 0-based chunk index."""
    match = re.match(r"^P(\d+)$", str(shard_key or "").strip().upper())
    if not match:
        return None
    return max(0, int(match.group(1)) - 1)


def single_content_temp_dir(run_id: str) -> Path:
    """Return (and create) the temp directory for single-content TTS chunks."""
    root = Path(tempfile.gettempdir()) / "calmdemy_single_tts" / str(run_id).strip()
    root.mkdir(parents=True, exist_ok=True)
    return root


def single_chunk_wav_path(run_id: str, chunk_index: int) -> Path:
    """Return the expected WAV path for a single-content chunk."""
    return single_content_temp_dir(run_id) / f"chunk_{int(chunk_index) + 1:02d}.wav"


def single_assembled_wav_path(run_id: str) -> Path:
    """Return the path where the fully-assembled single-content WAV will be written."""
    return single_content_temp_dir(run_id) / "full_assembled.wav"


def cleanup_single_content_temp_dir(run_id: str) -> None:
    """Remove the temp directory for single-content TTS after upload."""
    shutil.rmtree(single_content_temp_dir(run_id), ignore_errors=True)


# ---------------------------------------------------------------------------
# Shared WAV utilities
# ---------------------------------------------------------------------------

def concatenate_wavs(wav_paths: list[str], output_path: str) -> None:
    """Concatenate multiple WAV files into one, validating param consistency.

    Identical to ``tts_converter._concatenate_wavs`` but extracted here so
    both the single-content and course TTS pipelines can share it.
    """
    if not wav_paths:
        raise ValueError("No WAV files to concatenate")

    with wave.open(wav_paths[0], "r") as first:
        params = first.getparams()
        expected = (
            params.nchannels,
            params.sampwidth,
            params.framerate,
            params.comptype,
            params.compname,
        )

    with wave.open(output_path, "w") as out:
        out.setparams(params)
        for path in wav_paths:
            with wave.open(path, "r") as wf:
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
                        f"WAV params mismatch during concat: {path} has {wf_params}, expected {params}"
                    )
                out.writeframes(wf.readframes(wf.getnframes()))
