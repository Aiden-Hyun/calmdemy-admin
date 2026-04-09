"""Workflow definitions for each V2 job type and the edges between their steps.

Architectural Role:
    Application / Service Layer -- pure data definitions that describe *what*
    steps exist and how they depend on each other.  The Orchestrator (see
    ``orchestrator.py``) consults these specs at runtime to decide which step
    to enqueue next.

Design Patterns:
    * **Directed Acyclic Graph (DAG) scheduling** -- each ``WorkflowSpec``
      models a step pipeline as a DAG.  Steps are nodes; ``edges`` are
      directed arcs from a predecessor to its successors.  The orchestrator
      only enqueues a successor when *all* of its prerequisites have
      succeeded (join semantics).
    * **Static data + dynamic overrides** -- the DAGs here capture the
      *common* happy path.  Complex branching (e.g. chunked-audio fan-out,
      thumbnail parallelism) is handled by the Orchestrator's ``on_step_success``
      method, which bypasses static edges when it needs to.
    * **Strategy-like selection** -- ``workflow_for_job_type`` acts as a
      simple factory/strategy selector, mapping a job's persisted type string
      to the correct DAG.

Key Dependencies:
    None -- this module is intentionally dependency-free so it can be imported
    anywhere (orchestrator, recovery, tests) without side effects.

Consumed By:
    * ``Orchestrator.start_new_run``  -- to find the first step.
    * ``Orchestrator.on_step_success`` -- to look up next steps and
      prerequisites after a step completes.
    * ``CommandService.approve_publish`` (indirectly via the orchestrator).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class WorkflowSpec:
    """Static, immutable description of a workflow as a directed acyclic graph (DAG).

    Attributes:
        name: Human-readable identifier (e.g. ``"single_content"``).
        steps: Ordered list of step names.  This is the *display* order
            humans expect to read in the admin UI -- it does NOT imply
            execution order.  The ``edges`` dict is the authoritative
            dependency graph.
        edges: Adjacency list mapping a step to the list of steps that
            may run after it succeeds.  Missing keys mean the step has
            no static successors (the orchestrator may still schedule
            work dynamically).
        terminal_step: The step whose success means the entire workflow
            is complete.  Used by the orchestrator to decide when to mark
            the run and job as finished.
    """

    name: str
    steps: list[str]
    edges: dict[str, list[str]] = field(default_factory=dict)
    terminal_step: str = ""

    def next_steps(self, step_name: str) -> list[str]:
        """Return the direct successors that may be scheduled after *step_name* succeeds.

        Args:
            step_name: The step that just completed successfully.

        Returns:
            A list of step names (possibly empty) that are candidates for
            scheduling.  The orchestrator still checks prerequisites before
            actually enqueuing any of them.
        """
        return list(self.edges.get(step_name, []))

    def prerequisites(self, step_name: str) -> list[str]:
        """Return the direct predecessors that must succeed before *step_name* can run.

        This performs a reverse lookup on ``edges`` -- it scans every source
        node and collects those whose target list contains *step_name*.

        Args:
            step_name: The step we want to know the prerequisites for.

        Returns:
            A list of step names that must all have succeeded before the
            orchestrator should enqueue *step_name*.
        """
        required: list[str] = []
        for source, targets in self.edges.items():
            if step_name in targets:
                required.append(source)
        return required


# ---------------------------------------------------------------------------
# Workflow DAG instances
# ---------------------------------------------------------------------------
# Each constant below defines the step pipeline for one job type.  Read the
# ``edges`` dict as: "after step X succeeds, step Y becomes a candidate."
# ---------------------------------------------------------------------------

SINGLE_CONTENT_WORKFLOW = WorkflowSpec(
    name="single_content",
    # The steps list is the *linear* happy-path a human would read:
    #   script -> format -> image + audio (parallel) -> publish
    steps=[
        "generate_script",
        "format_script",
        "generate_image",
        "synthesize_audio",
        "synthesize_audio_chunk",
        "assemble_audio",
        "post_process_audio",
        "upload_audio",
        "publish_content",
    ],
    edges={
        "generate_script": ["format_script"],
        # NOTE: format_script has NO static successor here.  The orchestrator
        # dynamically decides between two audio paths at runtime:
        #   - Chunked path:  synthesize_audio_chunk -> assemble_audio
        #   - Linear path:   synthesize_audio -> post_process_audio -> upload_audio
        # generate_image is also enqueued in parallel by the orchestrator.
        "generate_image": ["publish_content"],
        "synthesize_audio": ["post_process_audio"],
        "post_process_audio": ["upload_audio"],
        "upload_audio": ["publish_content"],
        # assemble_audio -> publish_content is handled by custom orchestrator
        # logic (not a static edge) to avoid prerequisite conflicts with the
        # upload_audio fallback path.  Both paths converge on publish_content,
        # but only one will be active per run.
    },
    terminal_step="publish_content",
)

COURSE_WORKFLOW = WorkflowSpec(
    name="course",
    # Courses follow a longer linear spine.  Audio synthesis fans out into
    # per-session shards (managed by the orchestrator, not static edges).
    # Thumbnail generation runs in parallel, also orchestrator-managed.
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
    # A subject is a meta-job: it plans child jobs, launches them, then
    # polls until they all finish (or fail).  The "watch" step is a
    # long-running poll that re-enqueues itself until convergence.
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
    """Map a persisted job-type string to its workflow DAG.

    This is the single point of indirection the orchestrator uses to
    obtain the correct ``WorkflowSpec``.  Adding a new job type only
    requires defining a new ``WorkflowSpec`` constant and adding a
    branch here.

    Args:
        job_type: The ``job_type`` field stored on the job document
            (e.g. ``"course"``, ``"subject"``, ``"single_content"``).

    Returns:
        The ``WorkflowSpec`` that describes the step DAG for this job type.
        Defaults to ``SINGLE_CONTENT_WORKFLOW`` for any unrecognised type.
    """
    if job_type == "course":
        return COURSE_WORKFLOW
    if job_type == "subject":
        return SUBJECT_WORKFLOW
    # Default: single-content covers guided meditations, sleep stories, etc.
    return SINGLE_CONTENT_WORKFLOW
