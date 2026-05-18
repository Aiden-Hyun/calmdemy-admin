"""Runtime registry that maps persisted step names to Python callables.

Architectural Role:
    Pipeline Step -- this is the single lookup table the claim-loop
    orchestrator uses to resolve a step name stored in Firestore (e.g.
    ``"generate_script"``) into the actual Python function that performs
    the work.

Design Patterns:
    * **Registry Pattern** -- ``EXECUTOR_PATHS`` acts as a static service
      registry.  Each entry is a ``(module_name, function_name)`` pair that
      is lazily resolved at call time via ``importlib.import_module``.  This
      lazy import avoids pulling heavy dependencies (LLM clients, TTS models)
      at startup and keeps worker boot times fast.
    * **Indirection / Loose Coupling** -- the orchestrator never imports step
      modules directly; it always goes through ``get_executor()``.  Adding a
      new step only requires a one-line entry here.

Key Dependencies:
    * ``importlib`` -- for deferred module loading.
    * ``.base.StepContext``, ``.base.StepResult`` -- the type-alias
      ``StepExecutor`` is defined in terms of these containers.

Consumed By:
    * ``factory_v2.claim_loop`` -- calls ``get_executor(step_name)`` to
      obtain the callable, then invokes it with a populated ``StepContext``.
"""

from __future__ import annotations

from importlib import import_module
from collections.abc import Callable

from .base import StepContext, StepResult


# Type alias for every step executor's signature: takes a context, returns a result.
StepExecutor = Callable[[StepContext], StepResult]


# ---------------------------------------------------------------------------
# EXECUTOR_PATHS -- the canonical registry of all pipeline steps
# ---------------------------------------------------------------------------
# Each key is the step name persisted in ``factory_jobs.steps[].name``.
# Each value is a ``(module_name, function_name)`` tuple resolved lazily
# via ``import_module``.  The module names are *relative* to this package
# (``factory_v2.steps``).
#
# Steps are grouped by workflow type:
#   - Single-content steps: script -> format -> image -> TTS -> publish
#   - Course steps:         plan -> thumbnail -> scripts -> format -> TTS -> upload -> publish
#   - Subject steps:        plan -> launch children -> watch children
# ---------------------------------------------------------------------------

EXECUTOR_PATHS: dict[str, tuple[str, str]] = {
    # -- Single-content pipeline (guided meditations, bedtime stories, etc.) --
    "generate_script": ("single_content", "execute_generate_script"),
    "format_script": ("single_content", "execute_format_script"),
    "generate_image": ("single_content", "execute_generate_image"),
    "synthesize_audio": ("single_content", "execute_synthesize_audio"),
    "synthesize_audio_chunk": ("single_content", "execute_synthesize_audio_chunk"),
    "assemble_audio": ("single_content", "execute_assemble_audio"),
    "post_process_audio": ("single_content", "execute_post_process_audio"),
    "upload_audio": ("single_content", "execute_upload_audio"),
    "publish_content": ("single_content", "execute_publish_content"),
    # -- Course pipeline (multi-session educational content) --
    "generate_course_plan": ("course", "execute_generate_course_plan"),
    "generate_course_thumbnail": ("course", "execute_generate_course_thumbnail"),
    "generate_course_scripts": ("course", "execute_generate_course_scripts"),
    "format_course_scripts": ("course", "execute_format_course_scripts"),
    "synthesize_course_audio_chunk": ("course", "execute_synthesize_course_audio_chunk"),
    "synthesize_course_audio": ("course", "execute_synthesize_course_audio"),
    "upload_course_audio": ("course", "execute_upload_course_audio"),
    "publish_course": ("course", "execute_publish_course"),
    # -- Subject pipeline (orchestrates multiple child course jobs) --
    "generate_subject_plan": ("subject", "execute_generate_subject_plan"),
    "launch_subject_children": ("subject", "execute_launch_subject_children"),
    "watch_subject_children": ("subject", "execute_watch_subject_children"),
}


def get_executor(step_name: str) -> StepExecutor:
    """Resolve the executor for a stored step name and fail loudly if it is missing.

    Args:
        step_name: The registry key persisted in the ``factory_jobs`` document,
            e.g. ``"generate_script"`` or ``"synthesize_course_audio_chunk"``.

    Returns:
        The matching callable with signature ``(StepContext) -> StepResult``.

    Raises:
        KeyError: If the step name is not in ``EXECUTOR_PATHS`` or if the
            target function cannot be found in the resolved module.
    """
    target = EXECUTOR_PATHS.get(step_name)
    if target is None:
        raise KeyError(f"No executor registered for step '{step_name}'")

    module_name, function_name = target
    # Lazy import: the module (and its heavy deps) is only loaded the first
    # time this step is actually needed.  Python caches the import so
    # subsequent calls are effectively free.
    module = import_module(f".{module_name}", package=__package__)
    executor = getattr(module, function_name, None)
    if executor is None:
        raise KeyError(
            f"Executor function '{function_name}' missing for step '{step_name}'"
        )
    return executor
