"""Audio QC core: normalize source/transcript, classify diff, render verdict.

Pure-Python library. No I/O. Importable from CLI tools and the worker step.

Design:
    1. Normalize both source and transcript through a regex pipeline that
       absorbs differences that aren't TTS-quality issues:
       SSML/markup, hallucination tails, contractions, digits→words,
       acronym splitting, hyphen folding, punctuation stripping.
    2. Word-align via difflib.SequenceMatcher.
    3. Classify each diff opcode as mispronunciation / dropped / inserted,
       filtering Whisper-noise filler tokens (and / so / but / etc.).
    4. Apply tight verdict thresholds: PASS=0 issues, REVIEW=1 single-word
       issue, FAIL=multi-word run or 2+ issues or language/duration mismatch.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from typing import Iterable


WPM_DEFAULT = 130  # narration words per minute baseline (meditation runs slower than news)
# Duration ratio = actual_seconds / expected_seconds. Wide window: the word-level
# diff is the primary signal; duration is a backup that only fires on severe
# truncation (cut-off audio) or severe over-run (dead-air or stuck loop).
DURATION_LOWER = 0.40  # ratio below this = audio truncated
DURATION_UPPER = 2.50  # ratio above this = dead-air or loop

# Single-word inserts/deletes that are typically Whisper artifacts, not TTS bugs.
# Keep this list short — if it grows, we're masking real problems.
WHISPER_FILLER_TOKENS = frozenset({
    "and", "so", "but", "now", "then", "also", "well",
    "okay", "ok", "um", "uh", "yeah",
})

# --- regex bank --------------------------------------------------------------

RE_SSML = re.compile(r"<[^>]+>")
RE_BRACKETED = re.compile(r"\[[^\]]+\]")
RE_PARENS_AUX = re.compile(
    r"\(\s*(pause|breath|sigh|silence|inhale|exhale|long pause|short pause)\s*\)",
    re.IGNORECASE,
)
RE_ELLIPSIS = re.compile(r"\.{2,}")

RE_HALLUCINATION_TAIL = re.compile(
    r"\b(thanks?\s+for\s+watching|please\s+subscribe|like\s+and\s+subscribe|"
    r"see\s+you\s+next\s+time|don't\s+forget\s+to\s+subscribe)[^.!?]*[.!?]?\s*$",
    re.IGNORECASE,
)

RE_OK_VARIANT = re.compile(r"\b(o\.?k\.?|okay)\b", re.IGNORECASE)

RE_TIME = re.compile(r"\b(\d{1,2}):(\d{2})(?:\s*(a\.?m\.?|p\.?m\.?))?\b", re.IGNORECASE)
RE_ORDINAL = re.compile(r"\b(\d+)(st|nd|rd|th)\b", re.IGNORECASE)
RE_CURRENCY = re.compile(r"\$(\d+(?:\.\d{1,2})?)")
RE_INTEGER = re.compile(r"\b\d+\b")
RE_ACRONYM = re.compile(r"\b([A-Z]{2,})\b")  # pre-lowercase only

CONTRACTIONS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bcan'?t\b", re.I), "cannot"),
    (re.compile(r"\bwon'?t\b", re.I), "will not"),
    (re.compile(r"\bdon'?t\b", re.I), "do not"),
    (re.compile(r"\bdoesn'?t\b", re.I), "does not"),
    (re.compile(r"\bdidn'?t\b", re.I), "did not"),
    (re.compile(r"\bisn'?t\b", re.I), "is not"),
    (re.compile(r"\baren'?t\b", re.I), "are not"),
    (re.compile(r"\bwasn'?t\b", re.I), "was not"),
    (re.compile(r"\bweren'?t\b", re.I), "were not"),
    (re.compile(r"\bhasn'?t\b", re.I), "has not"),
    (re.compile(r"\bhaven'?t\b", re.I), "have not"),
    (re.compile(r"\bhadn'?t\b", re.I), "had not"),
    (re.compile(r"\bwouldn'?t\b", re.I), "would not"),
    (re.compile(r"\bcouldn'?t\b", re.I), "could not"),
    (re.compile(r"\bshouldn'?t\b", re.I), "should not"),
    (re.compile(r"\bi'?m\b", re.I), "i am"),
    (re.compile(r"\byou'?re\b", re.I), "you are"),
    (re.compile(r"\bwe'?re\b", re.I), "we are"),
    (re.compile(r"\bthey'?re\b", re.I), "they are"),
    (re.compile(r"\bit'?s\b", re.I), "it is"),
    (re.compile(r"\bthat'?s\b", re.I), "that is"),
    (re.compile(r"\bthere'?s\b", re.I), "there is"),
    (re.compile(r"\bhere'?s\b", re.I), "here is"),
    (re.compile(r"\blet'?s\b", re.I), "let us"),
    (re.compile(r"\bi'?ve\b", re.I), "i have"),
    (re.compile(r"\byou'?ve\b", re.I), "you have"),
    (re.compile(r"\bwe'?ve\b", re.I), "we have"),
    (re.compile(r"\bthey'?ve\b", re.I), "they have"),
    (re.compile(r"\bi'?ll\b", re.I), "i will"),
    (re.compile(r"\byou'?ll\b", re.I), "you will"),
    (re.compile(r"\bhe'?ll\b", re.I), "he will"),
    (re.compile(r"\bshe'?ll\b", re.I), "she will"),
    (re.compile(r"\bit'?ll\b", re.I), "it will"),
    (re.compile(r"\bthey'?ll\b", re.I), "they will"),
    (re.compile(r"\bi'?d\b", re.I), "i would"),
    (re.compile(r"\byou'?d\b", re.I), "you would"),
    (re.compile(r"\bhe'?d\b", re.I), "he would"),
    (re.compile(r"\bshe'?d\b", re.I), "she would"),
]


# --- normalization -----------------------------------------------------------

def _expand_acronyms(text: str) -> str:
    return RE_ACRONYM.sub(lambda m: " ".join(m.group(1).lower()), text)


def _expand_numbers(text: str) -> str:
    # Lazy import — num2words only lives in the QC venv. Modules that touch
    # this file at import time (e.g. registry inspection) shouldn't pay the
    # cost of resolving it.
    from num2words import num2words

    def time_repl(m: re.Match) -> str:
        h, mn, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "")
        base = num2words(h) if mn == 0 else f"{num2words(h)} {num2words(mn)}"
        ampm_norm = ampm.replace(".", "").lower()
        if ampm_norm:
            base += " " + " ".join(ampm_norm)
        return base

    def ordinal_repl(m: re.Match) -> str:
        return num2words(int(m.group(1)), to="ordinal")

    def currency_repl(m: re.Match) -> str:
        amount = float(m.group(1))
        whole = int(amount)
        cents = round((amount - whole) * 100)
        if cents == 0:
            return f"{num2words(whole)} dollars"
        return f"{num2words(whole)} dollars and {num2words(cents)} cents"

    def int_repl(m: re.Match) -> str:
        return num2words(int(m.group(0)))

    text = RE_TIME.sub(time_repl, text)
    text = RE_ORDINAL.sub(ordinal_repl, text)
    text = RE_CURRENCY.sub(currency_repl, text)
    text = RE_INTEGER.sub(int_repl, text)
    return text


def normalize(text: str, *, is_source: bool) -> str:
    """Run the full regex normalization pipeline.

    Order is load-bearing:
      1. Strip TTS-only markup (SSML, brackets, parens-aux) from source.
      2. Strip Whisper hallucination tails from transcript.
      3. Collapse ellipses to space.
      4. Normalize OK/Ok/okay variants.
      5. Expand acronyms (pre-lowercase to detect uppercase runs).
      6. Expand numbers (digits, times, ordinals, currency).
      7. Lowercase everything.
      8. Expand contractions.
      9. Fold hyphens (out-breath ≡ outbreath).
     10. Drop remaining punctuation; collapse whitespace.
    """
    if is_source:
        text = RE_SSML.sub(" ", text)
        text = RE_BRACKETED.sub(" ", text)
        text = RE_PARENS_AUX.sub(" ", text)
    else:
        text = RE_HALLUCINATION_TAIL.sub("", text)

    text = RE_ELLIPSIS.sub(" ", text)
    text = RE_OK_VARIANT.sub("okay", text)
    text = _expand_acronyms(text)
    text = _expand_numbers(text)
    text = text.lower()
    for pattern, replacement in CONTRACTIONS:
        text = pattern.sub(replacement, text)
    text = text.replace("-", "")
    text = re.sub(r"[^\w\s']", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# --- diff classification -----------------------------------------------------

@dataclass
class Issue:
    kind: str  # "mispronunciation" | "dropped" | "inserted"
    before: str = ""
    after: str = ""
    words: list[str] = field(default_factory=list)
    position: int = 0  # word index in source where the issue starts

    def to_log(self) -> str:
        if self.kind == "mispronunciation":
            return f"mispronunciation: '{self.before}' → '{self.after}' (pos {self.position})"
        if self.kind == "dropped":
            return f"dropped {len(self.words)} word(s): '{' '.join(self.words)}' (pos {self.position})"
        if self.kind == "inserted":
            return f"inserted {len(self.words)} word(s): '{' '.join(self.words)}' (pos {self.position})"
        return self.kind


def _is_filler_singleton(words: list[str]) -> bool:
    return len(words) == 1 and words[0] in WHISPER_FILLER_TOKENS


def classify(opcodes, ref_words: list[str], hyp_words: list[str]) -> list[Issue]:
    """Translate diff opcodes into structured issues.

    Single-word inserts/deletes of common Whisper filler tokens are dropped
    entirely — they're transcription artifacts, not TTS quality bugs.
    """
    issues: list[Issue] = []
    for op, i1, i2, j1, j2 in opcodes:
        if op == "equal":
            continue
        ref_run = ref_words[i1:i2]
        hyp_run = hyp_words[j1:j2]

        if op == "replace":
            n_aligned = min(len(ref_run), len(hyp_run))
            for k in range(n_aligned):
                issues.append(Issue(
                    kind="mispronunciation",
                    before=ref_run[k],
                    after=hyp_run[k],
                    position=i1 + k,
                ))
            extra_dropped = list(ref_run[n_aligned:])
            extra_inserted = list(hyp_run[n_aligned:])
            if extra_dropped and not _is_filler_singleton(extra_dropped):
                issues.append(Issue(
                    kind="dropped",
                    words=extra_dropped,
                    position=i1 + n_aligned,
                ))
            if extra_inserted and not _is_filler_singleton(extra_inserted):
                issues.append(Issue(
                    kind="inserted",
                    words=extra_inserted,
                    position=i1,
                ))
        elif op == "delete":
            if not _is_filler_singleton(ref_run):
                issues.append(Issue(kind="dropped", words=list(ref_run), position=i1))
        elif op == "insert":
            if not _is_filler_singleton(hyp_run):
                issues.append(Issue(kind="inserted", words=list(hyp_run), position=i1))
    return issues


def render_diff(opcodes, ref_words: list[str], hyp_words: list[str]) -> str:
    """Build a human-readable inline diff string."""
    parts: list[str] = []
    for op, i1, i2, j1, j2 in opcodes:
        ref_chunk = " ".join(ref_words[i1:i2])
        hyp_chunk = " ".join(hyp_words[j1:j2])
        if op == "equal":
            parts.append(ref_chunk)
        elif op == "replace":
            parts.append(f"[~{ref_chunk} → {hyp_chunk}]")
        elif op == "delete":
            parts.append(f"[-{ref_chunk}]")
        elif op == "insert":
            parts.append(f"[+{hyp_chunk}]")
    return " ".join(parts)


# --- verdict -----------------------------------------------------------------

def verdict(
    issues: list[Issue],
    *,
    language_match: bool,
    duration_ratio: float,
) -> tuple[str, str]:
    """Apply tight verdict thresholds.

    Order checks worst-first so the returned reason is the strongest signal.
    """
    if not language_match:
        return "FAIL", "wrong language detected (voice/model mismatch)"

    if duration_ratio < DURATION_LOWER:
        return "FAIL", f"audio truncated: {duration_ratio:.0%} of expected duration"
    if duration_ratio > DURATION_UPPER:
        return "FAIL", f"audio too long: {duration_ratio:.0%} of expected (dead-air or loop)"

    # Multi-word structural issues are decisive — re-render.
    for issue in issues:
        if issue.kind in ("dropped", "inserted") and len(issue.words) >= 2:
            return "FAIL", issue.to_log()

    # 2+ issues in a single chunk is suspect — re-render.
    if len(issues) >= 2:
        return "FAIL", f"{len(issues)} issues in chunk; first: {issues[0].to_log()}"

    if len(issues) == 1:
        return "REVIEW", issues[0].to_log()

    return "PASS", "clean"


# --- top-level pipeline ------------------------------------------------------

@dataclass
class QCResult:
    verdict: str
    reason: str
    wer_pct: float
    issues: list[dict]
    rendered_diff: str
    normalized_source: str
    normalized_transcript: str
    audio_seconds: float
    expected_seconds: float
    duration_ratio: float
    detected_language: str
    expected_language: str
    ref_word_count: int
    subs: int
    dels: int
    ins: int

    def to_dict(self) -> dict:
        return asdict(self)


def run_qc(
    source_text: str,
    transcript_data: dict,
    *,
    expected_language: str = "en",
    wpm: float = WPM_DEFAULT,
) -> QCResult:
    """Run the full QC pipeline. Pure function, no I/O.

    Args:
        source_text: The exact text fed to TTS for this chunk.
        transcript_data: Whisper output JSON (must contain "text"; ideally
            also "language" and "segments" with end timestamps).
        expected_language: Two-letter language code we asked TTS to render.
        wpm: Average narration WPM for duration estimation.

    Returns:
        QCResult with verdict, structured issues, normalized texts, and metrics.
    """
    transcript_text: str = transcript_data.get("text", "") or ""
    detected_lang: str = transcript_data.get("language") or expected_language
    segments = transcript_data.get("segments") or []
    audio_seconds = float(segments[-1]["end"]) if segments else 0.0

    src_norm = normalize(source_text, is_source=True)
    hyp_norm = normalize(transcript_text, is_source=False)
    ref_words = src_norm.split()
    hyp_words = hyp_norm.split()
    n_ref = len(ref_words)

    matcher = SequenceMatcher(None, ref_words, hyp_words, autojunk=False)
    opcodes = matcher.get_opcodes()
    issues = classify(opcodes, ref_words, hyp_words)
    rendered = render_diff(opcodes, ref_words, hyp_words)

    subs = sum(1 for i in issues if i.kind == "mispronunciation")
    dels = sum(len(i.words) for i in issues if i.kind == "dropped")
    ins = sum(len(i.words) for i in issues if i.kind == "inserted")
    wer_pct = (subs + dels + ins) / max(n_ref, 1) * 100

    expected_seconds = (n_ref / wpm) * 60 if n_ref else 0.0
    duration_ratio = (audio_seconds / expected_seconds) if expected_seconds else 1.0

    label, reason = verdict(
        issues,
        language_match=(detected_lang == expected_language),
        duration_ratio=duration_ratio,
    )

    return QCResult(
        verdict=label,
        reason=reason,
        wer_pct=wer_pct,
        issues=[asdict(i) for i in issues],
        rendered_diff=rendered,
        normalized_source=src_norm,
        normalized_transcript=hyp_norm,
        audio_seconds=audio_seconds,
        expected_seconds=expected_seconds,
        duration_ratio=duration_ratio,
        detected_language=detected_lang,
        expected_language=expected_language,
        ref_word_count=n_ref,
        subs=subs,
        dels=dels,
        ins=ins,
    )


def format_log_lines(result: QCResult, *, job_id: str = "", chunk_index: int = -1, attempt: int = 1) -> list[str]:
    """Forensic log lines for the worker step. One line per issue + summary."""
    prefix_parts = ["[qc_audio_chunk]"]
    if job_id:
        prefix_parts.append(f"job={job_id}")
    if chunk_index >= 0:
        prefix_parts.append(f"chunk={chunk_index}")
    prefix_parts.append(f"attempt={attempt}")
    prefix = " ".join(prefix_parts)

    lines: list[str] = []
    for issue_dict in result.issues:
        issue = Issue(**issue_dict)
        lines.append(f"{prefix} {issue.to_log()}")
    lines.append(
        f"{prefix} WER={result.wer_pct:.2f}% duration_ratio={result.duration_ratio:.2f} "
        f"language={result.detected_language} verdict={result.verdict} reason=\"{result.reason}\""
    )
    return lines
