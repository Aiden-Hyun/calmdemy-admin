"""Workflow definitions for each V2 job type and the edges between their steps."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class WorkflowSpec:
    """Static description of a workflow DAG.

    `steps` keeps the happy-path ordering humans expect to read, while `edges`
    is the machine-readable dependency graph the orchestrator actually follows.
    """

    name: str
    steps: list[str]
    edges: dict[str, list[str]] = field(default_factory=dict)
    terminal_step: str = ""

    def next_steps(self, step_name: str) -> list[str]:
        """Return the direct children that may be scheduled after `step_name` succeeds."""
        return list(self.edges.get(step_name, []))

    def prerequisites(self, step_name: str) -> list[str]:
        """Return the direct parent steps that must succeed before `step_name` can run."""
        required: list[str] = []
        for source, targets in self.edges.items():
            if step_name in targets:
                required.append(source)
        return required


SINGLE_CONTENT_WORKFLOW = WorkflowSpec(
    name="single_content",
    steps=[
        "generate_script",
        "format_script",
        "generate_image",
        "synthesize_audio",
        "post_process_audio",
        "upload_audio",
        "publish_content",
    ],
    edges={
        "generate_script": ["format_script"],
        "format_script": ["generate_image", "synthesize_audio"],
        "generate_image": ["publish_content"],
        "synthesize_audio": ["post_process_audio"],
        "post_process_audio": ["upload_audio"],
        "upload_audio": ["publish_content"],
    },
    terminal_step="publish_content",
)

COURSE_WORKFLOW = WorkflowSpec(
    name="course",
    steps=[
        "generate_course_plan",
        "generate_course_thumbnail",
        "generate_course_scripts",
        "format_course_scripts",
        "synthesize_course_audio",
        "upload_course_audio",
        "publish_course",
    ],
    edges={
        "generate_course_plan": ["generate_course_scripts"],
        "generate_course_scripts": ["format_course_scripts"],
        "format_course_scripts": ["synthesize_course_audio"],
        "synthesize_course_audio": ["upload_course_audio"],
        "upload_course_audio": ["publish_course"],
    },
    terminal_step="publish_course",
)

SUBJECT_WORKFLOW = WorkflowSpec(
    name="subject",
    steps=[
        "generate_subject_plan",
        "launch_subject_children",
        "watch_subject_children",
    ],
    edges={
        "generate_subject_plan": ["launch_subject_children"],
        "launch_subject_children": ["watch_subject_children"],
    },
    terminal_step="watch_subject_children",
)


def workflow_for_job_type(job_type: str) -> WorkflowSpec:
    """Map persisted job types to the workflow spec the orchestrator should use."""
    if job_type == "course":
        return COURSE_WORKFLOW
    if job_type == "subject":
        return SUBJECT_WORKFLOW
    return SINGLE_CONTENT_WORKFLOW
