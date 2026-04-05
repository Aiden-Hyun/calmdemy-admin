"""Course script steps: generate raw scripts first, then QA-format each session."""

from __future__ import annotations

import json

from firebase_admin import firestore as fs

from observability import get_logger
from factory_v2.shared.qa_formatter import sanitize_narration_script
from factory_v2.shared.voice_utils import get_voice_display_name

from .base import StepContext, StepResult
from .course_common import (
    SESSION_DEFS,
    _content_job_data,
    _course_code,
    _course_regeneration,
    _course_script_approval,
    _runtime,
)

logger = get_logger(__name__)


def _build_session_script_prompt(
    session_def: dict,
    plan: dict,
    job_data: dict,
) -> str:
    """Build a prompt tailored to the intro/lesson/practice flavor of one session."""
    params = job_data.get("params", {})
    course_code = params.get("courseCode", "COURSE101")
    course_title = params.get("courseTitle", plan.get("courseTitle", "Untitled"))
    approach = params.get("subjectLabel", "CBT")
    tone = params.get("tone", "gentle")
    audience = params.get("targetAudience", "beginner")
    narrator_name = get_voice_display_name(job_data.get("ttsVoice", "Calmdemy"))

    session_type = session_def["type"]
    duration_min = session_def["duration_min"]
    words = duration_min * 130

    if session_type == "intro":
        intro_outline = plan.get("intro", {}).get("outline", "Welcome to the course.")
        return (
            f"You are Calmdemy Course Scriptwriter. Write a Course Intro script "
            f"for the course '{course_title}' (code: {course_code}).\\n\\n"
            f"Therapy approach: {approach}\\n"
            f"Tone: {tone}\\n"
            f"Target audience: {audience}\\n"
            f"Duration: about {duration_min} minutes (~{words} words)\\n\\n"
            f"Intro outline from the course plan:\\n{intro_outline}\\n\\n"
            f"Course goal: {plan.get('courseGoal', '')}\\n\\n"
            f"Rules:\\n"
            f"- Narrator display name: {narrator_name}.\\n"
            f"- Open with a brief self-introduction using that exact narrator name.\\n"
            f"- Include a short educational disclaimer (not treatment).\\n"
            f"- Spoken narration only. No markdown, headings, bullets, numbered lists, separators, or speaker labels.\\n"
            f"- Use natural spoken paragraphs, not article sections.\\n"
            f"- Never use Roman numerals like I, II, III, or IV when you mean numbers. Always write 1, 2, 3, 4, etc.\\n"
            f"- Use [PAUSE Xs] markers for pauses (e.g. [PAUSE 3s]).\\n"
            f"- Write ONLY the narration script. No titles or metadata at the top.\\n"
            f"- End with ---END---"
        )

    module_idx = int(session_def["suffix"][1]) - 1
    module = plan.get("modules", [{}])[module_idx] if module_idx < len(plan.get("modules", [])) else {}

    if session_type == "lesson":
        title = module.get("lessonTitle", "Lesson")
        summary = module.get("lessonSummary", "")
        objective = module.get("objective", "")
        return (
            f"You are Calmdemy Course Scriptwriter. Write a Lesson script "
            f"for Module {module_idx + 1} of '{course_title}' ({course_code}).\\n\\n"
            f"Module title: {module.get('moduleTitle', '')}\\n"
            f"Lesson title: {title}\\n"
            f"Learning objective: {objective}\\n"
            f"Lesson summary: {summary}\\n"
            f"Therapy approach: {approach}\\n"
            f"Tone: {tone}\\n"
            f"Target audience: {audience}\\n"
            f"Duration: about {duration_min} minutes (~{words} words)\\n\\n"
            f"Rules:\\n"
            f"- Clear teaching with one example and one tool.\\n"
            f"- Spoken narration only. No markdown, headings, bullets, numbered lists, speaker labels, or separators.\\n"
            f"- Use natural spoken paragraphs, not article sections or list formatting.\\n"
            f"- Never use Roman numerals like I, II, III, or IV when you mean numbers. Always write 1, 2, 3, 4, etc.\\n"
            f"- Define ideas in plain language instead of quoting textbook definitions.\\n"
            f"- Use [PAUSE Xs] markers for pauses.\\n"
            f"- Include a gentle closing and takeaway line.\\n"
            f"- Start with a brief intro connecting to the course theme.\\n"
            f"- Avoid teaser lines about the next module or next lesson. Keep the close grounded in the current lesson.\\n"
            f"- Write ONLY the narration script. No titles or metadata at the top.\\n"
            f"- End with ---END---"
        )

    title = module.get("practiceTitle", "Practice")
    practice_type = module.get("practiceType", "guided exercise")
    prompts = module.get("reflectionPrompts", [])
    takeaway = module.get("keyTakeaway", "")
    return (
        f"You are Calmdemy Course Scriptwriter. Write a Practice script "
        f"for Module {module_idx + 1} of '{course_title}' ({course_code}).\\n\\n"
        f"Module title: {module.get('moduleTitle', '')}\\n"
        f"Practice title: {title}\\n"
        f"Practice type: {practice_type}\\n"
        f"Reflection prompts to include: {', '.join(prompts)}\\n"
        f"Key takeaway: {takeaway}\\n"
        f"Therapy approach: {approach}\\n"
        f"Tone: {tone}\\n"
        f"Target audience: {audience}\\n"
        f"Duration: about {duration_min} minutes (~{words} words)\\n\\n"
        f"Rules:\\n"
        f"- Guided exercise with varied prompts and intentional pauses.\\n"
        f"- Spoken narration only. No markdown, headings, bullets, numbered lists, speaker labels, or separators.\\n"
        f"- Use natural spoken paragraphs, not article sections or checklist formatting.\\n"
        f"- Never use Roman numerals like I, II, III, or IV when you mean numbers. Always write 1, 2, 3, 4, etc.\\n"
        f"- Use [PAUSE Xs] markers for pauses (3s-10s).\\n"
        f"- Include re-centering language and reflection.\\n"
        f"- Clear start and end.\\n"
        f"- Avoid teaser lines about future modules or lessons.\\n"
        f"- Write ONLY the narration script. No titles or metadata at the top.\\n"
        f"- End with ---END---"
    )


