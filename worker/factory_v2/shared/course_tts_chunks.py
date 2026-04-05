"""Utilities for splitting long course scripts into chunk-sized TTS work units."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import wave
from pathlib import Path

CHUNK_TARGET_WORDS = max(40, int(os.getenv("COURSE_TTS_CHUNK_TARGET_WORDS", "180")))
CHUNK_MAX_WORDS = max(CHUNK_TARGET_WORDS, int(os.getenv("COURSE_TTS_CHUNK_MAX_WORDS", "220")))
CHUNK_MIN_WORDS = max(20, min(CHUNK_TARGET_WORDS, int(os.getenv("COURSE_TTS_CHUNK_MIN_WORDS", "80"))))

_PAUSE_PATTERN = re.compile(r"\[PAUSE (\d+)s\]")
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")
_CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:])\s+")


def _word_count(text: str) -> int:
    return len(text.split())


def _split_on_pauses(script: str) -> list[dict]:
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
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return []
    if _word_count(cleaned) <= max_words:
        return [cleaned]

    pieces = [piece.strip() for piece in _SENTENCE_BOUNDARY.split(cleaned) if piece.strip()]
    if len(pieces) == 1:
        pieces = [piece.strip() for piece in _CLAUSE_BOUNDARY.split(cleaned) if piece.strip()]

    if len(pieces) == 1:
        words = cleaned.split()
        return [" ".join(words[index:index + max_words]) for index in range(0, len(words), max_words)]

    result: list[str] = []
    buffer: list[str] = []
    buffer_words = 0

    for piece in pieces:
        piece_words = _word_count(piece)
        if piece_words > max_words:
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
    """Split a session script into retry-friendly chunks while preserving pause markers."""
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
    root = Path(tempfile.gettempdir()) / "calmdemy_course_tts" / str(run_id).strip() / str(session_code).strip()
    root.mkdir(parents=True, exist_ok=True)
    return root


def chunk_wav_path(run_id: str, session_code: str, chunk_index: int) -> Path:
    return session_temp_dir(run_id, session_code) / f"chunk_{int(chunk_index) + 1:02d}.wav"


def assembled_wav_path(run_id: str, session_code: str) -> Path:
    return session_temp_dir(run_id, session_code) / "session_full.wav"


def cleanup_session_temp_dir(run_id: str, session_code: str) -> None:
    shutil.rmtree(session_temp_dir(run_id, session_code), ignore_errors=True)


def concatenate_wavs(wav_paths: list[str], output_path: str) -> None:
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
