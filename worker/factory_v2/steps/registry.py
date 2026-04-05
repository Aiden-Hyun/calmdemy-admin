"""Runtime registry that maps persisted step names to Python callables."""

from __future__ import annotations

from importlib import import_module
from collections.abc import Callable

from .base import StepContext, StepResult


StepExecutor = Callable[[StepContext], StepResult]


EXECUTOR_PATHS: dict[str, tuple[str, str]] = {
    "generate_script": ("single_content", "execute_generate_script"),
    "format_script": ("single_content", "execute_format_script"),
    "generate_image": ("single_content", "execute_generate_image"),
    "synthesize_audio": ("single_content", "execute_synthesize_audio"),
    "post_process_audio": ("single_content", "execute_post_process_audio"),
    "upload_audio": ("single_content", "execute_upload_audio"),
    "publish_content": ("single_content", "execute_publish_content"),
    "generate_course_plan": ("course", "execute_generate_course_plan"),
    "generate_course_thumbnail": ("course", "execute_generate_course_thumbnail"),
    "generate_course_scripts": ("course", "execute_generate_course_scripts"),
    "format_course_scripts": ("course", "execute_format_course_scripts"),
    "synthesize_course_audio_chunk": ("course", "execute_synthesize_course_audio_chunk"),
    "synthesize_course_audio": ("course", "execute_synthesize_course_audio"),
    "upload_course_audio": ("course", "execute_upload_course_audio"),
    "publish_course": ("course", "execute_publish_course"),
    "generate_subject_plan": ("subject", "execute_generate_subject_plan"),
    "launch_subject_children": ("subject", "execute_launch_subject_children"),
    "watch_subject_children": ("subject", "execute_watch_subject_children"),
}


def get_executor(step_name: str) -> StepExecutor:
    """Resolve the executor for a stored step name and fail loudly if it is missing."""
    target = EXECUTOR_PATHS.get(step_name)
    if target is None:
        raise KeyError(f"No executor registered for step '{step_name}'")

    module_name, function_name = target
    module = import_module(f".{module_name}", package=__package__)
    executor = getattr(module, function_name, None)
    if executor is None:
        raise KeyError(
            f"Executor function '{function_name}' missing for step '{step_name}'"
        )
    return executor
