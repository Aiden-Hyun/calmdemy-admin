"""Course planning steps: generate the course outline first, then the thumbnail.

Architectural Role:
    Pipeline Step -- implements the first two steps of the course pipeline:
    (1) generate the structured course plan (outline with modules, lessons,
    and practices), and (2) generate or reuse the course thumbnail image.

Design Patterns:
    * **Defensive JSON Parsing** -- LLM output is notoriously messy.
      ``_parse_plan`` implements a three-tier fallback: raw ``json.loads``,
      then cleaned/extracted JSON, then ``ast.literal_eval`` as a last
      resort.  This resilience prevents a single formatting glitch from
      failing the entire pipeline.
    * **Idempotency** -- both steps check ``runtime`` for cached results
      before invoking expensive operations (LLM calls, image generation).

Key Dependencies:
    * ``factory_v2.shared.llm_generator`` -- LLM adapter for plan generation
    * ``factory_v2.shared.image_generator`` -- thumbnail generation
    * ``factory_v2.shared.storage_uploader`` -- Cloud Storage upload
    * ``system_prompts/course_system_prompt.txt`` -- the system prompt file

Consumed By:
    * ``course.py`` (re-export facade) -> ``registry.py``
"""

from __future__ import annotations

import ast
import json
import os
import re

import config

from observability import get_logger

from .base import StepContext, StepResult
from .course_common import _content_job_data, _content_job_id, _runtime

logger = get_logger(__name__)


def _load_system_prompt() -> str:
    """Load the course-plan system prompt from the ``system_prompts/`` directory."""
    prompt_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "system_prompts", "course_system_prompt.txt"
    )
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()


def _build_course_plan_prompt(job_data: dict) -> str:
    """Build the tightly constrained JSON-only prompt for course-plan generation.

    The prompt includes the system prompt, course metadata from job params,
    and a strict JSON schema the LLM must follow.  The exact format is
    enforced so ``_parse_plan`` can reliably extract the result.
    """
    params = job_data.get("params", {})
    system_prompt = _load_system_prompt()

    return f"""{system_prompt}

---

Now create a course plan for the following:

Course code: {params.get("courseCode", "COURSE101")}
Course title: {params.get("courseTitle", "Untitled Course")}
Course description: {params.get("topic", "A therapy-based course")}
Therapy approach: {params.get("subjectLabel", "CBT")}
Target audience: {params.get("targetAudience", "beginner")}
Tone: {params.get("tone", "gentle")}

Output the plan as JSON only, in this exact format (no markdown, no extra text):
Rules:
- Use plain text only (no SSML, no XML/HTML tags).
- Do NOT include double quotes inside string values.
- If you need quotation marks, use single quotes instead.

{{
  "courseTitle": "...",
  "courseGoal": "...",
  "intro": {{
    "title": "Course Intro",
    "outline": "..."
  }},
  "modules": [
    {{
      "moduleNumber": 1,
      "moduleTitle": "...",
      "lessonTitle": "...",
      "practiceTitle": "...",
      "objective": "...",
      "lessonSummary": "...",
      "practiceType": "...",
      "reflectionPrompts": ["...", "...", "..."],
      "keyTakeaway": "..."
    }},
    {{
      "moduleNumber": 2,
      "moduleTitle": "...",
      "lessonTitle": "...",
      "practiceTitle": "...",
      "objective": "...",
      "lessonSummary": "...",
      "practiceType": "...",
      "reflectionPrompts": ["...", "...", "..."],
      "keyTakeaway": "..."
    }},
    {{
      "moduleNumber": 3,
      "moduleTitle": "...",
      "lessonTitle": "...",
      "practiceTitle": "...",
      "objective": "...",
      "lessonSummary": "...",
      "practiceType": "...",
      "reflectionPrompts": ["...", "...", "..."],
      "keyTakeaway": "..."
    }},
    {{
      "moduleNumber": 4,
      "moduleTitle": "...",
      "lessonTitle": "...",
      "practiceTitle": "...",
      "objective": "...",
      "lessonSummary": "...",
      "practiceType": "...",
      "reflectionPrompts": ["...", "...", "..."],
      "keyTakeaway": "..."
    }}
  ]
}}"""


def _extract_json_object(text: str) -> str:
    """Extract the first balanced ``{...}`` block from arbitrary text.

    LLMs sometimes wrap JSON in prose or markdown.  This brace-counting
    approach isolates the JSON object regardless of surrounding noise.
    """
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object start found")
    depth = 0
    for idx in range(start, len(text)):
        char = text[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx + 1]
    raise ValueError("JSON object not balanced")


