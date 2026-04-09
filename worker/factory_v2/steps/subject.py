"""Subject workflow steps that plan, launch, and supervise child course jobs.

Architectural Role:
    Pipeline Step -- implements the **subject pipeline**, which orchestrates
    the creation of multiple courses under a single therapy subject (e.g.
    "Cognitive Behavioral Therapy").  The three steps are:
    (1) ``generate_subject_plan`` -- uses an LLM to produce a lineup of
        courses across difficulty levels (100-400),
    (2) ``launch_subject_children`` -- creates child ``content_jobs``
        documents in Firestore for each course,
    (3) ``watch_subject_children`` -- polls child jobs, launches more as
        slots free up, and decides whether to requeue or terminate.

Design Patterns:
    * **Supervisor / Child-Job Orchestration** -- the subject job is a
      *parent* that creates and monitors independent *child* course jobs.
      Each child runs the full course pipeline autonomously.
    * **Bounded Concurrency** -- ``max_active_children`` limits how many
      child jobs run simultaneously, preventing resource exhaustion.
    * **Self-Healing LLM Loop** -- ``_build_subject_plan`` retries up to
      ``MAX_SUBJECT_PLAN_ATTEMPTS`` times, sending repair prompts that
      include already-accepted courses and the specific missing counts.
    * **Polling via Requeue** -- ``watch_subject_children`` returns
      ``requeue_after_seconds=15`` so the claim loop schedules another
      poll, rather than busy-waiting.

Key Dependencies:
    * ``factory_v2.shared.llm_generator`` -- LLM adapter for plan generation
    * ``course_common`` -- shared job extractors
    * Firestore -- child-job creation, subject document reads

Consumed By:
    * ``registry.py`` -- maps ``generate_subject_plan``,
      ``launch_subject_children``, ``watch_subject_children`` here.
"""

from __future__ import annotations

import ast
import json
import os
import re
from typing import Any

from firebase_admin import firestore as fs

from .base import StepContext, StepResult
from .course_common import _content_job_data, _content_job_id, _runtime


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default child-job status counters (zero state).
DEFAULT_CHILD_COUNTS = {
    "pending": 0,
    "running": 0,
    "completed": 0,
    "failed": 0,
}

# Statuses that mean a child course job is still in progress.
ACTIVE_CHILD_STATUSES = {
    "pending",
    "llm_generating",
    "qa_formatting",
    "image_generating",
    "tts_pending",
    "tts_converting",
    "post_processing",
    "uploading",
    "publishing",
}

# Statuses that mean a child course job has finished (success or failure).
TERMINAL_CHILD_STATUSES = {"completed", "failed"}
# Valid course difficulty levels (100 = beginner, 400 = advanced).
VALID_LEVELS = (100, 200, 300, 400)
# How many LLM attempts are allowed to produce a valid subject lineup.
MAX_SUBJECT_PLAN_ATTEMPTS = 4


def _load_system_prompt() -> str:
    """Load the subject-plan system prompt from the ``system_prompts/`` directory."""
    prompt_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "system_prompts",
        "full_subject_system_prompt.txt",
    )
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read().strip()


def _subject_plan_approval(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, Any]:
    """Read the subject-plan approval config (runtime > job data)."""
    payload = runtime.get("subject_plan_approval")
    if isinstance(payload, dict):
        return dict(payload)
    payload = job_data.get("subjectPlanApproval")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def _subject_plan(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, Any]:
    """Read the subject lineup plan (runtime > job data)."""
    payload = runtime.get("subject_plan")
    if isinstance(payload, dict):
        return dict(payload)
    payload = job_data.get("subjectPlan")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def _subject_counts(runtime: dict[str, Any], job_data: dict[str, Any]) -> dict[str, int]:
    """Read the child-job status counters (pending/running/completed/failed)."""
    payload = runtime.get("child_counts")
    if isinstance(payload, dict):
        return {
            "pending": int(payload.get("pending") or 0),
            "running": int(payload.get("running") or 0),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
        }
    payload = job_data.get("childCounts")
    if isinstance(payload, dict):
        return {
            "pending": int(payload.get("pending") or 0),
            "running": int(payload.get("running") or 0),
            "completed": int(payload.get("completed") or 0),
            "failed": int(payload.get("failed") or 0),
        }
    return dict(DEFAULT_CHILD_COUNTS)


def _live_content_job(ctx: StepContext) -> dict[str, Any]:
    """Fetch the latest version of the legacy content_job from Firestore.

    The watch step reads the *live* document (not the snapshot cached in
    ``ctx.job``) so it can detect admin actions (pause, resume) that
    occurred after the job was claimed.
    """
    content_job_id = _content_job_id(ctx.job)
    if not content_job_id:
        return {}
    snap = ctx.db.collection("content_jobs").document(content_job_id).get()
    if not snap.exists:
        return {}
    return snap.to_dict() or {}


