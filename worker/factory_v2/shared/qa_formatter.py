"""Step 2 -- QA and formatting: validate and clean up the generated script.

Architectural Role:
    Sits between the LLM generation step and TTS synthesis.  Raw LLM output
    often contains markdown formatting, speaker labels, list markers, and
    other artifacts that would be read aloud by the TTS engine.  This module
    strips all non-narration content while preserving pause markers and the
    actual spoken text.

    The cleaned script is also validated: a minimum word count guards against
    near-empty outputs caused by LLM failures.

Key Dependencies:
    None -- pure regex-based text processing.

Consumed By:
    - factory_v2 pipeline step ``format_script``
    - factory_v2 pipeline step ``format_course_scripts``
"""

import re

from observability import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Pre-compiled regexes for script sanitization
# ---------------------------------------------------------------------------

# Normalize pause markers to a canonical form: [PAUSE 3s]
_PAUSE_RE = re.compile(
    r'\[pause\s*(\d+)\s*s(?:econds?)?\s*\]',
    flags=re.IGNORECASE,
)
# Remove "Title:", "Script:", etc. header lines LLMs sometimes produce
_PREFIX_RE = re.compile(
    r'^(Title|Script|Narration|Scene)\s*:.*\n?',
    flags=re.MULTILINE | re.IGNORECASE,
)
# Remove stand-alone speaker label lines like "Narrator:" or "Guide (softly):"
_SPEAKER_LINE_RE = re.compile(
    r'^\s*(Narrator|Host|Guide|Speaker)(?:\s*\([^)]*\))?\s*:?\s*$',
    flags=re.IGNORECASE,
)
# Remove speaker prefixes at the start of content lines (e.g. "Narrator: Welcome...")
_SPEAKER_PREFIX_RE = re.compile(
    r'^\s*(Narrator|Host|Guide|Speaker)(?:\s*\([^)]*\))?\s*:\s*',
    flags=re.IGNORECASE,
)
# Remove markdown list markers (-, *, 1., etc.)
_LIST_MARKER_RE = re.compile(r'^\s*(?:[-*•]+|\d+[.)])\s+')
# Remove forward-referencing sentences ("In our next module...") that break
# standalone playback
_FORWARD_REF_RE = re.compile(
    r'\s+In (?:the|our) next (?:module|lesson|practice)\b.*$',
    flags=re.IGNORECASE,
)


def sanitize_narration_script(script: str) -> str:
    """Strip article-style formatting so narration stays TTS-friendly.

    Removes:
        - Code fences (triple backticks)
        - Markdown headings (``# ...``)
        - Bold/italic wrappers (``**text**``, ``_text_``)
        - Speaker labels (``Narrator:``, ``Guide (softly):``)
        - List markers (``- item``, ``1. item``)
        - Forward-referencing sentences
        - End-of-script sentinels (``---END---``, ``<end_of_script>``)
        - Horizontal rules (``---``)

    Preserves:
        - Actual narration text
        - Normalized ``[PAUSE Xs]`` markers
    """
    text = script.strip().replace("\r\n", "\n")
    # Normalize varied pause formats to canonical [PAUSE Xs]
    text = _PAUSE_RE.sub(lambda m: f"[PAUSE {m.group(1)}s]", text)
    # Remove code fences (LLMs occasionally wrap scripts in them)
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = _PREFIX_RE.sub('', text)

    cleaned_lines: list[str] = []
    for raw_line in text.split("\n"):
        original = raw_line.rstrip()
        stripped = original.strip()

        if not stripped:
            cleaned_lines.append("")
            continue
        if stripped in {"---END---", "<end_of_script>"}:
            continue
        if re.fullmatch(r'-{3,}', stripped):
            continue
        if re.fullmatch(r'#{1,6}\s+.+', stripped):
            continue
        if re.fullmatch(r'\*{1,2}[^*]+\*{1,2}', stripped):
            # Bold/italic stand-alone lines are usually headings, not narration.
            continue
        if _SPEAKER_LINE_RE.fullmatch(stripped):
            continue

        line = original
        line = re.sub(r'\*\*(.*?)\*\*', r'\1', line)
        line = re.sub(r'\*(.*?)\*', r'\1', line)
        line = re.sub(r'__(.*?)__', r'\1', line)
        line = re.sub(r'_(.*?)_', r'\1', line)
        line = _SPEAKER_PREFIX_RE.sub('', line)
        line = _LIST_MARKER_RE.sub('', line)
        line = _FORWARD_REF_RE.sub('', line)
        line = re.sub(r'\s{2,}', ' ', line).strip()

        if not line:
            continue
        cleaned_lines.append(line)

    text = "\n".join(cleaned_lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def format_script(script: str, job_data: dict) -> str:
    """Validate structure and normalize pause markers in the script.

    Raises:
        ValueError: If the cleaned script contains fewer than 50 words,
            indicating the LLM likely produced garbage output.
    """
    logger.info("Formatting script")

    text = sanitize_narration_script(script)

    word_count = len(text.split())
    pause_count = len(re.findall(r'\[PAUSE \d+s\]', text))
    logger.info(
        "Formatted script",
        extra={"word_count": word_count, "pause_count": pause_count},
    )

    if word_count < 50:
        raise ValueError(f"Script too short ({word_count} words). LLM may have failed.")

    return text
