"""Step 6 -- Create a Firestore content document so the content appears in the app.

Architectural Role:
    Final stage of the single-content pipeline.  Writes (or updates) a
    Firestore document in the collection that matches the content type
    (``guided_meditations``, ``bedtime_stories``, etc.).  This is the
    moment the content becomes visible to end-users.

    Each content type has a slightly different schema (e.g. bedtime stories
    carry a ``category`` field, guided meditations have ``techniques``).
    The document ID is derived from a stable publish token so that
    re-running the pipeline updates the existing doc instead of creating
    duplicates.

Key Dependencies:
    - firebase_admin.firestore  -- Firestore SDK
    - voice_utils               -- maps TTS voice IDs to display names

Consumed By:
    - factory_v2 pipeline step ``publish_content``
"""

import math
import re

from firebase_admin import firestore as fs
from .voice_utils import get_voice_display_name
from observability import get_logger

logger = get_logger(__name__)


def _generate_description(script: str, max_length: int = 200) -> str:
    """Extract the first few sentences of the script as a short description.

    Strips ``[PAUSE Xs]`` markers and collapses whitespace before truncating
    at a sentence boundary so the description reads naturally in the app.
    """
    import re
    clean = re.sub(r'\[PAUSE \d+s\]', '', script)
    clean = re.sub(r'\s+', ' ', clean).strip()

    if len(clean) <= max_length:
        return clean

    # Try to cut at the last sentence-ending period within the limit
    truncated = clean[:max_length]
    last_period = truncated.rfind('.')
    if last_period > max_length // 2:
        return truncated[:last_period + 1]
    return truncated.rstrip() + "..."


def _generate_title(job_data: dict) -> str:
    """Generate a display title from the job's topic parameter (fallback only)."""
    topic = job_data.get("params", {}).get("topic", "Untitled")
    title = topic.strip().title()
    if len(title) > 60:
        title = title[:57] + "..."
    return title


def _stable_doc_id(value: str) -> str:
    """Convert an arbitrary string into a Firestore-safe document ID.

    Non-alphanumeric characters are replaced with hyphens, consecutive
    hyphens are collapsed, and the result is capped at 120 characters.
    """
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip())
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned[:120] or "generated-content"


def publish_content(
    db,
    storage_path: str,
    duration_sec: float,
    script: str,
    job_data: dict,
) -> str:
    """Create or update a Firestore document in the appropriate content collection.

    The document ID is derived from a "publish token" (content job ID or title)
    so that re-publishing the same content overwrites the existing document
    rather than creating a duplicate.  On updates the ``createdAt`` timestamp
    is preserved and ``updatedAt`` is set instead.

    Args:
        db: Firestore client instance.
        storage_path: Cloud Storage path to the audio file.
        duration_sec: Audio duration in seconds.
        script: The formatted narration script (used to auto-generate a description).
        job_data: Full Firestore job document.

    Returns:
        The Firestore document ID of the published content.
    """
    content_type = job_data.get("contentType", "guided_meditation")
    params = job_data.get("params", {})
    # Use the resolved title from the pipeline, fall back to topic-based title
    title = job_data.get("_resolvedTitle") or _generate_title(job_data)
    description = _generate_description(script)
    duration_minutes = max(1, math.ceil(duration_sec / 60))
    voice_id = job_data.get("ttsVoice", "Calmdemy")
    voice = get_voice_display_name(voice_id)
    thumbnail_url = job_data.get("thumbnailUrl") or ""

    logger.info(
        "Creating content document",
        extra={"content_type": content_type, "title": title},
    )

    doc_data = {}
    collection_name = ""

    if content_type == "guided_meditation":
        collection_name = "guided_meditations"
        doc_data = {
            "title": title,
            "description": description,
            "duration_minutes": duration_minutes,
            "audioPath": storage_path,
            "thumbnailUrl": thumbnail_url,
            "themes": params.get("themes", []),
            "techniques": [params["technique"]] if params.get("technique") else [],
            "difficulty_level": params.get("difficulty", "beginner"),
            "instructor": voice,
            "ttsVoiceId": voice_id,
            "isFree": True,
            "generatedBy": "content-factory",
            "createdAt": fs.SERVER_TIMESTAMP,
        }

    elif content_type == "sleep_meditation":
        collection_name = "sleep_meditations"
        doc_data = {
            "title": title,
            "description": description,
            "duration_minutes": duration_minutes,
            "audioPath": storage_path,
            "thumbnailUrl": thumbnail_url,
            "instructor": voice,
            "ttsVoiceId": voice_id,
            "isFree": True,
            "generatedBy": "content-factory",
            "createdAt": fs.SERVER_TIMESTAMP,
        }

    elif content_type == "bedtime_story":
        collection_name = "bedtime_stories"
        doc_data = {
            "title": title,
            "description": description,
            "narrator": voice,
            "ttsVoiceId": voice_id,
            "duration_minutes": duration_minutes,
            "audio_url": storage_path,
            "thumbnail_url": thumbnail_url,
            "category": params.get("category", "nature"),
            "isFree": True,
            "generatedBy": "content-factory",
            "createdAt": fs.SERVER_TIMESTAMP,
        }

    elif content_type == "emergency_meditation":
        collection_name = "emergency_meditations"
        doc_data = {
            "title": title,
            "description": description,
            "duration_minutes": duration_minutes,
            "audioPath": storage_path,
            "narrator": voice,
            "ttsVoiceId": voice_id,
            "thumbnailUrl": thumbnail_url,
            "isFree": True,  # Emergency content should be free
            "generatedBy": "content-factory",
            "createdAt": fs.SERVER_TIMESTAMP,
        }

    elif content_type == "course_session":
        collection_name = "course_sessions"
        session_code = (
            params.get("code")
            or params.get("sessionCode")
            or (
                f"{params.get('courseCode')}{params.get('sessionSuffix')}"
                if params.get("courseCode") and params.get("sessionSuffix")
                else ""
            )
        )
        doc_data = {
            "title": title,
            "description": description,
            "duration_minutes": duration_minutes,
            "audioPath": storage_path,
            "courseId": params.get("courseId", ""),
            "code": session_code,
            "order": params.get("order", 0),
            "thumbnailUrl": thumbnail_url,
            "isFree": False,
            "generatedBy": "content-factory",
            "createdAt": fs.SERVER_TIMESTAMP,
        }

    else:
        raise ValueError(f"Unknown content type: {content_type}")

    # Derive a stable document ID so re-publishes update the same doc
    publish_token = str(
        job_data.get("publishToken")
        or job_data.get("_factoryContentJobId")
        or job_data.get("id")
        or title
    ).strip()
    doc_ref = db.collection(collection_name).document(_stable_doc_id(publish_token))
    existing = doc_ref.get()
    if existing.exists:
        # Preserve the original creation timestamp on updates
        doc_data.pop("createdAt", None)
        doc_data["updatedAt"] = fs.SERVER_TIMESTAMP
    # merge=True keeps any fields not in doc_data (e.g. user-added metadata)
    doc_ref.set(doc_data, merge=True)
    content_id = doc_ref.id

    logger.info(
        "Content document created",
        extra={"collection": collection_name, "content_id": content_id},
    )
    return content_id
