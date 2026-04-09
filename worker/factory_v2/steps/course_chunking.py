"""Helpers for turning one formatted course session into chunked TTS work units.

Architectural Role:
    Pipeline Step (utility) -- a thin adapter between the course synthesis
    steps and the lower-level ``course_tts_chunks`` library.  It resolves
    the session code from the session definition and splits the formatted
    script into TTS-sized chunks.

Design Patterns:
    * **Adapter** -- translates between the step-level domain objects
      (``formatted_scripts`` dict, ``session_def`` dict) and the generic
      chunk-splitting function in ``factory_v2.shared.course_tts_chunks``.

Key Dependencies:
    * ``factory_v2.shared.course_tts_chunks.split_course_tts_chunks`` --
      performs the actual text splitting based on pause markers and word count.

Consumed By:
    * ``course_synthesis.py`` -- both the chunk and assembly executors call
      ``_course_session_chunks`` to obtain the chunk list for a session.
"""

from __future__ import annotations

from factory_v2.shared.course_tts_chunks import split_course_tts_chunks


def _course_session_chunks(
    formatted_scripts: dict[str, str],
    course_code: str,
    session_def: dict,
) -> tuple[str, list[str]]:
    """Return the full session code and the chunk list for that session's script.

    Args:
        formatted_scripts: Mapping of session code -> formatted narration text,
            populated by the ``format_course_scripts`` step.
        course_code: The course-level code (e.g. ``"CBT101"``).
        session_def: One entry from ``SESSION_DEFS`` identifying the session.

    Returns:
        A tuple of ``(session_code, chunks)`` where ``chunks`` is a list of
        text segments sized for individual TTS calls.

    Raises:
        ValueError: If the formatted script is missing or produces no chunks.
    """
    session_code = f"{course_code}{session_def['suffix']}"
    script = formatted_scripts.get(session_code)
    if not script:
        raise ValueError(f"Missing formatted script for {session_code}")
    chunks = split_course_tts_chunks(script)
    if not chunks:
        raise ValueError(f"Unable to derive TTS chunks for {session_code}")
    return session_code, chunks