def _load_subject(ctx: StepContext, subject_id: str) -> dict[str, Any]:
    """Load the subject metadata (label, description, etc.) from Firestore."""
    snap = ctx.db.collection("subjects").document(subject_id).get()
    if not snap.exists:
        raise ValueError(f"Subject '{subject_id}' not found")
    data = snap.to_dict() or {}
    return {"id": snap.id, **data}


def _level_counts(job_data: dict[str, Any]) -> dict[int, int]:
    """Parse the per-level course counts from job params (e.g. l100=3, l200=2)."""
    params = job_data.get("params") or {}
    raw_counts = params.get("levelCounts") or {}
    counts = {
        100: max(0, int(raw_counts.get("l100") or 0)),
        200: max(0, int(raw_counts.get("l200") or 0)),
        300: max(0, int(raw_counts.get("l300") or 0)),
        400: max(0, int(raw_counts.get("l400") or 0)),
    }
    if sum(counts.values()) <= 0:
        raise ValueError("Full subject levelCounts must add up to at least one course")
    return counts


def _extract_json_object(text: str) -> str:
    """Extract the first balanced ``{...}`` block from arbitrary LLM output."""
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
    """Normalize smart quotes and trailing commas for ``json.loads``."""
    cleaned = text
    cleaned = cleaned.replace("“", '"').replace("”", '"')
    cleaned = cleaned.replace("‘", "'").replace("’", "'")
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def _parse_json_payload(raw: str) -> dict[str, Any]:
    """Parse LLM output with the same three-tier fallback as ``_parse_plan``."""
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
            parsed = ast.literal_eval(py_text)
            if isinstance(parsed, dict):
                return parsed
            raise


def _build_subject_plan_prompt(job_data: dict[str, Any], subject: dict[str, Any], counts: dict[int, int]) -> str:
    """Build the initial LLM prompt for generating the full subject course lineup."""
    params = job_data.get("params") or {}
    custom_instructions = str(params.get("customInstructions") or "").strip()
    custom_block = f"Additional instructions: {custom_instructions}\n" if custom_instructions else ""
    system_prompt = _load_system_prompt()

    return f"""{system_prompt}

---

Subject id: {subject.get("id", "")}
Subject label: {subject.get("label", "")}
Subject full name: {subject.get("fullName", subject.get("label", ""))}
Subject description: {subject.get("description", "")}
Required counts:
- 100 level: {counts[100]}
- 200 level: {counts[200]}
- 300 level: {counts[300]}
- 400 level: {counts[400]}
Total courses: {sum(counts.values())}
{custom_block}
Output one overview plus exactly {sum(counts.values())} courses with the required level counts.
Return JSON only.
"""


def _build_subject_plan_repair_prompt(
    job_data: dict[str, Any],
    subject: dict[str, Any],
    accepted_by_level: dict[int, list[dict[str, Any]]],
    missing_counts: dict[int, int],
    last_error: str,
) -> str:
    """Build a repair prompt that tells the LLM which courses are already accepted
    and exactly how many more are needed at each level."""
    params = job_data.get("params") or {}
    custom_instructions = str(params.get("customInstructions") or "").strip()
    custom_block = f"Additional instructions: {custom_instructions}\n" if custom_instructions else ""
    system_prompt = _load_system_prompt()
    accepted_lines = []
    for level in VALID_LEVELS:
        accepted_courses = accepted_by_level[level]
        if not accepted_courses:
            continue
        titles = "; ".join(str(course.get("title") or "").strip() for course in accepted_courses)
        accepted_lines.append(f"- {level} level: {titles}")
    accepted_block = "\n".join(accepted_lines) if accepted_lines else "- none accepted yet"
    missing_lines = "\n".join(
        f"- {level} level: {missing_counts[level]}"
        for level in VALID_LEVELS
        if missing_counts[level] > 0
    )

    return f"""{system_prompt}

---

Subject id: {subject.get("id", "")}
Subject label: {subject.get("label", "")}
Subject full name: {subject.get("fullName", subject.get("label", ""))}
Subject description: {subject.get("description", "")}
Previous validation issue: {last_error}

Already accepted courses. Do not repeat, rename, or paraphrase these titles:
{accepted_block}

You must return ONLY the missing courses needed to complete the lineup.
Missing counts:
{missing_lines}
Total missing courses: {sum(missing_counts.values())}
{custom_block}
Return JSON only using the same schema.
The courses array must contain exactly {sum(missing_counts.values())} courses.
Every course must belong to one of the missing levels above.
"""


