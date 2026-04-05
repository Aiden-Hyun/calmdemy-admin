"""Queue-selection rules that match ready work to the right worker stacks."""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any

from google.api_core.exceptions import FailedPrecondition

from observability import get_logger
from ..shared.queue_capabilities import (
    capability_key_for_payload,
    is_tts_step,
    payload_has_capability_key,
    worker_capability_keys,
    worker_has_tts_support,
    worker_supports_capability,
)

logger = get_logger(__name__)


@dataclass(slots=True)
class WorkerCapabilityPlan:
    """Normalized snapshot of what a worker stack can legally claim."""

    accept_non_tts_steps: bool
    supported_tts_models: frozenset[str] | None
    extra_capability_keys: frozenset[str]
    capability_keys: tuple[str, ...]
    wildcard_tts: bool
    has_tts_support: bool


@dataclass(slots=True)
class QueueCandidate:
    """A ready queue doc plus the metadata used to rank why it was selected."""

    doc_id: str
    doc_ref: Any
    payload: dict[str, Any]
    source_reason: str
    deprioritized: bool = False
    promoted_by_soft_limit: bool = False

    @property
    def claim_reason(self) -> str:
        if self.promoted_by_soft_limit:
            return "deprioritized_by_soft_limit"
        return self.source_reason


def build_worker_capability_plan(
    *,
    accept_non_tts_steps: bool,
    supported_tts_models: set[str] | None,
    extra_capability_keys: set[str] | None = None,
) -> WorkerCapabilityPlan:
    """Normalize raw stack config into a shape that is cheap to reuse during claiming."""
    normalized_models = (
        frozenset(str(model).strip().lower() for model in supported_tts_models if str(model).strip())
        if supported_tts_models is not None
        else None
    )
    normalized_extra_capabilities = frozenset(
        str(value).strip().lower()
        for value in (extra_capability_keys or set())
        if str(value).strip()
    )
    return WorkerCapabilityPlan(
        accept_non_tts_steps=bool(accept_non_tts_steps),
        supported_tts_models=normalized_models,
        extra_capability_keys=normalized_extra_capabilities,
        capability_keys=tuple(
            worker_capability_keys(
                accept_non_tts_steps=bool(accept_non_tts_steps),
                supported_tts_models=set(normalized_models) if normalized_models is not None else None,
                extra_capability_keys=set(normalized_extra_capabilities),
            )
        ),
        wildcard_tts=normalized_models is None,
        has_tts_support=worker_has_tts_support(
            set(normalized_models) if normalized_models is not None else None
        ),
    )


def supports_worker_payload(
    payload: dict,
    plan: WorkerCapabilityPlan,
) -> bool:
    """Return whether the worker plan is allowed to execute this queue payload."""
    return worker_supports_capability(
        capability_key_for_payload(payload),
        accept_non_tts_steps=plan.accept_non_tts_steps,
        supported_tts_models=set(plan.supported_tts_models) if plan.supported_tts_models is not None else None,
        extra_capability_keys=set(plan.extra_capability_keys),
    )


def _coerce_available_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if hasattr(value, "timestamp"):
        return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)
    return datetime.max.replace(tzinfo=timezone.utc)


def active_tts_counts_by_job(
    payloads: list[dict],
    plan: WorkerCapabilityPlan,
) -> dict[str, int]:
    """Count how many TTS items per job are already active on compatible workers."""
    counts: dict[str, int] = {}
    for payload in payloads:
        if not is_tts_step(payload.get("step_name")):
            continue
        if not supports_worker_payload(payload, plan):
            continue
        job_id = str(payload.get("job_id") or "").strip()
        if not job_id:
            continue
        counts[job_id] = counts.get(job_id, 0) + 1
    return counts


def rank_claim_candidates(
    candidates: list[QueueCandidate],
    *,
    plan: WorkerCapabilityPlan,
    active_tts_by_job: dict[str, int],
    tts_per_job_soft_limit: int,
) -> list[QueueCandidate]:
    """Prefer oldest work first, but softly spread TTS load across jobs.

    The soft limit does not make a candidate ineligible. It only pushes that
    candidate later in the ordering so one large course job does not monopolize
    the entire TTS fleet.
    """
    ordered = sorted(
        candidates,
        key=lambda candidate: (
            _coerce_available_at(candidate.payload.get("available_at")),
            candidate.doc_id,
        ),
    )
    if not plan.has_tts_support or tts_per_job_soft_limit <= 0:
        return ordered

    original_indexes = {candidate.doc_id: index for index, candidate in enumerate(ordered)}
    under_limit: list[QueueCandidate] = []
    at_limit: list[QueueCandidate] = []

    for candidate in ordered:
        payload = candidate.payload
        if not is_tts_step(payload.get("step_name")):
            under_limit.append(candidate)
            continue
        job_id = str(payload.get("job_id") or "").strip()
        if not job_id:
            under_limit.append(candidate)
            continue
        if int(active_tts_by_job.get(job_id) or 0) >= tts_per_job_soft_limit:
            at_limit.append(replace(candidate, deprioritized=True))
        else:
            under_limit.append(candidate)

    ranked = under_limit + at_limit
    adjusted: list[QueueCandidate] = []
    for index, candidate in enumerate(ranked):
        adjusted.append(
            replace(
                candidate,
                promoted_by_soft_limit=index < original_indexes.get(candidate.doc_id, index),
            )
        )
    return adjusted