def execute_generate_course_scripts(ctx: StepContext) -> StepResult:
    """Generate any missing session scripts and optionally stop for approval."""
    from factory_v2.shared.llm_generator import _get_llm_adapter

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    plan = runtime.get("course_plan") or job_data.get("coursePlan")
    if not plan:
        raise ValueError("Missing runtime.course_plan")

    course_code = _course_code(job_data)
    raw_scripts: dict[str, str] = dict(runtime.get("course_raw_scripts") or job_data.get("courseRawScripts") or {})
    adapter = None

    for index, session_def in enumerate(SESSION_DEFS):
        session_code = f"{course_code}{session_def['suffix']}"
        if raw_scripts.get(session_code, "").strip():
            continue

        if adapter is None:
            adapter = _get_llm_adapter(job_data)
        prompt = _build_session_script_prompt(session_def, plan, job_data)
        raw_script = adapter.generate(
            prompt,
            max_tokens=max(2048, session_def["duration_min"] * 130 * 2),
        )
        for marker in ["---END---", "<end_of_script>"]:
            if marker in raw_script:
                raw_script = raw_script[: raw_script.index(marker)].strip()
        raw_scripts[session_code] = sanitize_narration_script(raw_script)
        logger.info(
            "Course script generated",
            extra={
                "job_id": ctx.job.get("id"),
                "session_code": session_code,
                "index": index,
            },
        )
        ctx.progress(f"Generated script {index + 1}/{len(SESSION_DEFS)} ({session_code})")

    preview = {key: f"{value[:200]}..." for key, value in raw_scripts.items()}
    regeneration = _course_regeneration(runtime, job_data)
    script_approval = _course_script_approval(runtime, job_data)
    await_regeneration_script_approval = (
        bool(regeneration.get("active"))
        and str(regeneration.get("mode") or "").strip().lower() == "script_and_audio"
        and not bool(regeneration.get("scriptApprovedAt") or regeneration.get("scriptApprovedBy"))
    )
    await_initial_script_approval = (
        bool(script_approval.get("enabled"))
        and not bool(script_approval.get("scriptApprovedAt") or script_approval.get("scriptApprovedBy"))
    )
    if await_regeneration_script_approval:
        # Regeneration approval is narrower than initial approval: only the
        # targeted sessions need review, but the flow shape is the same.
        regeneration["awaitingScriptApproval"] = True
        target_session_codes = regeneration.get("targetSessionCodes") or []
        target_count = len(target_session_codes) if isinstance(target_session_codes, list) else 0
        progress_label = (
            f"Scripts ready for approval ({target_count} session{'s' if target_count != 1 else ''})"
        )
        return StepResult(
            output={"script_count": len(raw_scripts), "awaiting_script_approval": True},
            runtime_patch={
                "course_raw_scripts": raw_scripts,
                "course_regeneration": regeneration,
            },
            summary_patch={
                "currentStep": "generate_course_scripts",
                "awaitingScriptApproval": True,
            },
            compat_content_job_patch={
                "status": "completed",
                "generatedScript": json.dumps(preview, indent=2),
                "courseRawScripts": raw_scripts,
                "courseProgress": progress_label,
                "jobRunId": ctx.run_id,
                "courseRegeneration": regeneration,
            },
        )
    if await_initial_script_approval:
        script_approval["awaitingApproval"] = True
        progress_label = (
            f"Scripts ready for approval ({len(SESSION_DEFS)} session{'s' if len(SESSION_DEFS) != 1 else ''})"
        )
        return StepResult(
            output={"script_count": len(raw_scripts), "awaiting_script_approval": True},
            runtime_patch={
                "course_raw_scripts": raw_scripts,
                "course_script_approval": script_approval,
            },
            summary_patch={
                "currentStep": "generate_course_scripts",
                "awaitingScriptApproval": True,
            },
            compat_content_job_patch={
                "status": "completed",
                "generatedScript": json.dumps(preview, indent=2),
                "courseRawScripts": raw_scripts,
                "courseProgress": progress_label,
                "jobRunId": ctx.run_id,
                "courseScriptApproval": script_approval,
            },
        )

    return StepResult(
        output={"script_count": len(raw_scripts)},
        runtime_patch={"course_raw_scripts": raw_scripts},
        summary_patch={"currentStep": "generate_course_scripts"},
        compat_content_job_patch={
            "status": "llm_generating",
            "generatedScript": json.dumps(preview, indent=2),
            "courseRawScripts": raw_scripts,
            "courseProgress": f"Scripts {len(raw_scripts)}/{len(SESSION_DEFS)}",
            "jobRunId": ctx.run_id,
        },
    )


