"""Central workflow coordinator for Content Factory V2.

Architectural Role:
    Application / Service Layer -- the Orchestrator is the *brain* of the
    pipeline.  It sits above individual step executors and below the admin
    command layer.  Its job is to advance the workflow DAG defined in
    ``scheduler.py`` by creating runs, enqueueing the next steps, and
    handling fan-out / fan-in for parallel work (audio chunks, thumbnails).

Design Patterns:
    * **Orchestrator / Mediator** -- this class is the single coordination
      point that all step executors report back to.  No step executor knows
      about any other step; they all call ``on_step_success`` or
      ``on_step_failed`` on this class, and the Orchestrator decides what
      happens next.
    * **Repository pattern** -- the Orchestrator never touches Firestore
      directly (except for a few legacy content-job patches).  It reads and
      writes through four injected repositories: ``job_repo``, ``run_repo``,
      ``step_run_repo``, and ``queue_repo``.
    * **Saga / Process Manager** -- the ``recover_*`` methods implement
      self-healing: if a worker dies mid-fan-out, the recovery sweep detects
      the gap and re-enqueues the missing work.  This makes the pipeline
      crash-safe without distributed transactions.
    * **Fan-out / Fan-in** -- audio synthesis for both courses and single
      content is split into parallel chunk shards (fan-out), then assembled
      back once all shards succeed (fan-in).

Key Dependencies:
    * ``scheduler.WorkflowSpec``  -- static DAG definitions.
    * ``job_repo``               -- job aggregate root persistence.
    * ``run_repo``               -- run-level lifecycle persistence.
    * ``step_run_repo``          -- per-step-run state (ready/succeeded/failed).
    * ``queue_repo``             -- enqueues work items for workers to pick up.

Consumed By:
    * ``CommandService``         -- retry, cancel, approve-publish commands.
    * Step executors (via the worker loop) -- call ``on_step_success`` /
      ``on_step_failed`` after each step completes.
    * Recovery / sweep jobs      -- call ``recover_*`` methods to heal
      interrupted runs.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from firebase_admin import firestore as fs

from .scheduler import workflow_for_job_type
from ..shared.lineage_timing import finalize_job_timing
from ..shared.metrics import record_job_metric
from ..shared.course_tts_chunks import (
    make_chunk_shard_key,
    parse_chunk_shard_key,
    split_course_tts_chunks,
    make_single_chunk_shard_key,
    parse_single_chunk_shard_key,
)
from ..shared.course_tts_progress import build_course_tts_progress

# ---------------------------------------------------------------------------
# Constants -- shard identifiers and step names used for fan-out / fan-in
# ---------------------------------------------------------------------------

# Each course has exactly these session shards.  "INT" = intro,
# "MxL" = module x lecture, "MxP" = module x practice.
COURSE_AUDIO_SHARDS = ("INT", "M1L", "M1P", "M2L", "M2P", "M3L", "M3P", "M4L", "M4P")

# Step names referenced across fan-out/fan-in logic.
COURSE_AUDIO_CHUNK_STEP = "synthesize_course_audio_chunk"
SINGLE_AUDIO_CHUNK_STEP = "synthesize_audio_chunk"
SINGLE_AUDIO_ASSEMBLE_STEP = "assemble_audio"

# Scripts shorter than this word count use the linear (non-chunked) TTS path.
SINGLE_CONTENT_CHUNK_MIN_WORDS = int(os.getenv("SINGLE_CONTENT_CHUNK_MIN_WORDS", "200"))


class Orchestrator:
    """Central coordinator for the job -> run -> step lifecycle.

    The Orchestrator never executes step logic itself.  Instead it:
      1. Creates run records (``start_new_run``).
      2. Enqueues work items in the queue repository.
      3. Reacts to step outcomes via ``on_step_success`` / ``on_step_failed``.
      4. Heals interrupted runs via ``recover_*`` methods.

    All four repositories are injected via the constructor, making the
    orchestrator easy to unit-test with in-memory fakes.
    """

    def __init__(self, job_repo, run_repo, step_run_repo, queue_repo):
        # Aggregate-root repo: read/write the top-level job document.
        self.job_repo = job_repo
        # Run-level repo: create runs, mark them completed or failed.
        self.run_repo = run_repo
        # Step-run repo: track per-step state (ready / succeeded / failed)
        # and per-shard state for fan-out steps.
        self.step_run_repo = step_run_repo
        # Queue repo: push work items that workers will dequeue and execute.
        self.queue_repo = queue_repo

    # ------------------------------------------------------------------
    # Job payload helpers
    # ------------------------------------------------------------------
    # The job document has a nested structure: job -> request -> content_job
    # (or job_data).  These helpers provide safe navigation through the
    # nested dicts with sensible defaults so callers don't repeat
    # defensive dict-gets everywhere.
    # ------------------------------------------------------------------

    @staticmethod
    def _content_job_tts_model(job: dict) -> str:
        """Extract the TTS model name from the job's request payload.

        Falls back to ``"qwen3-base"`` when the field is missing or blank.
        """
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        model = str(payload.get("ttsModel") or "").strip().lower()
        return model or "qwen3-base"

    def _required_tts_model_for_step(self, job: dict, step_name: str) -> str | None:
        """Return the TTS model only for steps that actually perform speech synthesis.

        Non-TTS steps return ``None`` so the queue item is model-agnostic and
        any worker can pick it up.
        """
        if step_name in {
            "synthesize_audio",
            "synthesize_course_audio",
            COURSE_AUDIO_CHUNK_STEP,
            SINGLE_AUDIO_CHUNK_STEP,
        }:
            return self._content_job_tts_model(job)
        return None

    @staticmethod
    def _course_thumbnail_url(job: dict) -> str:
        runtime = dict(job.get("runtime") or {})
        thumbnail_url = str(runtime.get("thumbnail_url") or "").strip()
        if thumbnail_url:
            return thumbnail_url

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        return str(payload.get("thumbnailUrl") or "").strip()

    @staticmethod
    def _course_generates_thumbnail_during_run(job: dict) -> bool:
        runtime = dict(job.get("runtime") or {})
        if isinstance(runtime.get("generate_thumbnail_during_run"), bool):
            return bool(runtime.get("generate_thumbnail_during_run"))

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        value = payload.get("generateThumbnailDuringRun")
        if isinstance(value, bool):
            return value
        return True

    @staticmethod
    def _course_thumbnail_generation_requested(job: dict) -> bool:
        runtime = dict(job.get("runtime") or {})
        if isinstance(runtime.get("thumbnail_generation_requested"), bool):
            return bool(runtime.get("thumbnail_generation_requested"))

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        return bool(payload.get("thumbnailGenerationRequested"))

    @staticmethod
    def _course_regeneration(job: dict) -> dict:
        runtime = dict(job.get("runtime") or {})
        regeneration = runtime.get("course_regeneration")
        if isinstance(regeneration, dict):
            return dict(regeneration)

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        regeneration = payload.get("courseRegeneration")
        if isinstance(regeneration, dict):
            return dict(regeneration)
        return {}

    def _course_regeneration_awaiting_script_approval(self, job: dict) -> bool:
        regeneration = self._course_regeneration(job)
        return (
            bool(regeneration.get("active"))
            and str(regeneration.get("mode") or "").strip().lower() == "script_and_audio"
            and bool(regeneration.get("awaitingScriptApproval"))
        )

    @staticmethod
    def _course_script_approval(job: dict) -> dict:
        runtime = dict(job.get("runtime") or {})
        script_approval = runtime.get("course_script_approval")
        if isinstance(script_approval, dict):
            return dict(script_approval)

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        script_approval = payload.get("courseScriptApproval")
        if isinstance(script_approval, dict):
            return dict(script_approval)
        return {}

    def _course_initial_script_approval_awaiting(self, job: dict) -> bool:
        script_approval = self._course_script_approval(job)
        return bool(script_approval.get("enabled") and script_approval.get("awaitingApproval"))

    @staticmethod
    def _single_script_approval(job: dict) -> dict:
        runtime = dict(job.get("runtime") or {})
        script_approval = runtime.get("script_approval")
        if isinstance(script_approval, dict):
            return dict(script_approval)

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        script_approval = payload.get("scriptApproval")
        if isinstance(script_approval, dict):
            return dict(script_approval)
        return {}

    def _single_script_approval_awaiting(self, job: dict) -> bool:
        script_approval = self._single_script_approval(job)
        return bool(script_approval.get("enabled") and script_approval.get("awaitingApproval"))

    @staticmethod
    def _single_thumbnail_generation_requested(job: dict) -> bool:
        """Check if a single-content (non-course) job has thumbnail regeneration requested."""
        if job.get("job_type") == "course":
            return False
        runtime = dict(job.get("runtime") or {})
        if isinstance(runtime.get("thumbnail_generation_requested"), bool):
            return bool(runtime.get("thumbnail_generation_requested"))
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        return bool(payload.get("thumbnailGenerationRequested"))

    # Maps a content-type key (e.g. "guided_meditation") to the Firestore
    # collection name where its published documents live.  Used when a
    # thumbnail-only run needs to patch the published document directly.
    _SINGLE_CONTENT_COLLECTION_MAP: dict[str, str] = {
        "guided_meditation": "guided_meditations",
        "sleep_meditation": "sleep_meditations",
        "bedtime_story": "bedtime_stories",
        "emergency_meditation": "emergency_meditations",
        "album": "albums",
        "sleep_sound": "sleep_sounds",
        "white_noise": "white_noise",
        "music": "music",
        "asmr": "asmr",
        "series": "series",
    }

    def _update_published_content_thumbnail(self, job: dict, run_id: str) -> None:
        """Update the published content document's thumbnail after a thumbnail-only run."""
        if not hasattr(self.job_repo, "db"):
            return
        runtime = dict(job.get("runtime") or {})
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}

        thumbnail_url = str(runtime.get("thumbnail_url") or "").strip()
        if not thumbnail_url:
            return

        published_content_id = str(
            runtime.get("published_content_id") or payload.get("publishedContentId") or ""
        ).strip()
        content_type = str(payload.get("contentType") or "guided_meditation")

        collection_name = self._SINGLE_CONTENT_COLLECTION_MAP.get(content_type)
        if not collection_name or not published_content_id:
            return

        thumbnail_field = "thumbnail_url" if content_type == "bedtime_story" else "thumbnailUrl"
        self.job_repo.db.collection(collection_name).document(published_content_id).update({
            thumbnail_field: thumbnail_url,
        })

        content_job_id = self._content_job_id(job)
        if content_job_id:
            self.job_repo.patch_compat_content_job_for_run(content_job_id, run_id, {
                "status": "completed",
                "thumbnailUrl": thumbnail_url,
                "thumbnailGenerationRequested": False,
                "jobRunId": run_id,
                "lastRunStatus": "completed",
                "runEndedAt": fs.SERVER_TIMESTAMP,
            })

    def _update_published_course_thumbnail(self, job: dict, run_id: str) -> None:
        """Update the published course document's thumbnail after a thumbnail-only run."""
        if not hasattr(self.job_repo, "db"):
            return
        runtime = dict(job.get("runtime") or {})
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}

        thumbnail_url = str(runtime.get("thumbnail_url") or "").strip()
        if not thumbnail_url:
            return

        # Update the course document if we know which one it is
        published_content_id = str(
            runtime.get("published_content_id") or payload.get("publishedContentId") or ""
        ).strip()
        course_id = str(
            runtime.get("course_id") or payload.get("courseId") or published_content_id
        ).strip()

        if course_id:
            try:
                self.job_repo.db.collection("courses").document(course_id).update({
                    "thumbnailUrl": thumbnail_url,
                })
            except Exception:
                pass  # Course doc may not exist for jobs that haven't published yet

        content_job_id = self._content_job_id(job)
        if content_job_id:
            self.job_repo.patch_compat_content_job_for_run(content_job_id, run_id, {
                "status": "completed",
                "thumbnailUrl": thumbnail_url,
                "thumbnailGenerationRequested": False,
                "jobRunId": run_id,
                "lastRunStatus": "completed",
                "runEndedAt": fs.SERVER_TIMESTAMP,
            })

    @staticmethod
    def _subject_plan_approval(job: dict) -> dict:
        runtime = dict(job.get("runtime") or {})
        plan_approval = runtime.get("subject_plan_approval")
        if isinstance(plan_approval, dict):
            return dict(plan_approval)

        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        plan_approval = payload.get("subjectPlanApproval")
        if isinstance(plan_approval, dict):
            return dict(plan_approval)
        return {}

    def _subject_plan_approval_awaiting(self, job: dict) -> bool:
        plan_approval = self._subject_plan_approval(job)
        return bool(plan_approval.get("enabled") and plan_approval.get("awaitingApproval"))

    @staticmethod
    def _subject_state(job: dict) -> str:
        runtime = dict(job.get("runtime") or {})
        state = str(runtime.get("subject_state") or "").strip().lower()
        if state:
            return state
        summary = dict(job.get("summary") or {})
        state = str(summary.get("subjectState") or "").strip().lower()
        return state or "watching"

    # ------------------------------------------------------------------
    # Single-content smart retry: detect completed steps and skip ahead
    # ------------------------------------------------------------------

    _SINGLE_CONTENT_RESUME_AFTER_IMAGE = "_resume_after_image"

    def _determine_single_content_first_step(self, job: dict) -> str | None:
        """Inspect runtime artifacts to find the first incomplete step.

        Returns a step name to resume from, the special sentinel
        ``_resume_after_image`` (image done, audio not), or ``None``
        when the job should start from the beginning.
        """
        if job.get("job_type") not in (None, "single_content"):
            return None

        runtime = dict(job.get("runtime") or {})

        has_script = bool(str(runtime.get("generated_script") or "").strip())
        has_formatted = bool(str(runtime.get("formatted_script") or "").strip())
        has_image = (
            bool(str(runtime.get("thumbnail_url") or "").strip())
            and not self._single_thumbnail_generation_requested(job)
        )
        has_audio = bool(str(runtime.get("storage_path") or "").strip())
        has_published = bool(str(runtime.get("published_content_id") or "").strip())

        # Walk the pipeline in reverse: find the latest completed step,
        # then return the *next* step after it.  Each check also verifies
        # that all prior steps completed — if an earlier artifact was
        # cleared (e.g. script edit), we must re-run from that point.
        if has_published and has_audio and has_formatted and has_script:
            return "publish_content"
        if has_audio and has_formatted and has_script:
            return "publish_content"
        if has_image and has_formatted and has_script:
            return self._SINGLE_CONTENT_RESUME_AFTER_IMAGE
        if has_formatted and has_script:
            return "generate_image"
        if has_script:
            return "format_script"
        return None

    def _seed_single_content_checkpoint_steps(
        self,
        job: dict,
        job_id: str,
        run_id: str,
        first_step: str,
    ) -> None:
        """Mark completed single-content steps as checkpoints for this run.

        Mirrors ``_seed_course_checkpoint_steps`` but for the single-content
        pipeline.  Each prior step whose runtime artifact exists is marked
        ``succeeded_from_checkpoint`` so the admin timeline shows them as
        reused and prerequisite gates pass.
        """
        if job.get("job_type") not in (None, "single_content"):
            return

        runtime = dict(job.get("runtime") or {})

        # Steps before the resume point, in pipeline order.
        checkpointable = {
            "generate_script": bool(str(runtime.get("generated_script") or "").strip()),
            "format_script": bool(str(runtime.get("formatted_script") or "").strip()),
            "generate_image": bool(
                str(runtime.get("thumbnail_url") or "").strip()
                and not self._single_thumbnail_generation_requested(job)
            ),
        }

        # The pipeline order up to the image step.  Steps after image
        # (audio, publish) are handled by the orchestrator dynamically.
        pipeline_order = ["generate_script", "format_script", "generate_image"]

        for step_name in pipeline_order:
            # Stop seeding once we reach the step we're about to execute.
            if step_name == first_step:
                break
            # Also stop for the resume-after-image sentinel.
            if first_step == self._SINGLE_CONTENT_RESUME_AFTER_IMAGE and step_name == "generate_image":
                # Still seed generate_image itself since it completed.
                pass  # fall through to checkpoint it below
            if not checkpointable.get(step_name):
                continue
            step_run_id = self.step_run_repo.ensure_ready(job_id, run_id, step_name)
            self.step_run_repo.mark_succeeded_from_checkpoint(
                step_run_id,
                {"reused_from_checkpoint": True},
            )

        # For _resume_after_image, also checkpoint generate_image itself.
        if (
            first_step == self._SINGLE_CONTENT_RESUME_AFTER_IMAGE
            and checkpointable.get("generate_image")
        ):
            step_run_id = self.step_run_repo.ensure_ready(job_id, run_id, "generate_image")
            self.step_run_repo.mark_succeeded_from_checkpoint(
                step_run_id,
                {
                    "reused_from_checkpoint": True,
                    "thumbnail_url": str(runtime.get("thumbnail_url") or ""),
                },
            )

    def _seed_course_checkpoint_steps(
        self,
        job: dict,
        job_id: str,
        run_id: str,
        first_step: str,
    ) -> None:
        """
        Mark reusable course prerequisites as completed when a run starts mid-pipeline.

        Regeneration and deferred-thumbnail runs can begin after parts of the
        course have already completed in earlier runs. Surfacing those prior
        results in the new run keeps publish gating and the UI in sync.
        """
        if job.get("job_type") != "course":
            return

        if first_step not in {
            "generate_course_thumbnail",
            "generate_course_scripts",
            "format_course_scripts",
            "synthesize_course_audio",
            "upload_course_audio",
            "publish_course",
        }:
            return

        thumbnail_url = self._course_thumbnail_url(job)
        thumbnail_regeneration_requested = self._course_thumbnail_generation_requested(job)
        if thumbnail_url and not thumbnail_regeneration_requested:
            step_run_id = self.step_run_repo.ensure_ready(
                job_id,
                run_id,
                "generate_course_thumbnail",
            )
            self.step_run_repo.mark_succeeded_from_checkpoint(
                step_run_id,
                {
                    "reused_from_checkpoint": True,
                    "thumbnail_url": thumbnail_url,
                },
            )

        if self._course_has_uploaded_audio(job):
            upload_step_run_id = self.step_run_repo.ensure_ready(
                job_id,
                run_id,
                "upload_course_audio",
            )
            self.step_run_repo.mark_succeeded_from_checkpoint(
                upload_step_run_id,
                {
                    "reused_from_checkpoint": True,
                    "audio_reused": True,
                },
            )

    @staticmethod
    def _completed_course_audio_shards(job: dict) -> set[str]:
        runtime = dict(job.get("runtime") or {})
        audio_results = dict(runtime.get("course_audio_results") or {})
        completed: set[str] = set()
        for session_code, payload in audio_results.items():
            if not isinstance(payload, dict) or not payload.get("storagePath"):
                continue
            key = str(session_code).strip()
            if not key:
                continue
            for shard in COURSE_AUDIO_SHARDS:
                if key.endswith(shard):
                    completed.add(shard)
                    break
        return completed

    @staticmethod
    def _course_has_uploaded_audio(job: dict) -> bool:
        return len(Orchestrator._completed_course_audio_shards(job)) == len(COURSE_AUDIO_SHARDS)

    @staticmethod
    def _formatted_course_scripts(job: dict) -> dict[str, str]:
        runtime = dict(job.get("runtime") or {})
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        return dict(runtime.get("course_formatted_scripts") or payload.get("courseFormattedScripts") or {})

    @staticmethod
    def _course_code(job: dict) -> str:
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        params = payload.get("params") or {}
        return str(params.get("courseCode") or "COURSE101").strip() or "COURSE101"

    def _course_audio_chunk_shards(
        self,
        job: dict,
        session_shard: str,
    ) -> list[str]:
        formatted_scripts = self._formatted_course_scripts(job)
        course_code = self._course_code(job)
        session_key = str(session_shard or "").strip().upper()
        session_code = f"{course_code}{session_key}"
        script = str(formatted_scripts.get(session_code) or "").strip()
        if not script:
            raise ValueError(f"Missing formatted script for course audio shard '{session_key}'")
        chunks = split_course_tts_chunks(script)
        if not chunks:
            raise ValueError(f"Unable to derive TTS chunks for course audio shard '{session_key}'")
        return [make_chunk_shard_key(session_key, index) for index, _ in enumerate(chunks)]

    def _ensure_step_enqueued(
        self,
        job: dict,
        job_id: str,
        run_id: str,
        step_name: str,
        shard_key: str = "root",
        step_input: dict | None = None,
    ) -> None:
        """Create a step-run record (if absent) and push a work item to the queue.

        This is the *only* place where the orchestrator writes to both the
        step-run repo AND the queue repo.  Centralising it here guarantees
        that every queued work item has a matching step-run record, preventing
        orphaned queue entries.

        Args:
            job: The full job document (used to resolve TTS model).
            job_id: Job identifier.
            run_id: Run identifier.
            step_name: Which pipeline step to execute.
            shard_key: ``"root"`` for non-sharded steps, or a shard
                identifier (e.g. ``"M1L"`` or ``"chunk_02"``) for
                fan-out steps.
            step_input: Optional dict of extra parameters the step
                executor will receive (e.g. ``{"chunk_index": 3}``).
        """
        # ensure_ready is idempotent: if a step-run already exists for this
        # (job, run, step, shard) tuple it returns the existing ID.
        step_run_id = self.step_run_repo.ensure_ready(job_id, run_id, step_name, shard_key=shard_key)
        # Push the work item to the queue.  Workers poll the queue and
        # execute the step, then call on_step_success or on_step_failed.
        self.queue_repo.enqueue(
            job_id=job_id,
            run_id=run_id,
            step_name=step_name,
            step_run_id=step_run_id,
            shard_key=shard_key,
            step_input=step_input,
            required_tts_model=self._required_tts_model_for_step(job, step_name),
        )

    @staticmethod
    def _content_job_id(job: dict) -> str:
        request = job.get("request") or {}
        compat = request.get("compat") or {}
        return str(compat.get("content_job_id") or "").strip()

    def _finalize_completed_job(self, job_id: str, run_id: str) -> None:
        """Perform post-completion bookkeeping: timing roll-up and metrics.

        Called once when a run reaches its terminal step.  The two side
        effects are:
          1. ``finalize_job_timing`` -- aggregates step durations into a
             single timing record for analytics dashboards.
          2. ``record_job_metric``   -- writes a metrics document so the
             admin UI can show success rates and throughput.

        Guarded by ``hasattr(self.job_repo, "db")`` so unit tests with
        in-memory fakes can skip Firestore-dependent finalization.
        """
        if not hasattr(self.job_repo, "db"):
            return
        job = self.job_repo.get(job_id)
        content_job_id = self._content_job_id(job)
        if not content_job_id:
            return
        # Roll up per-step timing into the job's timing summary.
        finalized = finalize_job_timing(
            self.job_repo.db,
            job_id=job_id,
            run_id=run_id,
            content_job_id=content_job_id,
        )
        # Only record the metric if timing was successfully finalized to
        # avoid double-counting on idempotent retries.
        if finalized:
            content_job = self.job_repo.db.collection("content_jobs").document(content_job_id).get().to_dict() or {}
            record_job_metric(
                self.job_repo.db,
                content_job_id,
                content_job,
                outcome="completed",
            )

    def _patch_course_publish_projection(self, job: dict, run_id: str) -> None:
        content_job_id = self._content_job_id(job)
        if not content_job_id:
            return

        runtime = dict(job.get("runtime") or {})
        request = job.get("request") or {}
        payload = request.get("content_job") or request.get("job_data") or {}
        course_id = str(runtime.get("course_id") or payload.get("courseId") or "").strip()
        thumbnail_url = str(runtime.get("thumbnail_url") or payload.get("thumbnailUrl") or "").strip()
        course_session_ids = runtime.get("course_session_ids") or payload.get("courseSessionIds")

        patch = {
            "status": "completed",
            "courseProgress": "Published",
            "jobRunId": run_id,
            "lastRunStatus": "completed",
            "runEndedAt": fs.SERVER_TIMESTAMP,
            "error": None,
            "errorCode": None,
            "failedStage": None,
            "publishInProgress": False,
            "publishLeaseOwner": None,
            "publishLeaseExpiresAt": None,
            "thumbnailGenerationRequested": False,
            "courseRegeneration": None,
        }
        if course_id:
            patch["courseId"] = course_id
        if isinstance(course_session_ids, list) and course_session_ids:
            patch["courseSessionIds"] = course_session_ids
        if thumbnail_url:
            patch["thumbnailUrl"] = thumbnail_url

        self.job_repo.patch_compat_content_job_for_run(content_job_id, run_id, patch)

    def _complete_course_publish_run(self, job: dict, job_id: str, run_id: str) -> None:
        self.job_repo.mark_completed(job_id, run_id)
        self.run_repo.mark_completed(run_id)
        self._patch_course_publish_projection(job, run_id)
        if not self._course_thumbnail_generation_requested(job):
            self._finalize_completed_job(job_id, run_id)

    # ------------------------------------------------------------------
    # Run lifecycle -- create, advance, complete, fail
    # ------------------------------------------------------------------

    def start_new_run(
        self,
        job_id: str,
        trigger: str = "new",
        first_step: str | None = None,
    ) -> str:
        """Create a new run record and enqueue the first step for that run.

        This is the *entry point* for every pipeline execution -- whether
        triggered by a new job, a retry, or a manual publish approval.

        Args:
            job_id: The job to start a run for.
            trigger: Why this run was created (``"new"``, ``"retry"``,
                ``"manual_publish"``).  Stored on the run for audit.
            first_step: Optionally skip to a mid-pipeline step.  When
                ``None``, the first step of the workflow DAG is used.

        Returns:
            The newly created ``run_id`` (convention: ``"{job_id}-r{N}"``).
        """
        job = self.job_repo.get(job_id)
        # Run numbers are monotonically increasing per job (r1, r2, ...).
        run_number = self.run_repo.next_run_number(job_id)
        run_id = f"{job_id}-r{run_number}"

        # Persist the run record first so it appears in the admin UI.
        self.run_repo.create(
            run_id=run_id,
            job_id=job_id,
            run_number=run_number,
            trigger=trigger,
            started_at=datetime.now(timezone.utc),
        )
        # Mark the parent job as running with this run.
        self.job_repo.mark_running(job_id, run_id)

        # Smart retry: if no explicit first_step was given, auto-detect
        # the earliest incomplete step based on runtime artifacts.
        if first_step is None and job.get("job_type") in (None, "single_content"):
            first_step = self._determine_single_content_first_step(job)

        # Look up the static DAG and determine the first step.
        workflow = workflow_for_job_type(job["job_type"])

        # Handle the "resume after image" sentinel: image is done but
        # audio isn't.  Seed checkpoints through generate_image, then
        # kick off audio fan-out directly (since the audio path choice
        # is a runtime decision, not a static DAG edge).
        if first_step == self._SINGLE_CONTENT_RESUME_AFTER_IMAGE:
            self._seed_single_content_checkpoint_steps(job, job_id, run_id, first_step)
            self._fan_out_single_audio(job, job_id, run_id)
            return run_id

        first = first_step or workflow.steps[0]

        # For mid-pipeline starts, seed earlier steps as "completed from
        # checkpoint" so prerequisite checks pass.
        self._seed_course_checkpoint_steps(job, job_id, run_id, first)
        self._seed_single_content_checkpoint_steps(job, job_id, run_id, first)
        # Enqueue the first work item -- the pipeline is now in motion.
        self._ensure_step_enqueued(job, job_id, run_id, first)
        return run_id

    # ------------------------------------------------------------------
    # Course audio fan-out / fan-in
    # ------------------------------------------------------------------
    # Courses have 9 audio sessions (COURSE_AUDIO_SHARDS).  Each session's
    # script is split into text chunks and synthesised in parallel.  Once
    # ALL chunks for a session succeed, a session-level "synthesize_course_audio"
    # step assembles them.  Once ALL 9 session steps succeed, "upload_course_audio"
    # is enqueued.  This is a two-level fan-out / fan-in pattern.
    # ------------------------------------------------------------------

    def _fan_out_course_audio(self, job: dict, job_id: str, run_id: str) -> None:
        """Expand course audio generation into per-session, per-chunk queue items.

        Called when ``format_course_scripts`` succeeds.  For each of the 9
        session shards, splits the formatted script into text chunks and
        enqueues one ``synthesize_course_audio_chunk`` work item per chunk.

        If a session's audio was already completed in a previous run
        (checkpoint reuse), it is marked as succeeded immediately and
        no chunk work items are created for that session.
        """
        completed_shards = self._completed_course_audio_shards(job)
        content_job_id = self._content_job_id(job)
        if content_job_id:
            tts_progress = build_course_tts_progress(job)
            if tts_progress:
                self.job_repo.patch_compat_content_job_for_run(
                    content_job_id,
                    run_id,
                    {"ttsProgress": tts_progress},
                )

        if completed_shards:
            # Surface checkpoint-reused shards in this run's timeline so UI does not
            # show them as "waiting" when they are already completed.
            for shard in COURSE_AUDIO_SHARDS:
                if shard not in completed_shards:
                    continue
                step_run_id = self.step_run_repo.ensure_ready(
                    job_id,
                    run_id,
                    "synthesize_course_audio",
                    shard_key=shard,
                )
                self.step_run_repo.mark_succeeded_from_checkpoint(
                    step_run_id,
                    {
                        "reused_from_checkpoint": True,
                        "session_code": shard,
                    },
                )

        missing_shards = [shard for shard in COURSE_AUDIO_SHARDS if shard not in completed_shards]

        if not missing_shards:
            self._ensure_step_enqueued(job, job_id, run_id, "upload_course_audio")
            return

        for shard in missing_shards:
            for chunk_index, chunk_shard in enumerate(self._course_audio_chunk_shards(job, shard)):
                self._ensure_step_enqueued(
                    job,
                    job_id,
                    run_id,
                    COURSE_AUDIO_CHUNK_STEP,
                    shard_key=chunk_shard,
                    step_input={
                        "session_shard": shard,
                        "chunk_index": chunk_index,
                    },
                )

    def recover_course_audio_fan_out_if_ready(self, job_id: str, run_id: str) -> int:
        """Heal course runs where format succeeded but chunk queue items are missing.

        This is a **self-healing / saga repair** method.  If a worker crashes
        after ``format_course_scripts`` succeeds but before all chunk work
        items are enqueued, the recovery sweep calls this method to fill in
        the gaps.  It is safe to call multiple times (idempotent).

        Returns:
            Number of chunk work items that were recovered (re-enqueued).
        """
        job = self.job_repo.get(job_id)
        if job.get("job_type") != "course":
            return 0
        if not self.step_run_repo.has_succeeded(job_id, run_id, "format_course_scripts"):
            return 0
        if self.step_run_repo.has_succeeded(job_id, run_id, "upload_course_audio"):
            return 0

        completed_shards = self._completed_course_audio_shards(job)
        recovered = 0
        for shard in COURSE_AUDIO_SHARDS:
            if shard in completed_shards:
                continue

            parent_state = self.step_run_repo.state(run_id, "synthesize_course_audio", shard)
            if parent_state:
                continue

            try:
                expected_chunk_shards = self._course_audio_chunk_shards(job, shard)
            except ValueError:
                continue

            for chunk_index, chunk_shard in enumerate(expected_chunk_shards):
                if self.step_run_repo.state(run_id, COURSE_AUDIO_CHUNK_STEP, chunk_shard):
                    continue
                if self.queue_repo.state(run_id, COURSE_AUDIO_CHUNK_STEP, chunk_shard):
                    continue

                self._ensure_step_enqueued(
                    job,
                    job_id,
                    run_id,
                    COURSE_AUDIO_CHUNK_STEP,
                    shard_key=chunk_shard,
                    step_input={
                        "session_shard": shard,
                        "chunk_index": chunk_index,
                    },
                )
                recovered += 1

        return recovered

    def _maybe_enqueue_ready_course_audio_session(
        self,
        job: dict,
        job_id: str,
        run_id: str,
        session_shard: str,
    ) -> bool:
        """Fan-in check for a single course session shard.

        Verifies that ALL text chunks for *session_shard* have succeeded and
        that no chunks have failed.  If the join condition is met, enqueues
        the session-level ``synthesize_course_audio`` step that will
        assemble the chunks into one audio file.

        Returns:
            ``True`` if the session step was enqueued, ``False`` otherwise.
        """
        shard = str(session_shard or "").strip().upper()
        if shard not in COURSE_AUDIO_SHARDS:
            return False

        runtime_shards = self._completed_course_audio_shards(job)
        if shard in runtime_shards:
            return False

        succeeded_session_shards = self.step_run_repo.succeeded_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio",
        )
        if shard in succeeded_session_shards:
            return False

        failed_session_shards = self.step_run_repo.failed_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio",
        )
        if shard in failed_session_shards:
            return False

        try:
            expected_chunk_shards = set(self._course_audio_chunk_shards(job, shard))
        except ValueError:
            return False

        failed_chunk_shards = self.step_run_repo.failed_shard_keys(
            job_id,
            run_id,
            COURSE_AUDIO_CHUNK_STEP,
        )
        if expected_chunk_shards & failed_chunk_shards:
            return False

        succeeded_chunk_shards = self.step_run_repo.succeeded_shard_keys(
            job_id,
            run_id,
            COURSE_AUDIO_CHUNK_STEP,
        )
        if not expected_chunk_shards.issubset(succeeded_chunk_shards):
            return False

        self._ensure_step_enqueued(
            job,
            job_id,
            run_id,
            "synthesize_course_audio",
            shard_key=shard,
            step_input={"session_shard": shard},
        )
        return True

    def _maybe_fan_in_course_audio(self, job: dict, job_id: str, run_id: str) -> bool:
        """Top-level fan-in: enqueue upload once ALL 9 session shards are done.

        Returns:
            ``True`` if ``upload_course_audio`` was enqueued, ``False`` if
            some sessions are still pending or any have failed.
        """
        runtime_shards = self._completed_course_audio_shards(job)
        succeeded_shards = self.step_run_repo.succeeded_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio",
        )
        failed_shards = self.step_run_repo.failed_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio",
        )
        if failed_shards:
            return False
        completed = runtime_shards | succeeded_shards
        if all(shard in completed for shard in COURSE_AUDIO_SHARDS):
            self._ensure_step_enqueued(job, job_id, run_id, "upload_course_audio")
            return True
        return False

    def recover_course_audio_fan_in_if_ready(self, job_id: str, run_id: str) -> int:
        """
        Heal course runs where all chunk shards for a session succeeded but the
        session-level synthesize_course_audio step was never enqueued.
        """
        job = self.job_repo.get(job_id)
        if job.get("job_type") != "course":
            return 0

        recovered = 0
        for session_shard in COURSE_AUDIO_SHARDS:
            if self._maybe_enqueue_ready_course_audio_session(job, job_id, run_id, session_shard):
                recovered += 1

        return recovered

    # ------------------------------------------------------------------
    # Single-content audio fan-out / fan-in
    # ------------------------------------------------------------------
    # Single-content jobs (meditations, stories, etc.) use a simpler
    # version of the same fan-out pattern.  If the formatted script is
    # long enough, it is split into chunks that are synthesised in
    # parallel, then assembled into one audio file.  Short scripts skip
    # chunking entirely and use the linear synthesize_audio path.
    # ------------------------------------------------------------------

    @staticmethod
    def _single_audio_chunks(job: dict) -> list[str]:
        """Split the formatted script and return the text chunks."""
        runtime = dict(job.get("runtime") or {})
        script = runtime.get("formatted_script") or ""
        if not script:
            return []
        return split_course_tts_chunks(script)

    def _single_audio_chunk_shards(self, job: dict) -> list[str]:
        """Return expected shard keys for single-content TTS fan-out."""
        chunks = self._single_audio_chunks(job)
        return [make_single_chunk_shard_key(i) for i in range(len(chunks))]

    def _fan_out_single_audio(self, job: dict, job_id: str, run_id: str) -> None:
        """Fan out single-content TTS into parallel chunk queue items.

        Falls back to the linear ``synthesize_audio`` path when the script is
        too short to benefit from parallelism.
        """
        chunks = self._single_audio_chunks(job)
        word_count = sum(len(c.split()) for c in chunks)

        if len(chunks) <= 1 or word_count < SINGLE_CONTENT_CHUNK_MIN_WORDS:
            self._ensure_step_enqueued(job, job_id, run_id, "synthesize_audio")
            return

        for i in range(len(chunks)):
            self._ensure_step_enqueued(
                job,
                job_id,
                run_id,
                SINGLE_AUDIO_CHUNK_STEP,
                shard_key=make_single_chunk_shard_key(i),
                step_input={"chunk_index": i},
            )

    def _maybe_enqueue_single_audio_assembly(
        self, job: dict, job_id: str, run_id: str,
    ) -> bool:
        """Enqueue ``assemble_audio`` once all chunk shards have succeeded."""
        expected = set(self._single_audio_chunk_shards(job))
        if not expected:
            return False

        failed = self.step_run_repo.failed_shard_keys(
            job_id, run_id, SINGLE_AUDIO_CHUNK_STEP,
        )
        if expected & failed:
            return False

        succeeded = self.step_run_repo.succeeded_shard_keys(
            job_id, run_id, SINGLE_AUDIO_CHUNK_STEP,
        )
        if not expected.issubset(succeeded):
            return False

        self._ensure_step_enqueued(job, job_id, run_id, SINGLE_AUDIO_ASSEMBLE_STEP)
        return True

    def recover_single_audio_fan_out_if_ready(self, job_id: str, run_id: str) -> int:
        """Heal single-content runs where format_script succeeded but chunk
        queue items were never created (worker died mid-fan-out)."""
        job = self.job_repo.get(job_id)
        if job.get("job_type") != "single_content":
            return 0
        if not self.step_run_repo.has_succeeded(job_id, run_id, "format_script"):
            return 0
        # If the linear path already started, don't interfere
        if self.step_run_repo.has_succeeded(job_id, run_id, "synthesize_audio"):
            return 0
        if self.step_run_repo.has_succeeded(job_id, run_id, SINGLE_AUDIO_ASSEMBLE_STEP):
            return 0

        expected_shards = self._single_audio_chunk_shards(job)
        if not expected_shards:
            return 0

        recovered = 0
        for i, shard in enumerate(expected_shards):
            if self.step_run_repo.state(run_id, SINGLE_AUDIO_CHUNK_STEP, shard):
                continue
            if self.queue_repo.state(run_id, SINGLE_AUDIO_CHUNK_STEP, shard):
                continue
            self._ensure_step_enqueued(
                job, job_id, run_id, SINGLE_AUDIO_CHUNK_STEP,
                shard_key=shard,
                step_input={"chunk_index": i},
            )
            recovered += 1
        return recovered

    def recover_course_upload_if_ready(self, job_id: str, run_id: str) -> bool:
        """
        Heal course runs that completed all synth shards but never enqueued upload.

        This protects against rare interruptions after the last synth shard succeeds
        but before orchestration fans in to upload_course_audio.
        """
        job = self.job_repo.get(job_id)
        if job.get("job_type") != "course":
            return False

        if self.step_run_repo.has_succeeded(job_id, run_id, "upload_course_audio"):
            return False

        failed_shards = self.step_run_repo.failed_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio",
        )
        if failed_shards:
            return False

        runtime_shards = self._completed_course_audio_shards(job)
        succeeded_shards = self.step_run_repo.succeeded_shard_keys(
            job_id,
            run_id,
            "synthesize_course_audio",
        )
        completed = runtime_shards | succeeded_shards
        if not all(shard in completed for shard in COURSE_AUDIO_SHARDS):
            return False

        self._ensure_step_enqueued(job, job_id, run_id, "upload_course_audio")
        return True

    def recover_course_publish_if_ready(self, job_id: str, run_id: str) -> bool:
        """
        Heal course runs that already uploaded audio but never enqueued publish.

        This can happen when a regeneration run reuses existing prerequisites or
        when a deferred-thumbnail course only requires audio upload before publish.
        """
        job = self.job_repo.get(job_id)
        if job.get("job_type") != "course":
            return False

        self._seed_course_checkpoint_steps(job, job_id, run_id, "upload_course_audio")

        if not self.step_run_repo.has_succeeded(job_id, run_id, "upload_course_audio"):
            return False
        if self.step_run_repo.has_succeeded(job_id, run_id, "publish_course"):
            self._complete_course_publish_run(job, job_id, run_id)
            return True

        # Thumbnail now runs before audio in the sequential pipeline, so if
        # audio upload succeeded, thumbnail is already done (or was skipped).
        self._ensure_step_enqueued(job, job_id, run_id, "publish_course")
        return True

    # ------------------------------------------------------------------
    # Step outcome handlers -- the core Orchestrator / Mediator logic
    # ------------------------------------------------------------------

    def on_step_success(
        self,
        job_id: str,
        run_id: str,
        step_name: str,
        shard_key: str = "root",
    ) -> None:
        """Advance the workflow after a step succeeds.

        This is the **central dispatch** of the Orchestrator pattern.  Every
        step executor calls this method when it finishes successfully.  The
        orchestrator then decides what to do next:

          * For **subject** jobs: handle plan-approval gating, child-job
            lifecycle, and the watch-children polling loop.
          * For **course** jobs: handle thumbnail parallelism, script-approval
            gating, chunk fan-out / fan-in, and upload-then-publish sequencing.
          * For **single-content** jobs: handle chunked vs. linear audio
            branching, image+audio parallel gating, and thumbnail-only runs.
          * For all types: fall back to the static DAG -- look up successors,
            check their prerequisites, and enqueue any that are ready.

        The order of ``if`` checks matters: job-type-specific logic runs
        first and returns early.  Only steps that are NOT handled by custom
        logic fall through to the generic DAG-following code at the bottom.

        Args:
            job_id: Job identifier.
            run_id: Run identifier.
            step_name: The step that just succeeded.
            shard_key: ``"root"`` for non-sharded steps, or the shard key
                for fan-out steps (e.g. ``"M1L"`` or ``"chunk_02"``).
        """
        job = self.job_repo.get(job_id)
        workflow = workflow_for_job_type(job["job_type"])

        # ---- Subject jobs ------------------------------------------------
        # Subject jobs are *meta-jobs*: they plan child content/course jobs,
        # launch them, then poll until all children converge.  The
        # orchestrator manages three gating decisions:
        #   1. Plan approval: if enabled, stop after plan generation.
        #   2. Child launch outcome: immediately finish if all children
        #      completed/paused during launch, or fail if any child failed.
        #   3. Watch polling: keep re-checking until children converge.
        if job["job_type"] == "subject":
            if step_name == "generate_subject_plan":
                # Approval gate: if the admin wants to review the plan
                # before launching children, end the run here.
                if self._subject_plan_approval_awaiting(job):
                    self.job_repo.mark_completed(job_id, run_id)
                    self.run_repo.mark_completed(run_id)
                    self._finalize_completed_job(job_id, run_id)
                    return
                self._ensure_step_enqueued(job, job_id, run_id, "launch_subject_children")
                return

            if step_name == "launch_subject_children":
                subject_state = self._subject_state(job)
                # Propagate child failure up to the parent subject job.
                if subject_state == "failed":
                    self.job_repo.mark_failed(job_id, run_id, step_name, "child_job_failed")
                    self.run_repo.mark_failed(run_id, step_name, "child_job_failed")
                    return
                # All children finished during the launch step itself --
                # no need to poll, mark parent as complete immediately.
                if subject_state in {"completed", "paused"}:
                    self.job_repo.mark_completed(job_id, run_id)
                    self.run_repo.mark_completed(run_id)
                    self._finalize_completed_job(job_id, run_id)
                    return
                # Some children still running -- start the watch loop.
                self._ensure_step_enqueued(job, job_id, run_id, "watch_subject_children")
                return

            if step_name == "watch_subject_children":
                subject_state = self._subject_state(job)
                if subject_state == "failed":
                    self.job_repo.mark_failed(job_id, run_id, step_name, "child_job_failed")
                    self.run_repo.mark_failed(run_id, step_name, "child_job_failed")
                    return
                if subject_state in {"completed", "paused"}:
                    self.job_repo.mark_completed(job_id, run_id)
                    self.run_repo.mark_completed(run_id)
                    self._finalize_completed_job(job_id, run_id)
                    return
                # Children still running -- the watch step will be
                # re-enqueued by the step executor itself (not here).
                return

        # ---- Course jobs -------------------------------------------------
        # Course pipeline: plan -> scripts -> format -> thumbnail -> audio -> publish
        # Thumbnail generation runs AFTER all scripts are formatted (not in
        # parallel) to avoid overloading local AI servers.  Audio synthesis
        # starts after the thumbnail step finishes.
        if job["job_type"] == "course":
            if step_name == "generate_course_scripts":
                # Script-approval gate: if an admin review is required,
                # end the run here.  A new run will be started after
                # the admin approves the scripts.
                if (
                    self._course_regeneration_awaiting_script_approval(job)
                    or self._course_initial_script_approval_awaiting(job)
                ):
                    self.job_repo.mark_completed(job_id, run_id)
                    self.run_repo.mark_completed(run_id)
                    self._finalize_completed_job(job_id, run_id)
                    return
            if step_name == "format_course_scripts":
                # After scripts are formatted, run thumbnail generation
                # if configured; otherwise go straight to audio.
                if (
                    self._course_generates_thumbnail_during_run(job)
                    and not self._course_thumbnail_url(job)
                ):
                    self._ensure_step_enqueued(job, job_id, run_id, "generate_course_thumbnail")
                else:
                    self._fan_out_course_audio(job, job_id, run_id)
                return
            if step_name == "generate_course_thumbnail":
                # Thumbnail-only run shortcut: update and finish.
                if self._course_thumbnail_generation_requested(job):
                    self._update_published_course_thumbnail(job, run_id)
                    self.job_repo.mark_completed(job_id, run_id)
                    self.run_repo.mark_completed(run_id)
                    return
                # Thumbnail done -- now start audio synthesis.
                self._fan_out_course_audio(job, job_id, run_id)
                return
            if step_name == COURSE_AUDIO_CHUNK_STEP:
                # A single text chunk finished.  Check if all chunks for
                # its parent session shard are done (level-1 fan-in).
                parsed_chunk = parse_chunk_shard_key(shard_key)
                session_shard = str((parsed_chunk[0] if parsed_chunk else "") or "").strip().upper()
                if not session_shard:
                    return
                self._maybe_enqueue_ready_course_audio_session(
                    job,
                    job_id,
                    run_id,
                    session_shard,
                )
                return
            if step_name == "synthesize_course_audio":
                # A session shard finished.  Check if all 9 sessions are
                # done (level-2 fan-in -> upload).
                self._maybe_fan_in_course_audio(job, job_id, run_id)
                return
            if step_name == "upload_course_audio":
                # Audio done -- proceed to publish.
                self._ensure_step_enqueued(job, job_id, run_id, "publish_course")
                return
            if step_name == "publish_course":
                # Terminal step -- finalize the job.
                self._complete_course_publish_run(job, job_id, run_id)
                return
        elif step_name == "generate_script" and self._single_script_approval_awaiting(job):
            self.job_repo.mark_completed(job_id, run_id)
            self.run_repo.mark_completed(run_id)
            self._finalize_completed_job(job_id, run_id)
            return

        # ---- Single-content sequential pipeline --------------------------------
        # After format_script, image generation runs first (uses the LLM /
        # image-AI while the GPU is free), then audio synthesis starts after
        # the image step finishes.  This avoids back-to-back AI calls that
        # crash local inference servers (LM Studio Channel Error).
        #
        # Pipeline: format_script -> generate_image -> audio -> publish_content
        if job["job_type"] == "single_content":
            if step_name == "format_script":
                # Run image generation first; audio starts after it finishes.
                self._ensure_step_enqueued(job, job_id, run_id, "generate_image")
                return

            if step_name == "generate_image":
                # Thumbnail-only run shortcut: update and finish.
                if self._single_thumbnail_generation_requested(job):
                    self._update_published_content_thumbnail(job, run_id)
                    self.job_repo.mark_completed(job_id, run_id)
                    self.run_repo.mark_completed(run_id)
                    self._finalize_completed_job(job_id, run_id)
                    return
                # Image done -- now start audio synthesis.
                self._fan_out_single_audio(job, job_id, run_id)
                return

            if step_name == SINGLE_AUDIO_CHUNK_STEP:
                # A chunk finished -- check if all chunks are done so we
                # can assemble them into one audio file.
                self._maybe_enqueue_single_audio_assembly(job, job_id, run_id)
                return

            if step_name == SINGLE_AUDIO_ASSEMBLE_STEP:
                # Chunked audio assembled -- proceed to publish.
                self._ensure_step_enqueued(job, job_id, run_id, "publish_content")
                return

            if step_name == "upload_audio":
                # Linear audio path done -- proceed to publish.
                self._ensure_step_enqueued(job, job_id, run_id, "publish_content")
                return

        if step_name == "generate_image" and self._single_thumbnail_generation_requested(job):
            self._update_published_content_thumbnail(job, run_id)
            self.job_repo.mark_completed(job_id, run_id)
            self.run_repo.mark_completed(run_id)
            self._finalize_completed_job(job_id, run_id)
            return

        # ---- Generic DAG-following fallback --------------------------------
        # If none of the job-type-specific blocks above handled this step,
        # fall back to the static DAG defined in scheduler.py.
        next_steps = workflow.next_steps(step_name)
        is_terminal = step_name == workflow.terminal_step or not next_steps
        if is_terminal:
            # No successors -- the workflow is complete.
            self.job_repo.mark_completed(job_id, run_id)
            self.run_repo.mark_completed(run_id)
            self._finalize_completed_job(job_id, run_id)
            return

        # For each candidate successor, only enqueue it if ALL its
        # prerequisites have succeeded (DAG join semantics).
        for next_step in next_steps:
            prerequisites = workflow.prerequisites(next_step)
            if not all(
                self.step_run_repo.has_succeeded(job_id, run_id, prereq)
                for prereq in prerequisites
            ):
                continue
            self._ensure_step_enqueued(job, job_id, run_id, next_step)

    # ------------------------------------------------------------------
    # Cancellation and failure handling
    # ------------------------------------------------------------------

    def cancel_run(
        self,
        job_id: str,
        run_id: str,
        *,
        reason: str = "Cancelled by admin",
        error_code: str = "cancelled_by_admin",
    ) -> None:
        """Stop a run and cancel any queued follow-up work that has not started yet.

        Cancellation is a *best-effort* operation: steps that are already
        executing on a worker will run to completion (there is no preemption).
        Only queued items that have not yet been picked up are cancelled.

        Args:
            job_id: Job identifier.
            run_id: Run identifier.
            reason: Human-readable reason (stored for audit / admin UI).
            error_code: Machine-readable code (e.g. ``"cancelled_by_admin"``).
        """
        job = self.job_repo.get(job_id)
        summary = dict(job.get("summary") or {})
        # Use the job's current step as the "failed step" for reporting.
        failed_step = str(summary.get("currentStep") or "").strip() or "pending"

        # 1. Mark the run record as failed.
        self.run_repo.mark_failed(run_id, failed_step, error_code)
        # 2. Mark the parent job as cancelled (if the repo supports it).
        if hasattr(self.job_repo, "mark_cancelled"):
            self.job_repo.mark_cancelled(job_id)
        # 3. Patch the job summary so the admin UI shows failure details.
        if hasattr(self.job_repo, "patch_summary"):
            self.job_repo.patch_summary(
                job_id,
                {
                    "lastRunStatus": "failed",
                    "lastRunId": run_id,
                    "failedStep": failed_step,
                    "errorCode": error_code,
                },
            )

        # 4. Cancel all queued (but not yet started) work items for this run.
        self.queue_repo.cancel_ready_for_run(
            run_id,
            error_code=error_code,
            error_message=reason,
        )

        # 5. Patch the legacy content_jobs document for backward compat.
        #    This ensures the old admin UI also reflects the cancellation.
        content_job_id = self._content_job_id(job)
        if content_job_id:
            self.job_repo.patch_compat_content_job_for_run(
                content_job_id,
                run_id,
                {
                    "status": "failed",
                    "error": reason,
                    "errorCode": error_code,
                    "jobRunId": run_id,
                    "lastRunStatus": "failed",
                    "runEndedAt": fs.SERVER_TIMESTAMP,
                    "publishInProgress": False,
                    "publishLeaseOwner": None,
                    "publishLeaseExpiresAt": None,
                    "v2Locked": False,
                    "activeRunElapsedMs": None,
                },
            )

    def on_step_failed(self, job_id: str, run_id: str, step_name: str, error_code: str) -> None:
        """Handle a step failure: mark the run/job as failed and cancel pending work.

        Unlike ``on_step_success``, failure handling is simple -- a single
        step failure is terminal for the entire run.  All pending queue
        items for this run are cancelled so workers don't waste time on
        work that will be discarded.

        Args:
            job_id: Job identifier.
            run_id: Run identifier.
            step_name: The step that failed.
            error_code: Machine-readable error code from the step executor.
        """
        # Immediately mark both the job and run as failed so the admin UI
        # reflects the failure without waiting for the queue cleanup.
        self.job_repo.mark_failed(job_id, run_id, step_name, error_code)
        self.run_repo.mark_failed(run_id, step_name, error_code)

        # In unit tests the job_repo may lack a Firestore handle -- skip
        # metrics recording and go straight to queue cleanup.
        if not hasattr(self.job_repo, "db"):
            self.queue_repo.cancel_ready_for_run(
                run_id,
                error_code="run_failed",
                error_message=f"Run failed at step '{step_name}' ({error_code}). Pending work cancelled.",
            )
            return

        # Record a failure metric for analytics dashboards.
        job = self.job_repo.get(job_id)
        content_job_id = self._content_job_id(job)
        if content_job_id:
            content_job = self.job_repo.db.collection("content_jobs").document(content_job_id).get().to_dict() or {}
            record_job_metric(
                self.job_repo.db,
                content_job_id,
                content_job,
                outcome="failed",
                stage=step_name,
                error=error_code,
            )

        # Cancel all queued work items so workers don't pick up
        # downstream steps from a run that has already failed.
        self.queue_repo.cancel_ready_for_run(
            run_id,
            error_code="run_failed",
            error_message=f"Run failed at step '{step_name}' ({error_code}). Pending work cancelled.",
        )
