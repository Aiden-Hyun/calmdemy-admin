"""
Step 2: QA and formatting — validate and clean up the generated script.
"""

import re

from observability import get_logger

logger = get_logger(__name__)

_PAUSE_RE = re.compile(
    r'\[pause\s*(\d+)\s*s(?:econds?)?\s*\]',
    flags=re.IGNORECASE,
)
_PREFIX_RE = re.compile(
    r'^(Title|Script|Narration|Scene)\s*:.*\n?',
    flags=re.MULTILINE | re.IGNORECASE,
)
_SPEAKER_LINE_RE = re.compile(
    r'^\s*(Narrator|Host|Guide|Speaker)(?:\s*\([^)]*\))?\s*:?\s*$',
    flags=re.IGNORECASE,
)
_SPEAKER_PREFIX_RE = re.compile(
    r'^\s*(Narrator|Host|Guide|Speaker)(?:\s*\([^)]*\))?\s*:\s*',
    flags=re.IGNORECASE,
)
_LIST_MARKER_RE = re.compile(r'^\s*(?:[-*•]+|\d+[.)])\s+')
_FORWARD_REF_RE = re.compile(
    r'\s+In (?:the|our) next (?:module|lesson|practice)\b.*$',
    flags=re.IGNORECASE,
)


def sanitize_narration_script(script: str) -> str:
    """Strip article-style formatting so narration stays TTS-friendly."""
    text = script.strip().replace("\r\n", "\n")
    text = _PAUSE_RE.sub(lambda m: f"[PAUSE {m.group(1)}s]", text)
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
    """Validate structure and normalize pause markers in the script."""
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
