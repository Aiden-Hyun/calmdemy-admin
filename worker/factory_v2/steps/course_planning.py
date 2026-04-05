"""Course planning steps: generate the course outline first, then the thumbnail."""

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
    prompt_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "system_prompts", "course_system_prompt.txt"
    )
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()


def _build_course_plan_prompt(job_data: dict) -> str:
    """Build the tightly constrained JSON-only prompt for course-plan generation."""
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
    cleaned = text
    cleaned = cleaned.replace("“", '"').replace("”", '"')
    cleaned = cleaned.replace("‘", "'").replace("’", "'")
    cleaned = re.sub(r'(<[^>]*?)="([^"]*?)"', r"\\1='\\2'", cleaned)
    cleaned = re.sub(r"<break\\s+time='(\\d+)s'\\s*/?>", r"[PAUSE \\1s]", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def _parse_plan(raw: str) -> dict:
    """Parse model output defensively, repairing common JSON-ish formatting mistakes."""
    text = raw.strip()
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
    """Generate the reusable course plan unless one already exists in runtime/request data."""
    from factory_v2.shared.llm_generator import _get_llm_adapter

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

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
    """Generate or reuse the course thumbnail and project its storage metadata."""
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