def _coerce_level(value: Any) -> int:
    """Convert a level value (int, string like ``"200"``, or ``"Level 200"``) to an int."""
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    match = re.search(r"(100|200|300|400)", text)
    if not match:
        raise ValueError(f"Unsupported level '{value}'")
    return int(match.group(1))


def _extract_course_candidates(raw_courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate and normalize raw course entries from LLM output.

    Filters out entries with missing fields or invalid levels, and caps
    learning goals and prerequisites at 3 items each.
    """
    candidates: list[dict[str, Any]] = []
    for raw_course in raw_courses:
        if not isinstance(raw_course, dict):
            continue
        try:
            level = _coerce_level(raw_course.get("level"))
        except ValueError:
            continue
        title = str(raw_course.get("title") or "").strip()
        description = str(raw_course.get("description") or "").strip()
        if not title or not description:
            continue
        learning_goals = [
            str(goal).strip()
            for goal in list(raw_course.get("learningGoals") or [])
            if str(goal).strip()
        ]
        prerequisites = [
            str(item).strip()
            for item in list(raw_course.get("prerequisites") or [])
            if str(item).strip()
        ]
        candidates.append(
            {
                "level": level,
                "title": title,
                "description": description,
                "learningGoals": learning_goals[:3],
                "prerequisites": prerequisites[:3],
            }
        )
    return candidates


def _append_unique_courses(
    accepted_by_level: dict[int, list[dict[str, Any]]],
    candidates: list[dict[str, Any]],
    required_counts: dict[int, int],
) -> None:
    """Add courses to the accepted pool, deduplicating by title (case-insensitive).

    Stops adding to a level once it reaches its required count.  This is used
    both on the initial generation pass and on repair passes.
    """
    seen_titles = {
        str(course.get("title") or "").strip().casefold()
        for level in VALID_LEVELS
        for course in accepted_by_level[level]
    }
    for candidate in candidates:
        level = int(candidate["level"])
        if len(accepted_by_level[level]) >= required_counts[level]:
            continue
        title_key = str(candidate.get("title") or "").strip().casefold()
        if not title_key or title_key in seen_titles:
            continue
        accepted_by_level[level].append(candidate)
        seen_titles.add(title_key)


def _missing_level_counts(
    accepted_by_level: dict[int, list[dict[str, Any]]],
    required_counts: dict[int, int],
) -> dict[int, int]:
    """Calculate how many more courses are needed at each level."""
    return {
        level: max(0, required_counts[level] - len(accepted_by_level[level]))
        for level in VALID_LEVELS
    }


def _describe_missing_level_counts(missing_counts: dict[int, int]) -> str:
    parts = [
        f"{level}:{count}"
        for level, count in missing_counts.items()
        if count > 0
    ]
    return ", ".join(parts) if parts else "none"


def _flatten_subject_courses(
    accepted_by_level: dict[int, list[dict[str, Any]]],
    required_counts: dict[int, int],
) -> list[dict[str, Any]]:
    """Flatten the per-level accepted courses into a single ordered list."""
    normalized: list[dict[str, Any]] = []
    for level in VALID_LEVELS:
        candidates = accepted_by_level[level]
        required = required_counts[level]
        if len(candidates) < required:
            raise ValueError(f"Model returned only {len(candidates)} courses for level {level}")
        normalized.extend(candidates[:required])
    return normalized


def _normalize_courses(raw_courses: list[dict[str, Any]], required_counts: dict[int, int]) -> list[dict[str, Any]]:
    """Validate, deduplicate, and group raw LLM courses by level."""
    grouped: dict[int, list[dict[str, Any]]] = {level: [] for level in VALID_LEVELS}
    _append_unique_courses(grouped, _extract_course_candidates(raw_courses), required_counts)
    normalized: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for level in VALID_LEVELS:
        candidates = grouped[level]
        required = required_counts[level]
        if len(candidates) < required:
            raise ValueError(f"Model returned only {len(candidates)} courses for level {level}")
        for candidate in candidates[:required]:
            title_key = candidate["title"].strip().casefold()
            if title_key in seen_titles:
                raise ValueError(f"Duplicate course title '{candidate['title']}' in subject lineup")
            seen_titles.add(title_key)
            normalized.append(candidate)
    return normalized


def _course_code_exists(db, code: str) -> bool:
    """Check if a course code is already in use (published or in-progress)."""
    code = str(code or "").strip().upper()
    if not code:
        return False

    courses_q = db.collection("courses").where("code", "==", code).limit(1)
    if any(courses_q.stream()):
        return True

    jobs_q = db.collection("content_jobs").where("params.courseCode", "==", code).limit(20)
    for snap in jobs_q.stream():
        data = snap.to_dict() or {}
        if data.get("contentType") != "course":
            continue
        if data.get("deleteRequested"):
            continue
        if str(data.get("status") or "").strip().lower() == "failed":
            continue
        return True
    return False


def _code_prefix(job_data: dict[str, Any]) -> str:
    """Derive the course-code prefix from the subject label (e.g. ``"CBT"``)."""
    params = job_data.get("params") or {}
    label = str(params.get("subjectLabel") or params.get("subjectId") or "COURSE").strip().upper()
    prefix = re.sub(r"[^A-Z0-9]", "", label)
    return prefix or "COURSE"


def _level_number_candidates(level: int) -> list[int]:
    """Generate candidate course numbers for a level (e.g. 101, 110, 120, ..., 102, 103, ...)."""
    preferred_suffixes = [1] + [offset for offset in range(10, 100, 10)]
    remaining_suffixes = [
        offset
        for offset in range(2, 100)
        if offset not in preferred_suffixes
    ]
    return [level + suffix for suffix in preferred_suffixes + remaining_suffixes]


def _assign_codes(db, job_data: dict[str, Any], courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Assign unique course codes (e.g. ``CBT101``, ``CBT201``) to each course.

    Codes are checked against both the ``courses`` and ``content_jobs``
    collections to avoid collisions with existing or in-progress courses.
    """
    prefix = _code_prefix(job_data)
    number_candidates = {
        100: _level_number_candidates(100),
        200: _level_number_candidates(200),
        300: _level_number_candidates(300),
        400: _level_number_candidates(400),
    }
    next_indexes = {
        100: 0,
        200: 0,
        300: 0,
        400: 0,
    }
    used_codes: set[str] = set()
    assigned: list[dict[str, Any]] = []
    for sequence, course in enumerate(courses, start=1):
        level = int(course["level"])
        candidates = number_candidates[level]
        candidate_index = next_indexes[level]
        while candidate_index < len(candidates):
            number = candidates[candidate_index]
            code = f"{prefix}{number}"
            if code not in used_codes and not _course_code_exists(db, code):
                break
            candidate_index += 1
        else:
            raise ValueError(f"No available course codes remain in the {level} band for prefix {prefix}")
        next_indexes[level] = candidate_index + 1
        used_codes.add(code)
        assigned.append(
            {
                **course,
                "sequence": sequence,
                "code": code,
                "childJobId": None,
                "childStatus": None,
                "childError": None,
            }
        )
    return assigned


def _build_subject_plan(ctx: StepContext, job_data: dict[str, Any]) -> dict[str, Any]:
    """Generate a validated subject lineup, retrying with repair prompts if needed.

    Self-healing loop:
        1. Send the initial prompt asking for all courses at all levels.
        2. Validate the response: extract valid courses, deduplicate, and
           check per-level counts.
        3. If any levels are still short, send a *repair* prompt that lists
           already-accepted courses and the exact missing counts.
        4. Repeat up to ``MAX_SUBJECT_PLAN_ATTEMPTS`` times.
        5. After the loop, assign unique course codes and return the plan.
    """
    from factory_v2.shared.llm_generator import _get_llm_adapter

    counts = _level_counts(job_data)
    subject_id = str((job_data.get("params") or {}).get("subjectId") or "").strip()
    subject = _load_subject(ctx, subject_id)
    adapter = _get_llm_adapter(job_data)
    # Accumulator: courses accepted so far, grouped by level.
    accepted_by_level: dict[int, list[dict[str, Any]]] = {level: [] for level in VALID_LEVELS}
    overview = ""
    last_error = ""

    for attempt in range(1, MAX_SUBJECT_PLAN_ATTEMPTS + 1):
        missing_counts = _missing_level_counts(accepted_by_level, counts)
        if all(count == 0 for count in missing_counts.values()):
            break

        if attempt == 1:
            prompt = _build_subject_plan_prompt(job_data, subject, counts)
            ctx.progress("Generating subject lineup")
        else:
            prompt = _build_subject_plan_repair_prompt(
                job_data,
                subject,
                accepted_by_level,
                missing_counts,
                last_error or f"Missing required levels: {_describe_missing_level_counts(missing_counts)}",
            )
            ctx.progress(
                f"Repairing subject lineup ({attempt}/{MAX_SUBJECT_PLAN_ATTEMPTS})"
            )

        try:
            raw = adapter.generate(prompt, max_tokens=8192)
            parsed = _parse_json_payload(raw)
            next_overview = str(parsed.get("overview") or "").strip()
            if next_overview:
                overview = next_overview
            candidates = _extract_course_candidates(list(parsed.get("courses") or []))
            if not candidates:
                raise ValueError("Model returned no usable courses")
            _append_unique_courses(accepted_by_level, candidates, counts)
            missing_counts = _missing_level_counts(accepted_by_level, counts)
            if all(count == 0 for count in missing_counts.values()):
                break
            last_error = (
                "Still missing required levels after validation: "
                f"{_describe_missing_level_counts(missing_counts)}"
            )
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"

    final_missing_counts = _missing_level_counts(accepted_by_level, counts)
    if any(count > 0 for count in final_missing_counts.values()):
        raise ValueError(
            "Unable to generate the required subject lineup after "
            f"{MAX_SUBJECT_PLAN_ATTEMPTS} attempts. Missing levels: "
            f"{_describe_missing_level_counts(final_missing_counts)}"
        )

    normalized_courses = _flatten_subject_courses(accepted_by_level, counts)
    assigned_courses = _assign_codes(ctx.db, job_data, normalized_courses)

    return {
        "subjectId": subject_id,
        "subjectLabel": str(subject.get("label") or subject_id),
        "overview": overview,
        "courses": assigned_courses,
    }


def _max_active_children(runtime: dict[str, Any], job_data: dict[str, Any]) -> int:
    """Read the concurrency limit for child course jobs (default: 2)."""
    raw = runtime.get("max_active_child_courses")
    if raw is None:
        raw = job_data.get("maxActiveChildCourses")
    value = int(raw or 2)
    return max(1, value)


def _launch_cursor(runtime: dict[str, Any], job_data: dict[str, Any]) -> int:
    """Read the launch cursor -- index of the next course to launch."""
    raw = runtime.get("launch_cursor")
    if raw is None:
        raw = job_data.get("launchCursor")
    return max(0, int(raw or 0))


def _launch_scan_cursor(plan: dict[str, Any], runtime: dict[str, Any], job_data: dict[str, Any]) -> int:
    total_courses = len(list(plan.get("courses") or []))
    return min(_launch_cursor(runtime, job_data), total_courses)


def _child_jobs(ctx: StepContext) -> list[dict[str, Any]]:
    """Fetch all child content_jobs that belong to this parent subject job."""
    parent_job_id = _content_job_id(ctx.job)
    query = ctx.db.collection("content_jobs").where("parentJobId", "==", parent_job_id)
    return [{"id": snap.id, **(snap.to_dict() or {})} for snap in query.stream()]


def _compute_child_counts(child_jobs: list[dict[str, Any]]) -> dict[str, int]:
    """Bucket child jobs into pending/running/completed/failed counters."""
    counts = dict(DEFAULT_CHILD_COUNTS)
    for child_job in child_jobs:
        status = str(child_job.get("status") or "").strip().lower()
        if status == "completed":
            counts["completed"] += 1
        elif status == "failed":
            counts["failed"] += 1
        elif status == "pending":
            counts["pending"] += 1
        else:
            counts["running"] += 1
    return counts


def _sync_plan_children(plan: dict[str, Any], child_jobs: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """Reconcile the plan's course list with the actual child jobs in Firestore.

    Each course entry in the plan is updated with the matching child job's
    ID, status, and error (if any).  Returns the updated plan and the list
    of child job IDs for storage.
    """
    children_by_course_code = {}
    for child_job in child_jobs:
        course_code = str(((child_job.get("params") or {}).get("courseCode") or "")).strip()
        if course_code:
            children_by_course_code[course_code] = child_job

    child_job_ids: list[str] = []
    next_courses: list[dict[str, Any]] = []
    for course in list(plan.get("courses") or []):
        next_course = dict(course)
        child_job = None
        if next_course.get("childJobId"):
            child_job = next((job for job in child_jobs if job.get("id") == next_course.get("childJobId")), None)
        if child_job is None:
            child_job = children_by_course_code.get(str(next_course.get("code") or "").strip())
        if child_job:
            next_course["childJobId"] = child_job["id"]
            next_course["childStatus"] = str(child_job.get("status") or "").strip() or None
            next_course["childError"] = str(child_job.get("error") or "").strip() or None
            child_job_ids.append(child_job["id"])
        else:
            next_course.pop("childJobId", None)
            next_course.pop("childStatus", None)
            next_course.pop("childError", None)
        next_courses.append(next_course)

    return {**plan, "courses": next_courses}, child_job_ids


def _make_child_course_job(ctx: StepContext, job_data: dict[str, Any], course: dict[str, Any]) -> str:
    """Create a new ``content_jobs`` document for one child course and return its ID.

    The child inherits LLM/TTS config from the parent but gets its own
    course code, title, and description from the generated plan.
    """
    params = job_data.get("params") or {}
    subject_label = str(params.get("subjectLabel") or params.get("subjectId") or "").strip()
    topic = str(course.get("description") or "").strip()
    payload = {
        "status": "pending",
        "llmBackend": job_data.get("llmBackend"),
        "ttsBackend": job_data.get("ttsBackend"),
        "contentType": "course",
        "params": {
            "topic": topic,
            "duration_minutes": 0,
            "customInstructions": params.get("customInstructions"),
            "courseCode": course.get("code"),
            "courseTitle": course.get("title"),
            "subjectId": params.get("subjectId"),
            "subjectLabel": params.get("subjectLabel"),
            "subjectColor": params.get("subjectColor"),
            "subjectIcon": params.get("subjectIcon"),
        },
        "llmModel": job_data.get("llmModel"),
        "ttsModel": job_data.get("ttsModel"),
        "ttsVoice": job_data.get("ttsVoice"),
        "title": course.get("title"),
        "autoPublish": True,
        "generateThumbnailDuringRun": False,
        "courseProgress": "Pending",
        "parentJobId": _content_job_id(ctx.job),
        "createdAt": fs.SERVER_TIMESTAMP,
        "updatedAt": fs.SERVER_TIMESTAMP,
        "createdBy": job_data.get("createdBy"),
    }
    if not subject_label:
        payload["params"].pop("subjectLabel", None)
    payload["params"] = {
        key: value
        for key, value in payload["params"].items()
        if value is not None
    }

    doc_ref = ctx.db.collection("content_jobs").document()
    doc_ref.set(payload)
    return doc_ref.id


def _subject_progress_text(plan: dict[str, Any], counts: dict[str, int], launch_cursor: int, *, paused: bool = False) -> str:
    """Build a human-readable progress string for the admin UI."""
    total = len(list(plan.get("courses") or []))
    if paused:
        return f"Paused after launching {launch_cursor}/{total} child courses"
    if counts["failed"] > 0 and counts["pending"] == 0 and counts["running"] == 0:
        return f"{counts['completed']}/{total} courses completed • {counts['failed']} failed"
    if counts["completed"] >= total and total > 0:
        return f"Completed all {total} courses"
    return (
        f"{counts['completed']}/{total} courses completed • "
        f"{counts['pending'] + counts['running']} active • "
        f"{max(0, total - launch_cursor)} not yet launched"
    )


def execute_generate_subject_plan(ctx: StepContext) -> StepResult:
    """Generate the subject lineup and optionally stop for approval before launching children.

    If the plan already exists in runtime (from a prior run), it is reused.
    Otherwise, ``_build_subject_plan`` is called to generate a fresh lineup
    using the self-healing LLM loop.

    Approval Flow:
        When ``subjectPlanApproval.enabled`` is true and no approval has been
        recorded, the step pauses with ``awaiting_subject_plan_approval`` so
        an admin can review the proposed courses before any child jobs are
        created.
    """
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)

    # Idempotency: reuse an existing plan if available.
    plan = _subject_plan(runtime, job_data)
    if not plan:
        plan = _build_subject_plan(ctx, job_data)
        ctx.progress("Generated subject lineup")

    plan_approval = _subject_plan_approval(runtime, job_data)
    await_approval = (
        bool(plan_approval.get("enabled"))
        and not bool(plan_approval.get("approvedAt") or plan_approval.get("approvedBy"))
    )

    if await_approval:
        plan_approval["awaitingApproval"] = True
        return StepResult(
            output={
                "course_count": len(list(plan.get("courses") or [])),
                "awaiting_subject_plan_approval": True,
            },
            runtime_patch={
                "subject_plan": plan,
                "subject_plan_approval": plan_approval,
                "child_counts": dict(DEFAULT_CHILD_COUNTS),
                "child_job_ids": [],
                "launch_cursor": 0,
                "subject_progress": "Subject lineup ready for approval",
                "subject_state": "awaiting_approval",
            },
            summary_patch={
                "currentStep": "generate_subject_plan",
                "subjectState": "awaiting_approval",
                "courseCount": len(list(plan.get("courses") or [])),
            },
            compat_content_job_patch={
                "status": "completed",
                "subjectPlan": plan,
                "subjectPlanApproval": plan_approval,
                "childCounts": dict(DEFAULT_CHILD_COUNTS),
                "childJobIds": [],
                "launchCursor": 0,
                "subjectProgress": "Subject lineup ready for approval",
                "jobRunId": ctx.run_id,
            },
        )

    return StepResult(
        output={"course_count": len(list(plan.get("courses") or []))},
        runtime_patch={
            "subject_plan": plan,
            "subject_plan_approval": plan_approval or None,
            "child_counts": dict(DEFAULT_CHILD_COUNTS),
            "child_job_ids": [],
            "launch_cursor": 0,
            "subject_progress": "Generated subject lineup. Launching child courses",
            "subject_state": "launching",
        },
        summary_patch={
            "currentStep": "generate_subject_plan",
            "subjectState": "launching",
            "courseCount": len(list(plan.get("courses") or [])),
        },
        compat_content_job_patch={
            "status": "llm_generating",
            "subjectPlan": plan,
            "subjectPlanApproval": plan_approval or None,
            "childCounts": dict(DEFAULT_CHILD_COUNTS),
            "childJobIds": [],
            "launchCursor": 0,
            "subjectProgress": "Generated subject lineup. Launching child courses",
            "jobRunId": ctx.run_id,
        },
    )


def execute_launch_subject_children(ctx: StepContext) -> StepResult:
    """Launch as many child course jobs as the configured concurrency window allows.

    Bounded concurrency:
        The number of simultaneously active child jobs is capped at
        ``max_active_children`` (default 2).  This step fills any available
        slots by creating new ``content_jobs`` documents in Firestore.
        Each child document triggers the standard course pipeline.

    The ``launch_cursor`` tracks which course in the plan to launch next,
    making the step safe to retry without re-launching earlier courses.
    """
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    plan = _subject_plan(runtime, job_data)
    if not plan:
        raise ValueError("Missing runtime.subject_plan")

    # Sync plan with actual Firestore child jobs (some may have been created
    # by a prior run of this step).
    existing_children = _child_jobs(ctx)
    plan, child_job_ids = _sync_plan_children(plan, existing_children)
    launch_cursor = _launch_scan_cursor(plan, runtime, job_data)
    max_active = _max_active_children(runtime, job_data)
    child_counts = _compute_child_counts(existing_children)

    # Calculate how many new child jobs we can launch.
    active_children = child_counts["pending"] + child_counts["running"]
    available_slots = max(0, max_active - active_children)
    next_courses = list(plan.get("courses") or [])

    while available_slots > 0 and launch_cursor < len(next_courses):
        # `launch_cursor` lets the subject job resume safely without re-launching
        # earlier courses if the worker restarts mid-batch.
        course = dict(next_courses[launch_cursor])
        if course.get("childJobId"):
            launch_cursor += 1
            continue
        child_job_id = _make_child_course_job(ctx, job_data, course)
        course["childJobId"] = child_job_id
        course["childStatus"] = "pending"
        next_courses[launch_cursor] = course
        child_job_ids.append(child_job_id)
        launch_cursor += 1
        available_slots -= 1

    plan["courses"] = next_courses
    refreshed_children = _child_jobs(ctx)
    plan, child_job_ids = _sync_plan_children(plan, refreshed_children)
    child_counts = _compute_child_counts(refreshed_children)
    progress = _subject_progress_text(plan, child_counts, launch_cursor)

    return StepResult(
        output={
            "launched_children": len(child_job_ids),
            "launch_cursor": launch_cursor,
        },
        runtime_patch={
            "subject_plan": plan,
            "child_job_ids": child_job_ids,
            "child_counts": child_counts,
            "launch_cursor": launch_cursor,
            "subject_progress": progress,
            "subject_state": "watching",
        },
        summary_patch={
            "currentStep": "launch_subject_children",
            "subjectState": "watching",
            "launchCursor": launch_cursor,
        },
        compat_content_job_patch={
            "status": "llm_generating",
            "subjectPlan": plan,
            "childJobIds": child_job_ids,
            "childCounts": child_counts,
            "launchCursor": launch_cursor,
            "subjectProgress": progress,
            "jobRunId": ctx.run_id,
        },
    )


def execute_watch_subject_children(ctx: StepContext) -> StepResult:
    """Poll child jobs, top up any newly free launch slots, and decide whether to requeue.

    State machine:
        * **watching** -- children still running; requeue in 15 seconds.
        * **paused** -- admin requested a pause; stop launching new children.
        * **failed** -- all children terminal but some failed.
        * **completed** -- all children completed successfully.

    This step also acts as a secondary launcher: when a child finishes and
    frees a slot, the watch step launches the next course from the plan
    (same bounded-concurrency logic as ``launch_subject_children``).
    """
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    # Read the *live* content_job to detect admin pause/resume requests.
    live_job = _live_content_job(ctx)
    plan = _subject_plan(runtime, live_job or job_data)
    if not plan:
        raise ValueError("Missing runtime.subject_plan")

    child_jobs = _child_jobs(ctx)
    plan, child_job_ids = _sync_plan_children(plan, child_jobs)
    child_counts = _compute_child_counts(child_jobs)
    launch_cursor = _launch_scan_cursor(plan, runtime, live_job or job_data)
    max_active = _max_active_children(runtime, live_job or job_data)
    pause_requested = bool((live_job or {}).get("pauseRequested") or runtime.get("pause_requested"))

    if not pause_requested:
        active_children = child_counts["pending"] + child_counts["running"]
        available_slots = max(0, max_active - active_children)
        next_courses = list(plan.get("courses") or [])
        while available_slots > 0 and launch_cursor < len(next_courses):
            course = dict(next_courses[launch_cursor])
            if course.get("childJobId"):
                launch_cursor += 1
                continue
            child_job_id = _make_child_course_job(ctx, job_data, course)
            course["childJobId"] = child_job_id
            course["childStatus"] = "pending"
            next_courses[launch_cursor] = course
            child_job_ids.append(child_job_id)
            launch_cursor += 1
            available_slots -= 1
        plan["courses"] = next_courses
        child_jobs = _child_jobs(ctx)
        plan, child_job_ids = _sync_plan_children(plan, child_jobs)
        child_counts = _compute_child_counts(child_jobs)

    total_courses = len(list(plan.get("courses") or []))
    all_launched = launch_cursor >= total_courses
    all_terminal = all_launched and (child_counts["pending"] + child_counts["running"] == 0)

    if pause_requested:
        paused_progress = _subject_progress_text(plan, child_counts, launch_cursor, paused=True)
        return StepResult(
            output={"paused": True, "launch_cursor": launch_cursor},
            runtime_patch={
                "subject_plan": plan,
                "child_job_ids": child_job_ids,
                "child_counts": child_counts,
                "launch_cursor": launch_cursor,
                "pause_requested": True,
                "subject_progress": paused_progress,
                "subject_state": "paused",
            },
            summary_patch={
                "currentStep": "watch_subject_children",
                "subjectState": "paused",
                "launchCursor": launch_cursor,
            },
            compat_content_job_patch={
                "status": "paused",
                "subjectPlan": plan,
                "childJobIds": child_job_ids,
                "childCounts": child_counts,
                "launchCursor": launch_cursor,
                "pauseRequested": True,
                "pausedAt": fs.SERVER_TIMESTAMP,
                "subjectProgress": paused_progress,
                "jobRunId": ctx.run_id,
            },
        )

    if all_terminal and child_counts["failed"] > 0:
        error = f"{child_counts['failed']} child course job(s) failed"
        failed_progress = _subject_progress_text(plan, child_counts, launch_cursor)
        return StepResult(
            output={"failed_children": child_counts["failed"]},
            runtime_patch={
                "subject_plan": plan,
                "child_job_ids": child_job_ids,
                "child_counts": child_counts,
                "launch_cursor": launch_cursor,
                "subject_progress": failed_progress,
                "subject_state": "failed",
            },
            summary_patch={
                "currentStep": "watch_subject_children",
                "subjectState": "failed",
                "launchCursor": launch_cursor,
            },
            compat_content_job_patch={
                "status": "failed",
                "error": error,
                "errorCode": "child_job_failed",
                "subjectPlan": plan,
                "childJobIds": child_job_ids,
                "childCounts": child_counts,
                "launchCursor": launch_cursor,
                "subjectProgress": failed_progress,
                "jobRunId": ctx.run_id,
            },
        )

    if all_terminal and child_counts["completed"] >= total_courses:
        completed_progress = _subject_progress_text(plan, child_counts, launch_cursor)
        return StepResult(
            output={"completed_children": child_counts["completed"]},
            runtime_patch={
                "subject_plan": plan,
                "child_job_ids": child_job_ids,
                "child_counts": child_counts,
                "launch_cursor": launch_cursor,
                "subject_progress": completed_progress,
                "subject_state": "completed",
            },
            summary_patch={
                "currentStep": "watch_subject_children",
                "subjectState": "completed",
                "launchCursor": launch_cursor,
            },
            compat_content_job_patch={
                "status": "completed",
                "subjectPlan": plan,
                "childJobIds": child_job_ids,
                "childCounts": child_counts,
                "launchCursor": launch_cursor,
                "subjectProgress": completed_progress,
                "jobRunId": ctx.run_id,
            },
        )

    progress = _subject_progress_text(plan, child_counts, launch_cursor)
    return StepResult(
        output={
            "active_children": child_counts["pending"] + child_counts["running"],
            "launch_cursor": launch_cursor,
        },
        runtime_patch={
            "subject_plan": plan,
            "child_job_ids": child_job_ids,
            "child_counts": child_counts,
            "launch_cursor": launch_cursor,
            "subject_progress": progress,
            "subject_state": "watching",
        },
        summary_patch={
            "currentStep": "watch_subject_children",
            "subjectState": "watching",
            "launchCursor": launch_cursor,
        },
        compat_content_job_patch={
            "status": "llm_generating",
            "subjectPlan": plan,
            "childJobIds": child_job_ids,
            "childCounts": child_counts,
            "launchCursor": launch_cursor,
            "subjectProgress": progress,
            "jobRunId": ctx.run_id,
        },
        # Self-requeue: the claim loop will schedule another poll in 15 seconds
        # so the subject job keeps monitoring child progress.
        requeue_after_seconds=15,
    )