def execute_format_course_scripts(ctx: StepContext) -> StepResult:
    """Normalize each raw session script so TTS receives cleaner narration text."""
    from factory_v2.shared.qa_formatter import format_script

    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    course_code = _course_code(job_data)
    raw_scripts: dict[str, str] = dict(runtime.get("course_raw_scripts") or job_data.get("courseRawScripts") or {})
    if not raw_scripts:
        raise ValueError("Missing runtime.course_raw_scripts")

    formatted_scripts: dict[str, str] = dict(
        runtime.get("course_formatted_scripts") or job_data.get("courseFormattedScripts") or {}
    )

    for session_def in SESSION_DEFS:
        session_code = f"{course_code}{session_def['suffix']}"
        if formatted_scripts.get(session_code, "").strip():
            continue

        script = raw_scripts.get(session_code, "").strip()
        if not script:
            raise ValueError(f"Missing raw script for {session_code}")

        try:
            formatted = format_script(script, job_data)
        except ValueError:
            formatted = script

        formatted_scripts[session_code] = formatted
        ctx.progress(f"Formatted script {session_code}")

    return StepResult(
        output={"formatted_count": len(formatted_scripts)},
        runtime_patch={"course_formatted_scripts": formatted_scripts},
        summary_patch={"currentStep": "format_course_scripts"},
        compat_content_job_patch={
            "status": "tts_pending",
            "courseFormattedScripts": formatted_scripts,
            "courseProgress": "Queued course audio generation",
            "jobRunId": ctx.run_id,
            "ttsPendingAt": fs.SERVER_TIMESTAMP,
        },
    )
