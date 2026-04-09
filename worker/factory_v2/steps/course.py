"""Convenience re-export module for all course-related step executors.

Architectural Role:
    Pipeline Step -- acts as a **Facade** that gathers every course step
    executor from its sub-module and re-exports it under a single import
    path.  The registry (``registry.py``) points course step names at
    ``("course", "execute_...")``, so this module is the one that
    ``importlib.import_module`` resolves.

Design Patterns:
    * **Facade** -- hides the internal split of course logic across four
      sub-modules (``course_planning``, ``course_scripts``,
      ``course_synthesis``, ``course_publish``) behind one flat namespace.
    * Re-exporting ``SESSION_DEFS`` here lets callers import the canonical
      session layout without knowing which sub-module owns it.

Key Dependencies:
    * ``course_common`` -- shared constants and helpers
    * ``course_planning`` -- plan + thumbnail generation
    * ``course_scripts`` -- script generation + QA formatting
    * ``course_synthesis`` -- TTS synthesis (chunked and non-chunked)
    * ``course_publish`` -- upload confirmation + Firestore publish

Consumed By:
    * ``factory_v2.steps.registry`` -- lazy-imports this module to find
      course step executors.
"""

from __future__ import annotations

from .course_common import SESSION_DEFS
from .course_planning import (
    execute_generate_course_plan,
    execute_generate_course_thumbnail,
)
from .course_publish import (
    execute_publish_course,
    execute_upload_course_audio,
)
from .course_scripts import (
    execute_format_course_scripts,
    execute_generate_course_scripts,
)
from .course_synthesis import (
    execute_synthesize_course_audio,
    execute_synthesize_course_audio_chunk,
)

__all__ = [
    "SESSION_DEFS",
    # Planning phase
    "execute_generate_course_plan",
    "execute_generate_course_thumbnail",
    # Script phase
    "execute_generate_course_scripts",
    "execute_format_course_scripts",
    # Synthesis phase
    "execute_synthesize_course_audio",
    "execute_synthesize_course_audio_chunk",
    # Publish phase
    "execute_upload_course_audio",
    "execute_publish_course",
]
