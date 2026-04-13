"""Step 1 -- Generate a narration script using an LLM.

Architectural Role:
    First stage of the content-factory pipeline.  Given a content type
    (guided meditation, bedtime story, etc.) and user-specified parameters
    (topic, duration, style), this module selects a prompt template, fills
    it with the job parameters, and sends it to a registry-provided LLM
    adapter.  The adapter can be a local Ollama model or a remote API
    (OpenAI, Gemini, etc.) -- the choice is transparent to this code.

    The generated script is raw text that still contains markdown artifacts
    and end-markers; downstream QA formatting (qa_formatter.py) cleans it
    up before TTS.

Key Dependencies:
    - models.registry.get_llm  -- adapter factory that returns an LLM backend
    - config.MODEL_DIR         -- local model weights directory
    - prompts/*.txt            -- per-content-type prompt templates
    - system_prompts/*.txt     -- optional system prompts for chat-style LLMs

Consumed By:
    - factory_v2 pipeline step ``generate_script``
    - image_generator.build_image_prompt (borrows ``_get_llm_adapter``)
"""

import os
from models.registry import get_llm
import config
from observability import get_logger

logger = get_logger(__name__)

# Approximate words-per-minute for narrated meditation audio.
# Used to estimate both the target word count in the prompt and the
# max_tokens budget sent to the LLM.
WORDS_PER_MINUTE = 130

# ---------------------------------------------------------------------------
# Model caching -- avoids re-loading large model weights between jobs when
# the same VM handles multiple queue items sequentially.
# ---------------------------------------------------------------------------
_cached_model = None
_cached_model_id = None


def _load_prompt_template(content_type: str) -> str:
    """Load the prompt template file for a content type.

    Templates live in ``worker/prompts/<content_type>.txt`` and contain
    ``{placeholder}`` tokens filled by ``_build_prompt``.

    Raises:
        FileNotFoundError: If no template exists for *content_type*.
    """
    prompts_dir = os.path.join(os.path.dirname(__file__), "..", "..", "prompts")
    filename = f"{content_type}.txt"
    filepath = os.path.join(prompts_dir, filename)

    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"No prompt template found at {filepath}")

    with open(filepath, "r") as f:
        return f.read()


def _load_system_prompt(content_type: str) -> str:
    """Load an optional system prompt for chat-style LLMs.

    System prompts set the persona and constraints (e.g. "You are a calm
    meditation narrator...").  If the file does not exist the caller simply
    gets an empty string and the generation proceeds without a system
    prompt -- this keeps backwards compatibility with older templates.
    """
    system_dir = os.path.join(os.path.dirname(__file__), "..", "..", "system_prompts")
    filename = f"{content_type}_system_prompt.txt"
    prompt_path = os.path.join(system_dir, filename)
    if not os.path.isfile(prompt_path):
        return ""
    with open(prompt_path, "r") as f:
        return f.read().strip()


def _build_prompt(template: str, job_data: dict) -> str:
    """Fill in the prompt template with job parameters.

    Uses simple ``str.replace`` rather than Python ``str.format`` so that
    any curly braces in the template that are *not* placeholders are left
    untouched (avoids KeyError on stray braces).

    Args:
        template: Raw template text with ``{placeholder}`` tokens.
        job_data: The full job document from Firestore.

    Returns:
        The fully-interpolated prompt string ready for the LLM.
    """
    params = job_data.get("params", {})
    duration = params.get("duration_minutes", 10)
    # Target word count tells the LLM how much text to produce
    word_count = duration * WORDS_PER_MINUTE

    replacements = {
        "topic": params.get("topic", "general mindfulness"),
        "duration_minutes": str(duration),
        "word_count": str(word_count),
        "difficulty": params.get("difficulty", "beginner"),
        "style": params.get("style", "calm and soothing"),
        "technique": params.get("technique", "mindfulness"),
        "category": params.get("category", "nature"),
        "custom_instructions": params.get("customInstructions", ""),
    }

    result = template
    for key, value in replacements.items():
        result = result.replace("{" + key + "}", value)

    return result


def _get_llm_adapter(job_data: dict):
    """Get (and cache) the LLM adapter for the current job.

    If the requested model differs from the currently cached one, the old
    model is unloaded first (freeing VRAM / RAM) before the new one is
    loaded.  This hot-swap pattern keeps memory bounded when a single
    worker processes jobs that target different LLM backends.
    """
    global _cached_model, _cached_model_id

    model_id = job_data.get("llmModel", "ollama-local")
    if _cached_model is None or _cached_model_id != model_id:
        # Unload the previous model to free resources before loading the new one
        if _cached_model is not None:
            _cached_model.unload()
        _cached_model = get_llm(model_id)
        _cached_model.load(config.MODEL_DIR)
        _cached_model_id = model_id
    return _cached_model


