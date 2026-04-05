"""
Step 1: Generate a narration script using an LLM.
"""

import os
from models.registry import get_llm
import config
from observability import get_logger

logger = get_logger(__name__)

# Approximate words-per-minute for narrated meditation audio
WORDS_PER_MINUTE = 130

# Cache loaded model to reuse across jobs in the same VM session
_cached_model = None
_cached_model_id = None


def _load_prompt_template(content_type: str) -> str:
    """Load the prompt template file for a content type."""
    prompts_dir = os.path.join(os.path.dirname(__file__), "..", "..", "prompts")
    filename = f"{content_type}.txt"
    filepath = os.path.join(prompts_dir, filename)

    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"No prompt template found at {filepath}")

    with open(filepath, "r") as f:
        return f.read()


def _load_system_prompt(content_type: str) -> str:
    """Load an optional system prompt for a content type."""
    system_dir = os.path.join(os.path.dirname(__file__), "..", "..", "system_prompts")
    filename = f"{content_type}_system_prompt.txt"
    prompt_path = os.path.join(system_dir, filename)
    if not os.path.isfile(prompt_path):
        return ""
    with open(prompt_path, "r") as f:
        return f.read().strip()


def _build_prompt(template: str, job_data: dict) -> str:
    """Fill in the prompt template with job parameters."""
    params = job_data.get("params", {})
    duration = params.get("duration_minutes", 10)
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
    """Get (and cache) the LLM adapter for the current job."""
    global _cached_model, _cached_model_id

    model_id = job_data.get("llmModel", "ollama-local")
    if _cached_model is None or _cached_model_id != model_id:
        if _cached_model is not None:
            _cached_model.unload()
        _cached_model = get_llm(model_id)
        _cached_model.load(config.MODEL_DIR)
        _cached_model_id = model_id
    return _cached_model


def generate_script(job_data: dict) -> str:
    """Generate a meditation/story script using the specified LLM."""
    model_id = job_data.get("llmModel", "ollama-local")
    content_type = job_data.get("contentType", "guided_meditation")

    logger.info("LLM generating script", extra={"model_id": model_id, "content_type": content_type})

    # Load model (reuse if same model as previous job)
    adapter = _get_llm_adapter(job_data)

    # Build prompt
    template = _load_prompt_template(content_type)
    prompt = _build_prompt(template, job_data)
    system_prompt = _load_system_prompt(content_type)
    if system_prompt:
        prompt = f"{system_prompt}\n\n---\n\n{prompt}"

    # Estimate max tokens based on duration
    duration = job_data.get("params", {}).get("duration_minutes", 10)
    max_tokens = max(2048, duration * WORDS_PER_MINUTE * 2)

    # Generate
    script = adapter.generate(prompt, max_tokens=max_tokens)

    # Clean up end marker if present
    for marker in ["---END---", "<end_of_script>"]:
        if marker in script:
            script = script[:script.index(marker)].strip()

    word_count = len(script.split())
    logger.info("LLM script generated", extra={"model_id": model_id, "words": word_count})

    return script