def _clean_json_text(text: str) -> str:
    """Normalize common LLM formatting mistakes so ``json.loads`` can succeed.

    Fixes include: smart quotes -> straight quotes, SSML ``<break>`` tags ->
    ``[PAUSE]`` markers, and trailing commas before closing braces/brackets.
    """
    cleaned = text
    cleaned = cleaned.replace("“", '"').replace("”", '"')
    cleaned = cleaned.replace("‘", "'").replace("’", "'")
    cleaned = re.sub(r'(<[^>]*?)="([^"]*?)"', r"\\1='\\2'", cleaned)
    cleaned = re.sub(r"<break\\s+time='(\\d+)s'\\s*/?>", r"[PAUSE \\1s]", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def _parse_plan(raw: str) -> dict:
    """Parse model output defensively, repairing common JSON-ish formatting mistakes.

    Three-tier fallback strategy:
        1. Try ``json.loads`` on the raw text (fast path for well-formed output).
        2. Extract the first ``{...}`` block, clean it, and retry.
        3. Convert JSON keywords to Python and use ``ast.literal_eval``.
    """
    text = raw.strip()
    # Strip markdown code fences if the LLM wrapped the JSON in ```...```.
    if text.startswith("```"):
        first_newline = text.index("\n")
        last_fence = text.rfind("```")
        if last_fence > first_newline:
            text = text[first_newline + 1:last_fence].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        extracted = _extract_json_object(text)
        cleaned = _clean_json_text(extracted)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            py_text = cleaned
            py_text = re.sub(r"\bnull\b", "None", py_text)
            py_text = re.sub(r"\btrue\b", "True", py_text)
            py_text = re.sub(r"\bfalse\b", "False", py_text)
            data = ast.literal_eval(py_text)
            if isinstance(data, dict):
                return data
            raise


def execute_generate_course_plan(ctx: StepContext) -> StepResult:
    """Generate the reusable course plan unless one already exists in runtime/request data.

    The plan is a JSON structure containing the course title, goal, intro
    outline, and four modules (each with lesson + practice details).  All
    downstream steps (scripts, TTS, publish) read from this plan.

    Idempotency:
        Skips LLM generation if ``runtime.course_plan`` or
        ``job_data.coursePlan`` already contains a valid plan.
    """
    from factory_v2.shared.llm_generator import _get_llm_adapter

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    # Idempotency: reuse an existing plan from runtime or the original request.
    plan = runtime.get("course_plan") or job_data.get("coursePlan")
    if not plan:
        adapter = _get_llm_adapter(job_data)
        plan_prompt = _build_course_plan_prompt(job_data)
        plan_raw = adapter.generate(plan_prompt, max_tokens=4096)
        plan = _parse_plan(plan_raw)
        ctx.progress("Course plan generated")

    return StepResult(
        output={"module_count": len(plan.get("modules") or [])},
        runtime_patch={"course_plan": plan},
        summary_patch={"currentStep": "generate_course_plan"},
        compat_content_job_patch={
            "status": "llm_generating",
            "coursePlan": plan,
            "courseProgress": "Generating course plan",
            "jobRunId": ctx.run_id,
        },
    )


def execute_generate_course_thumbnail(ctx: StepContext) -> StepResult:
    """Generate or reuse the course thumbnail and project its storage metadata.

    When ``force_regenerate`` is true (admin-triggered), the image prompt is
    rebuilt from the latest plan so the thumbnail reflects the current course
    contents rather than stale copy.
    """
    from factory_v2.shared.image_generator import build_image_prompt, generate_image
    from factory_v2.shared.storage_uploader import upload_image

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    plan = runtime.get("course_plan") or job_data.get("coursePlan") or {}

    thumbnail_url = runtime.get("thumbnail_url") or job_data.get("thumbnailUrl") or ""
    image_path = runtime.get("image_path") or job_data.get("imagePath") or ""
    image_prompt = runtime.get("image_prompt") or job_data.get("imagePrompt") or ""
    force_regenerate = bool(
        runtime.get("thumbnail_generation_requested") or job_data.get("thumbnailGenerationRequested")
    )
    content_job_id = _content_job_id(ctx.job)

    if force_regenerate or not thumbnail_url:
        title = job_data.get("params", {}).get("courseTitle", plan.get("courseTitle", "Untitled Course"))
        # Regeneration intentionally rebuilds the prompt from the latest plan so
        # the new image reflects the current course contents instead of stale copy.
        image_prompt = build_image_prompt(
            job_data,
            title,
            job_data.get("params", {}).get("topic", ""),
            "course",
            plan=plan,
            ignore_saved_prompt=force_regenerate,
        ) if force_regenerate else (
            image_prompt
            or build_image_prompt(
                job_data,
                title,
                job_data.get("params", {}).get("topic", ""),
                "course",
                plan=plan,
            )
        )
        local_image_path = generate_image(image_prompt)
        image_path, thumbnail_url = upload_image(
            local_image_path,
            {
                **job_data,
                "contentType": "course",
                "_factoryContentJobId": content_job_id,
                "_factoryStepName": ctx.step_name,
                "_factoryOverwriteExistingAsset": force_regenerate,
            },
        )

    return StepResult(
        output={"thumbnail_url": thumbnail_url},
        runtime_patch={
            "image_prompt": image_prompt,
            "image_path": image_path,
            "thumbnail_url": thumbnail_url,
            "image_model": config.IMAGE_MODEL_ID,
        },
        summary_patch={"currentStep": "generate_course_thumbnail"},
        compat_content_job_patch={
            "status": "image_generating",
            "imagePrompt": image_prompt,
            "imagePath": image_path,
            "thumbnailUrl": thumbnail_url,
            "imageModel": config.IMAGE_MODEL_ID,
            "thumbnailGenerationRequested": False,
            "jobRunId": ctx.run_id,
        },
    )