def generate_script(job_data: dict) -> str:
    """Generate a meditation/story script using the specified LLM.

    End-to-end flow:
        1. Load/reuse the LLM adapter for the requested model.
        2. Read the prompt template for the content type.
        3. Interpolate job parameters into the template.
        4. Optionally prepend a system prompt (personality / constraints).
        5. Call the adapter with a duration-based token budget.
        6. Strip any trailing end-markers the LLM may have emitted.

    Args:
        job_data: The Firestore job document containing ``llmModel``,
            ``contentType``, and ``params`` (topic, duration, etc.).

    Returns:
        The raw narration script (may still need QA formatting).
    """
    model_id = job_data.get("llmModel", "ollama-local")
    content_type = job_data.get("contentType", "guided_meditation")

    logger.info("LLM generating script", extra={"model_id": model_id, "content_type": content_type})

    # Load model (reuse if same model as previous job)
    adapter = _get_llm_adapter(job_data)

    # Build prompt from template + job parameters
    template = _load_prompt_template(content_type)
    prompt = _build_prompt(template, job_data)
    system_prompt = _load_system_prompt(content_type)
    if system_prompt:
        # Concatenate system and user prompts with a visual separator
        prompt = f"{system_prompt}\n\n---\n\n{prompt}"

    # Token budget: 2x the target word count (tokens != words) with a floor of 2048
    duration = job_data.get("params", {}).get("duration_minutes", 10)
    max_tokens = max(2048, duration * WORDS_PER_MINUTE * 2)

    # Generate the raw script text
    script = adapter.generate(prompt, max_tokens=max_tokens)

    # Some LLMs append explicit end-of-script markers; strip everything after them
    for marker in ["---END---", "<end_of_script>"]:
        if marker in script:
            script = script[:script.index(marker)].strip()

    word_count = len(script.split())
    logger.info("LLM script generated", extra={"model_id": model_id, "words": word_count})

    return script


# Map content types to user-facing labels for the title prompt.
_CONTENT_TYPE_LABELS = {
    "guided_meditation": "guided meditation",
    "sleep_meditation": "sleep meditation",
    "bedtime_story": "bedtime story",
    "emergency_meditation": "emergency meditation",
    "course_session": "course session",
}


def _fallback_title(job_data: dict) -> str:
    """Derive a human-readable fallback title from job params.

    Used when the LLM title call fails or returns garbage.  Picks the
    content-type label + a short topic hint rather than echoing the raw
    topic/style string verbatim (which may be 'Surprise me — choose freely').
    """
    params = job_data.get("params", {})
    content_type = job_data.get("contentType", "guided_meditation")
    type_label = _CONTENT_TYPE_LABELS.get(content_type, "meditation").title()
    topic = (params.get("topic") or "").strip()

    # If the topic is the random placeholder or empty, use just the type label.
    if not topic or "surprise" in topic.lower():
        return type_label

    # Truncate long topics to keep the title concise.
    words = topic.split()
    if len(words) > 5:
        topic = " ".join(words[:5])

    return topic.strip().title()


def generate_title(job_data: dict, script: str) -> str:
    """Generate a short, creative title for the content using the LLM.

    Called when the admin did not provide an explicit title.  The LLM reads
    the already-generated script and produces a concise title that captures
    its essence -- rather than falling back to the raw topic/style string.

    A brief cooldown is inserted before the LLM call to let local inference
    servers (LM Studio / Ollama) fully release resources from the preceding
    script-generation request.  Without this, LM Studio can crash with a
    ``Channel Error`` on back-to-back inference.

    Args:
        job_data: The Firestore job document (used to load the LLM adapter
            and read content-type metadata).
        script: The generated narration script to derive a title from.

    Returns:
        A short title string (typically 2-6 words).
    """
    import time

    adapter = _get_llm_adapter(job_data)
    content_type = job_data.get("contentType", "guided_meditation")
    type_label = _CONTENT_TYPE_LABELS.get(content_type, "meditation")

    # Use up to the first 300 words of the script as context -- enough
    # for the LLM to grasp the theme while keeping the prompt small.
    script_preview = " ".join(script.split()[:300])

    prompt = (
        f"You are naming a {type_label} audio track for a wellness app.\n\n"
        f"Here is the script:\n\n{script_preview}\n\n"
        "Write a short, evocative title for this content (2-6 words). "
        "The title should feel calming and inviting. "
        "Reply with ONLY the title — no quotes, no punctuation, no explanation."
    )

    # Cooldown: let LM Studio fully release the previous inference context
    # before sending the next request.
    time.sleep(2)

    raw_title = adapter.generate(prompt, max_tokens=30).strip()

    # Strip common LLM artifacts: surrounding quotes, trailing periods.
    raw_title = raw_title.strip("\"'""''").strip(".").strip()

    # Fallback: if the LLM returned nothing usable, derive from params.
    if not raw_title or len(raw_title) > 80:
        raw_title = _fallback_title(job_data)
        logger.warning("LLM returned unusable title, using fallback", extra={"fallback": raw_title})
    else:
        logger.info("LLM title generated", extra={"title": raw_title})

    return raw_title