class QueueScheduler:
    """High-level queue claimer that hides capability lookups and ranking rules."""

    def __init__(self, queue_repo, no_match_log_interval_sec: float = 30.0):
        self.queue_repo = queue_repo
        self.no_match_log_interval_sec = max(5.0, float(no_match_log_interval_sec))
        self._last_no_match_log_at = 0.0

    def _maybe_log_no_matching_capability(
        self,
        *,
        worker_id: str,
        plan: WorkerCapabilityPlan,
    ) -> None:
        now = time.time()
        if now - self._last_no_match_log_at < self.no_match_log_interval_sec:
            return
        self._last_no_match_log_at = now
        logger.info(
            "V2 queue claim skipped",
            extra={
                "worker_id": worker_id,
                "claim_reason": "no_matching_capability",
                "capability_keys": list(plan.capability_keys),
            },
        )

    def _claim_log_fields(
        self,
        candidate: QueueCandidate,
        *,
        worker_id: str,
    ) -> dict[str, Any]:
        payload = candidate.payload
        return {
            "queue_id": candidate.doc_id,
            "job_id": str(payload.get("job_id") or "").strip(),
            "run_id": str(payload.get("run_id") or "").strip(),
            "step_name": str(payload.get("step_name") or "").strip(),
            "worker_id": worker_id,
            "capability_key": capability_key_for_payload(payload),
            "required_tts_model": str(payload.get("required_tts_model") or "").strip().lower() or None,
            "shard_key": str(payload.get("shard_key") or "root"),
            "attempt": int(payload.get("retry_count") or 0) + 1,
            "claim_reason": candidate.claim_reason,
        }

    def _fetch_candidates(
        self,
        *,
        available_before: datetime,
        plan: WorkerCapabilityPlan,
        candidate_limit: int,
    ) -> tuple[list[QueueCandidate], bool]:
        """Fetch ready docs from both indexed and legacy paths, then filter by capability."""
        candidates: list[QueueCandidate] = []
        seen_ids: set[str] = set()
        ready_docs_seen = False
        capability_query_failed = False

        for capability_key in plan.capability_keys:
            try:
                docs = self.queue_repo.fetch_ready_by_capability(
                    capability_key,
                    available_before=available_before,
                    limit=candidate_limit,
                )
            except FailedPrecondition as exc:
                logger.warning(
                    "V2 capability queue query unavailable; falling back to legacy ready scan",
                    extra={
                        "capability_key": capability_key,
                        "error": str(exc),
                    },
                )
                capability_query_failed = True
                break

            ready_docs_seen = ready_docs_seen or bool(docs)
            for doc in docs:
                if doc.id in seen_ids:
                    continue
                payload = doc.to_dict() or {}
                candidates.append(
                    QueueCandidate(
                        doc_id=doc.id,
                        doc_ref=doc.reference,
                        payload=payload,
                        source_reason="selected_by_capability",
                    )
                )
                seen_ids.add(doc.id)

        fallback_docs = self.queue_repo.fetch_ready(
            available_before=available_before,
            limit=candidate_limit,
        )
        ready_docs_seen = ready_docs_seen or bool(fallback_docs)
        for doc in fallback_docs:
            if doc.id in seen_ids:
                continue
            payload = doc.to_dict() or {}
            if not capability_query_failed and not plan.wildcard_tts and payload_has_capability_key(payload):
                continue
            candidates.append(
                QueueCandidate(
                    doc_id=doc.id,
                    doc_ref=doc.reference,
                    payload=payload,
                    source_reason="legacy_fallback_scan",
                )
            )
            seen_ids.add(doc.id)

        filtered = [candidate for candidate in candidates if supports_worker_payload(candidate.payload, plan)]
        return filtered, ready_docs_seen

    def claim_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = 300,
        accept_non_tts_steps: bool = True,
        supported_tts_models: set[str] | None = None,
        extra_capability_keys: set[str] | None = None,
        candidate_limit: int = 200,
        tts_per_job_soft_limit: int = 2,
    ) -> tuple[str, dict] | None:
        """Claim the best matching ready queue item for this worker, if one exists."""
        plan = build_worker_capability_plan(
            accept_non_tts_steps=accept_non_tts_steps,
            supported_tts_models=supported_tts_models,
            extra_capability_keys=extra_capability_keys,
        )
        now = datetime.now(timezone.utc)
        filtered_candidates, ready_docs_seen = self._fetch_candidates(
            available_before=now,
            plan=plan,
            candidate_limit=max(20, int(candidate_limit)),
        )
        if not filtered_candidates:
            if ready_docs_seen:
                self._maybe_log_no_matching_capability(worker_id=worker_id, plan=plan)
            return None

        active_payloads = self.queue_repo.fetch_payloads_by_states(
            ("leased", "running"),
            limit=max(max(20, int(candidate_limit)) * 2, 64),
        )
        active_tts_by_job = active_tts_counts_by_job(active_payloads, plan)
        ranked_candidates = rank_claim_candidates(
            filtered_candidates,
            plan=plan,
            active_tts_by_job=active_tts_by_job,
            tts_per_job_soft_limit=max(0, int(tts_per_job_soft_limit)),
        )

        for candidate in ranked_candidates:
            claimed = self.queue_repo.claim_ready_doc(
                candidate.doc_ref,
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                payload_validator=lambda payload: supports_worker_payload(payload, plan),
            )
            if claimed is None:
                continue

            candidate = replace(candidate, payload=claimed)
            logger.info(
                "V2 queue item claimed",
                extra=self._claim_log_fields(candidate, worker_id=worker_id),
            )
            return candidate.doc_id, claimed

        return None
