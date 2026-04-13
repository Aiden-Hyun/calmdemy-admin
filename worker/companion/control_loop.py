"""
============================================================
control_loop.py — Worker Companion Control Loop (Orchestration Layer)
============================================================

Architectural Role:
    Orchestration Layer — the "brain" of the companion process.  Runs an
    infinite poll loop that decides which worker stacks should be alive at
    any given moment.  It reads desired state from Firestore, inspects the
    factory step queue for outstanding work, probes system memory, and
    starts/stops worker processes accordingly.

    Think of it as a **local Kubernetes scheduler** — but instead of pods
    on nodes, it manages Python worker processes on a single macOS/Linux
    machine, constrained by physical RAM.

Design Patterns:
    - Control Loop / Reconciliation Loop:  Every ``poll_seconds`` the loop
      reads the *desired* state (from Firestore admin UI or the job
      listener) and the *actual* state (running PIDs, queue depth, free
      RAM), then takes the minimum set of actions to converge them.
    - Strategy Pattern (implicit):  Three desired-state strategies —
      "running" (all enabled stacks up), "auto" (scale to match queue
      demand), and "stopped" (everything down).
    - Two-Layer Memory Guard:
        1. **Proactive spawn gate** (_apply_memory_guard) — before starting
           workers, sums their declared memoryPerWorkerMB budgets against
           available RAM and drops the lowest-priority workers that don't
           fit.  Uses a greedy knapsack heuristic (evict cold→warm,
           largest budget first).
        2. **Reactive emergency watchdog** (_check_memory_pressure) — runs
           every iteration *before* scaling decisions; if actual free memory
           drops below a critical ratio (default 10 %), it force-evicts idle
           workers to prevent OOM.
    - Observer (Firestore listener):  The job listener (listener.py)
      triggers wake events via ensure_running_wrapper, which this module
      processes on the next iteration.

Key Dependencies:
    - Firebase Admin SDK (Firestore for state, queue, worker status)
    - companion/stacks.py (start/stop worker subprocesses)
    - companion/stack_config.py (normalized stack definitions)
    - factory_v2 (queue capabilities, step watchdog, recovery manager)

Consumed By:
    - local_companion.py (entry point — calls run_control_loop)
    - tests/test_companion_control_loop.py (unit tests for scaling logic)
============================================================
"""
import os
import random
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import psutil

import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
for path in (BASE_DIR, PARENT_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

import config
from observability import get_logger
from . import stacks
from .log_tailer import LogTailPublisher
from .stack_config import stack_capability_keys, stack_supports_tts_model
from factory_v2.interfaces.step_watchdog import heartbeat_stale_seconds
from factory_v2.shared.queue_capabilities import capability_key_for_payload

logger = get_logger(__name__)

# ── Firestore collections used for coordination ──────────────────────────
# worker_control: single doc ("local") holding desired/current state, set
#   by the admin UI or the job listener.
# factory_step_queue: individual pipeline steps waiting to be leased.
CONTROL_COLLECTION = "worker_control"
CONTROL_DOC_ID = "local"
JOBS_COLLECTION = config.JOBS_COLLECTION
QUEUE_COLLECTION = "factory_step_queue"

# Step names that involve audio synthesis.  Used by queue metrics to bucket
# steps into TTS vs. non-TTS categories for per-model tracking.
SYNTH_STEP_NAMES = {
    "synthesize_audio",
    "synthesize_course_audio",
    "synthesize_course_audio_chunk",
}
AUTO_STACK_QUEUE_SCAN_LIMIT = int(os.getenv("AUTO_STACK_QUEUE_SCAN_LIMIT", "200"))
AUTO_STACK_OWNERSHIP_GRACE_SEC = float(
    os.getenv("AUTO_STACK_OWNERSHIP_GRACE_SEC", "60")
)
COMPANION_FACTORY_RECOVERY_INTERVAL_SEC = float(
    os.getenv("COMPANION_FACTORY_RECOVERY_INTERVAL_SEC", "10")
)
COMPANION_QUEUE_METRICS_INTERVAL_SEC = float(
    os.getenv("COMPANION_QUEUE_METRICS_INTERVAL_SEC", "5")
)
COMPANION_MEMORY_PROBE_TIMEOUT_SEC = float(
    os.getenv("COMPANION_MEMORY_PROBE_TIMEOUT_SEC", "1.5")
)
COMPANION_MEMORY_GUARD_ENABLED = (
    os.getenv("COMPANION_MEMORY_GUARD_ENABLED", "true").strip().lower()
    != "false"
)
# ── System-wide memory management knobs ──────────────────────────────────
#
# These two constants replace the old Qwen-specific env vars
# (COMPANION_QWEN_MEMORY_GUARD_*).  The new design is model-agnostic:
# every worker stack declares its own memoryPerWorkerMB in stack config,
# and the control loop uses these two thresholds to decide what fits.
#
# COMPANION_OS_RESERVE_MB — headroom (in MB) set aside for the OS kernel,
# Firestore emulator, companion process, etc.  _available_memory_budget_mb()
# subtracts this from free RAM to get the budget workers can share.
COMPANION_OS_RESERVE_MB = int(os.getenv("COMPANION_OS_RESERVE_MB", "2048"))
# COMPANION_CRITICAL_FREE_RATIO — emergency floor.  If the *actual* free
# memory ratio drops below this value (default 10 %), the watchdog
# (_check_memory_pressure) force-evicts idle workers regardless of the
# normal scaling plan.  Acts as a safety net when worker memory usage
# exceeds the declared budgets.
COMPANION_CRITICAL_FREE_RATIO = float(
    os.getenv("COMPANION_CRITICAL_FREE_RATIO", "0.10")
)

# Firestore job statuses that indicate a job is actively being processed.
# Used by has_pending_jobs() to decide whether workers should stay alive.
ACTIVE_STATUSES = [
    "llm_generating",
    "qa_formatting",
    "image_generating",
    "tts_converting",
    "post_processing",
    "uploading",
    "publishing",
]

_MEMORY_PRESSURE_TOTAL_BYTES_RE = re.compile(r"The system has\s+(\d+)")
_MEMORY_PRESSURE_FREE_PERCENT_RE = re.compile(
    r"free percentage:\s*(\d+)%",
    re.IGNORECASE,
)




def _parse_memory_pressure_snapshot(output: str) -> Optional[dict]:
    """
    Parse macOS ``memory_pressure -Q`` stdout into a normalized snapshot dict.

    The command outputs lines like:
        "The system has 17179869184 (4194304 pages with a page size of 4096)."
        "System-wide memory free percentage: 42%"

    We extract totalBytes and freeRatio so the memory guard can make
    platform-agnostic decisions.  Returns None if the output doesn't match
    the expected format (e.g. the command failed or format changed).
    """
    total_match = _MEMORY_PRESSURE_TOTAL_BYTES_RE.search(output or "")
    free_match = _MEMORY_PRESSURE_FREE_PERCENT_RE.search(output or "")
    if total_match is None or free_match is None:
        return None

    total_bytes = int(total_match.group(1))
    free_ratio = max(0.0, min(1.0, int(free_match.group(1)) / 100.0))
    return {
        "source": "memory_pressure",
        "totalBytes": total_bytes,
        "freeRatio": free_ratio,
        "freeBytes": int(total_bytes * free_ratio),
    }


def _read_proc_meminfo_snapshot() -> Optional[dict]:
    """
    Linux fallback: read /proc/meminfo to get total and available memory.

    Uses ``MemAvailable`` (not ``MemFree``) because MemAvailable accounts for
    reclaimable page cache and buffers — it's a better proxy for "memory a
    new process could actually use" than raw free pages.
    """
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return None

    meminfo: dict[str, int] = {}
    for line in lines:
        name, _, value = line.partition(":")
        if not name or not value:
            continue
        parts = value.strip().split()
        if not parts:
            continue
        try:
            meminfo[name] = int(parts[0]) * 1024
        except ValueError:
            continue

    total_bytes = meminfo.get("MemTotal")
    free_bytes = meminfo.get("MemAvailable")
    if not total_bytes or free_bytes is None:
        return None

    free_ratio = max(0.0, min(1.0, free_bytes / total_bytes))
    return {
        "source": "proc_meminfo",
        "totalBytes": total_bytes,
        "freeRatio": free_ratio,
        "freeBytes": free_bytes,
    }


def _system_memory_snapshot() -> Optional[dict]:
    """
    Probe system memory using psutil (cross-platform, no subprocess fork).

    Returns None if the guard is disabled or probing fails — callers
    interpret None as "skip memory-based decisions" (fail-open).

    Uses psutil.virtual_memory() instead of shelling out to
    ``memory_pressure`` or reading ``/proc/meminfo`` to avoid fork()
    in a multi-threaded process (gRPC threads make fork unsafe on macOS).
    """
    if not COMPANION_MEMORY_GUARD_ENABLED:
        return None

    try:
        vm = psutil.virtual_memory()
        total_bytes = vm.total
        available_bytes = vm.available
        free_ratio = max(0.0, min(1.0, available_bytes / total_bytes)) if total_bytes else 0.0
        return {
            "source": "psutil",
            "totalBytes": total_bytes,
            "freeRatio": free_ratio,
            "freeBytes": available_bytes,
        }
    except Exception:
        return None


def _available_memory_budget_mb(snapshot: Optional[dict]) -> Optional[int]:
    """
    Return how many MB are available for workers after reserving OS headroom.

    Replaces the old _qwen_stack_cap_for_memory() which only gated Qwen
    workers.  This version is stack-agnostic: the caller (_apply_memory_guard)
    sums up the per-stack memoryPerWorkerMB values and compares the total
    against the budget returned here.

    Returns None when memory probing is disabled or the snapshot is
    unavailable, which signals callers to skip the guard entirely (fail-open).
    """
    if not snapshot:
        return None
    free_bytes = snapshot.get("freeBytes")
    if free_bytes is None:
        return None
    free_mb = free_bytes / (1024 * 1024)
    # Subtract the OS reserve so we only hand out what workers can safely use.
    return max(0, int(free_mb - COMPANION_OS_RESERVE_MB))


def _queue_metrics_bucket() -> dict:
    return {
        "readyCount": 0,
        "leasedCount": 0,
        "runningCount": 0,
        "oldestReadyAgeSec": None,
        "oldestReadyAt": None,
        "oldestReadyJobId": None,
        "oldestReadyRunId": None,
        "oldestReadyQueueId": None,
    }


def _coerce_datetime(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if hasattr(value, "timestamp"):
        return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)
    return None


def _update_oldest_ready(bucket: dict, payload: dict, now: datetime, queue_id: str) -> None:
    available_at = _coerce_datetime(payload.get("available_at"))
    if available_at is None:
        return
    current_oldest = _coerce_datetime(bucket.get("oldestReadyAt"))
    if current_oldest is not None and current_oldest <= available_at:
        return
    bucket["oldestReadyAt"] = available_at
    bucket["oldestReadyAgeSec"] = max(0, int((now - available_at).total_seconds()))
    bucket["oldestReadyJobId"] = str(payload.get("job_id") or "").strip() or None
    bucket["oldestReadyRunId"] = str(payload.get("run_id") or "").strip() or None
    bucket["oldestReadyQueueId"] = queue_id or None


def _queue_metrics_bucket_for(snapshot: dict, payload: dict) -> dict:
    step_name = str(payload.get("step_name") or "").strip()
    if step_name not in SYNTH_STEP_NAMES:
        return snapshot["nonTts"]

    capability_key = capability_key_for_payload(payload)
    if capability_key.startswith("tts:") and capability_key != "tts:any":
        model_key = capability_key.split(":", 1)[1].strip().lower() or "unassigned"
    else:
        model_key = "unassigned"
    bucket = snapshot["byModel"].get(model_key)
    if bucket is None:
        bucket = _queue_metrics_bucket()
        snapshot["byModel"][model_key] = bucket
    return bucket


def _queue_metrics_capability_bucket(snapshot: dict, payload: dict) -> dict:
    capability_key = capability_key_for_payload(payload)
    bucket = snapshot["byCapability"].get(capability_key)
    if bucket is None:
        bucket = _queue_metrics_bucket()
        snapshot["byCapability"][capability_key] = bucket
    return bucket


def _collect_queue_metrics_snapshot(db) -> dict:
    """
    Snapshot the factory step queue into structured metrics for the admin UI.

    Buckets steps by TTS model, capability key, and overall totals, tracking
    ready/leased/running counts and the age of the oldest ready step.  Also
    computes running-step age percentiles (p50/p95/max) per capability key
    from worker_status heartbeats.

    This is the data that powers the "Queue Health" section in the admin
    dashboard — it's written to Firestore by update_stacks_status().
    """
    now = datetime.now(timezone.utc)
    snapshot = {
        "capturedAt": now,
        "totals": _queue_metrics_bucket(),
        "nonTts": _queue_metrics_bucket(),
        "byModel": {},
        "byCapability": {},
        "runningStepAgeSec": {"byCapability": {}},
    }

    ready_query = (
        db.collection(QUEUE_COLLECTION)
        .where("state", "==", "ready")
        .where("available_at", "<=", now)
        .order_by("available_at")
    )
    leased_query = db.collection(QUEUE_COLLECTION).where("state", "==", "leased")
    running_query = db.collection(QUEUE_COLLECTION).where("state", "==", "running")

    for state, query in (
        ("ready", ready_query),
        ("leased", leased_query),
        ("running", running_query),
    ):
        count_key = f"{state}Count"
        for doc in query.stream():
            payload = doc.to_dict() or {}
            bucket = _queue_metrics_bucket_for(snapshot, payload)
            capability_bucket = _queue_metrics_capability_bucket(snapshot, payload)
            bucket[count_key] += 1
            capability_bucket[count_key] += 1
            snapshot["totals"][count_key] += 1
            if state == "ready":
                _update_oldest_ready(bucket, payload, now, doc.id)
                _update_oldest_ready(capability_bucket, payload, now, doc.id)
                _update_oldest_ready(snapshot["totals"], payload, now, doc.id)

    worker_status_docs = list(db.collection("worker_status").stream())
    ages_by_capability: dict[str, list[int]] = defaultdict(list)
    for doc in worker_status_docs:
        payload = doc.to_dict() or {}
        current_queue_id = str(payload.get("currentQueueId") or "").strip()
        started_at = _coerce_datetime(payload.get("currentStepStartedAt"))
        last_heartbeat = _coerce_datetime(payload.get("lastHeartbeat"))
        if not current_queue_id or started_at is None or last_heartbeat is None:
            continue
        if (now - last_heartbeat).total_seconds() > heartbeat_stale_seconds():
            continue
        capability_key = str(payload.get("currentCapabilityKey") or "default").strip() or "default"
        ages_by_capability[capability_key].append(max(0, int((now - started_at).total_seconds())))

    for capability_key, ages in ages_by_capability.items():
        ordered = sorted(ages)
        if not ordered:
            continue
        p50_index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * 0.50))))
        p95_index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * 0.95))))
        snapshot["runningStepAgeSec"]["byCapability"][capability_key] = {
            "count": len(ordered),
            "p50": ordered[p50_index],
            "p95": ordered[p95_index],
            "max": ordered[-1],
        }

    return snapshot


def init_firebase():
    """Initialize Firebase Admin SDK using service account or default creds."""
    if not firebase_admin._apps:
        key_path = os.getenv(
            "GOOGLE_APPLICATION_CREDENTIALS",
            os.path.join(os.path.dirname(__file__), "..", "service-account-key.json"),
        )

        if os.path.isfile(key_path):
            cred = credentials.Certificate(key_path)
            firebase_admin.initialize_app(
                cred,
                options={
                    "projectId": config.PROJECT_ID,
                    "storageBucket": config.STORAGE_BUCKET,
                },
            )
        else:
            firebase_admin.initialize_app(
                options={
                    "projectId": config.PROJECT_ID,
                    "storageBucket": config.STORAGE_BUCKET,
                }
            )

    return firestore.client()


def ensure_control_doc(db):
    doc_ref = db.collection(CONTROL_COLLECTION).document(CONTROL_DOC_ID)
    snapshot = doc_ref.get()
    if snapshot.exists:
        return

    doc_ref.set(
        {
            "desiredState": "auto",
            "idleTimeoutMin": 10,
            "currentState": "stopped",
            "workerPid": None,
            "lastAction": "init",
            "lastError": None,
            "lastChangeAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def update_control(db, data: dict) -> None:
    db.collection(CONTROL_COLLECTION).document(CONTROL_DOC_ID).set(
        {**data, "lastChangeAt": firestore.SERVER_TIMESTAMP},
        merge=True,
    )


def get_control(db) -> dict:
    doc_ref = db.collection(CONTROL_COLLECTION).document(CONTROL_DOC_ID)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        return {}
    return snapshot.to_dict() or {}


def update_stacks_status(
    db,
    stack_defs: list[dict],
    running: dict[str, int],
    queue_metrics: dict | None = None,
) -> None:
    """
    Write aggregate stack status + queue metrics to Firestore for the admin UI.

    The admin dashboard reads ``worker_stacks_status/local`` to display which
    stacks are running, their capabilities, PIDs, and queue health.  This is
    a denormalized view — easier for the React frontend to consume than
    joining multiple collections.
    """
    doc_ref = db.collection("worker_stacks_status").document("local")
    stack_entries = []
    now = datetime.now(timezone.utc)
    for stack_def in stack_defs:
        stack_id = stack_def.get("id")
        stack_entries.append({
            "id": stack_id,
            "role": stack_def.get("role"),
            "venv": stack_def.get("venv"),
            "enabled": bool(stack_def.get("enabled", True)),
            "dispatch": bool(stack_def.get("dispatch", False)),
            "acceptNonTtsSteps": bool(stack_def.get("acceptNonTtsSteps", True)),
            "ttsModels": list(stack_def.get("ttsModels") or []),
            "capabilityKeys": stack_capability_keys(stack_def),
            "pid": running.get(stack_id),
            "logPath": stacks.log_path(stack_id),
            "lastUpdatedAt": now,
        })
    doc_ref.set(
        {
            "stacks": stack_entries,
            "queueMetrics": queue_metrics or {},
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def has_pending_jobs(db) -> bool:
    jobs_ref = db.collection(JOBS_COLLECTION)
    q = jobs_ref.where("status", "in", ["pending", "publishing"]).limit(1)
    return any(q.stream())


def has_delete_requested_jobs(db) -> bool:
    jobs_ref = db.collection(JOBS_COLLECTION)
    q = jobs_ref.where("deleteRequested", "==", True).limit(1)
    return any(q.stream())


def _load_queue_payloads(db, limit: int = AUTO_STACK_QUEUE_SCAN_LIMIT) -> list[dict]:
    now = datetime.now(timezone.utc)
    payloads: list[dict] = []

    ready_query = (
        db.collection(QUEUE_COLLECTION)
        .where("state", "==", "ready")
        .where("available_at", "<=", now)
        .order_by("available_at")
        .limit(limit)
    )
    leased_query = db.collection(QUEUE_COLLECTION).where("state", "==", "leased").limit(limit)
    running_query = db.collection(QUEUE_COLLECTION).where("state", "==", "running").limit(limit)

    for query in (ready_query, leased_query, running_query):
        for doc in query.stream():
            payload = doc.to_dict() or {}
            if payload:
                payload["_queue_id"] = doc.id
                payloads.append(payload)

    return payloads


def _worker_status_heartbeat_is_fresh(status: dict | None, now: datetime) -> bool:
    if not status:
        return False
    last_heartbeat = _coerce_datetime(status.get("lastHeartbeat"))
    if last_heartbeat is None:
        return False
    return (now - last_heartbeat).total_seconds() <= heartbeat_stale_seconds()


def _queue_payload_is_recent(payload: dict, now: datetime) -> bool:
    lease_expires_at = _coerce_datetime(payload.get("lease_expires_at"))
    if lease_expires_at is not None and lease_expires_at > now:
        return True

    for field_name in ("step_started_at", "updated_at"):
        field_value = _coerce_datetime(payload.get(field_name))
        if field_value is None:
            continue
        if (now - field_value).total_seconds() <= AUTO_STACK_OWNERSHIP_GRACE_SEC:
            return True
    return False


def _queue_payload_counts_as_live_work(
    payload: dict,
    *,
    worker_status_by_id: dict[str, dict],
    now: datetime,
) -> bool:
    """
    Determine if a queue entry represents genuine in-progress or pending work.

    A step that's "leased" or "running" only counts if its owner worker has
    a fresh heartbeat — otherwise the worker likely crashed and the step is
    orphaned (the recovery manager will handle it separately).  "ready"
    steps always count because they're waiting for a worker to pick them up.
    """
    state = str(payload.get("state") or "").strip().lower()
    if state == "ready":
        return True
    if state not in {"leased", "running"}:
        return False

    owner = str(payload.get("lease_owner") or "").strip()
    if not owner:
        return False

    status = worker_status_by_id.get(owner)
    if not _worker_status_heartbeat_is_fresh(status, now):
        return False

    queue_id = str(payload.get("_queue_id") or "").strip()
    current_queue_id = str((status or {}).get("currentQueueId") or "").strip()
    if queue_id and current_queue_id == queue_id:
        return True
    if current_queue_id:
        return False
    return _queue_payload_is_recent(payload, now)


def _collect_auto_workload_from_payloads(
    queue_payloads: list[dict],
    *,
    worker_status_by_id: dict[str, dict],
    now: datetime,
) -> dict:
    """
    Classify queued work into demand buckets the auto-scaler can act on.

    Scans the factory step queue and counts outstanding steps per category:
      - non_tts_outstanding: script generation, formatting, upload, etc.
      - image_outstanding: image generation steps.
      - tts_outstanding: per-model TTS step counts (e.g. {"qwen3-base": 3}).
      - wildcard_tts_outstanding: TTS steps with no specific model preference.
      - active_owners: set of worker IDs currently leasing a step.

    The active_owners set is critical for the memory guard — workers in this
    set are never evicted, even under memory pressure.
    """
    tts_outstanding: dict[str, int] = defaultdict(int)
    wildcard_tts_outstanding = 0
    non_tts_outstanding = 0
    image_outstanding = 0
    active_owners: set[str] = set()

    for payload in queue_payloads:
        state = str(payload.get("state") or "").strip().lower()
        if not _queue_payload_counts_as_live_work(
            payload,
            worker_status_by_id=worker_status_by_id,
            now=now,
        ):
            continue

        lease_owner = str(payload.get("lease_owner") or "").strip()
        if state in {"leased", "running"} and lease_owner:
            active_owners.add(lease_owner)

        capability_key = capability_key_for_payload(payload)
        if capability_key == "image":
            image_outstanding += 1
            continue
        if not capability_key.startswith("tts:"):
            non_tts_outstanding += 1
            continue

        if capability_key == "tts:any":
            wildcard_tts_outstanding += 1
            continue

        model = capability_key.split(":", 1)[1].strip().lower()
        if model:
            tts_outstanding[model] += 1
        else:
            wildcard_tts_outstanding += 1

    return {
        "pending_jobs": False,
        "delete_jobs": False,
        "non_tts_outstanding": non_tts_outstanding,
        "image_outstanding": image_outstanding,
        "tts_outstanding": dict(tts_outstanding),
        "wildcard_tts_outstanding": wildcard_tts_outstanding,
        "active_owners": active_owners,
        "has_any_work": (
            non_tts_outstanding > 0
            or image_outstanding > 0
            or wildcard_tts_outstanding > 0
            or any(tts_outstanding.values())
        ),
    }


def _collect_auto_workload(db) -> dict:
    """
    Full workload snapshot: queue demand + pending/delete jobs from Firestore.

    Combines step-queue analysis (from _collect_auto_workload_from_payloads)
    with job-level checks (has_pending_jobs, has_delete_requested_jobs) to
    produce the workload dict consumed by _desired_auto_stack_ids().
    """
    now = datetime.now(timezone.utc)
    queue_payloads = _load_queue_payloads(db)
    worker_status_by_id = {
        doc.id: (doc.to_dict() or {})
        for doc in db.collection("worker_status").stream()
    }
    workload = _collect_auto_workload_from_payloads(
        queue_payloads,
        worker_status_by_id=worker_status_by_id,
        now=now,
    )
    pending_jobs = has_pending_jobs(db)
    delete_jobs = has_delete_requested_jobs(db)
    workload["pending_jobs"] = pending_jobs
    workload["delete_jobs"] = delete_jobs
    workload["has_any_work"] = (
        pending_jobs
        or delete_jobs
        or workload["non_tts_outstanding"] > 0
        or workload["image_outstanding"] > 0
        or workload["wildcard_tts_outstanding"] > 0
        or any(workload["tts_outstanding"].values())
    )

    return workload


def _ordered_candidate_ids(
    candidate_stacks: list[dict],
    running_ids: set[str],
    active_owners: set[str],
) -> list[str]:
    """
    Sort candidate stacks into priority order: active → warm → cold.

    This ordering drives a "prefer reuse" heuristic — we'd rather give work
    to a worker that's already loaded into memory (warm) than spawn a fresh
    one (cold), and we never preempt a worker that's actively processing a
    job (active).
    """
    active = [stack["id"] for stack in candidate_stacks if stack["id"] in active_owners]
    warm = [
        stack["id"]
        for stack in candidate_stacks
        if stack["id"] in running_ids and stack["id"] not in active_owners
    ]
    cold = [stack["id"] for stack in candidate_stacks if stack["id"] not in running_ids]
    return active + warm + cold


def _pick_stack_ids(
    candidate_stacks: list[dict],
    needed_count: int,
    running_ids: set[str],
    active_owners: set[str],
    selected_ids: set[str],
) -> list[str]:
    """
    Select up to ``needed_count`` stacks from candidates, respecting priority.

    Key invariant: active workers (those currently leasing a job) are *always*
    kept, even if that pushes the count above ``needed_count``.  This prevents
    killing a worker mid-job just because the scaler thinks fewer are needed.

    Returns only the *newly added* IDs (not those already in selected_ids).
    """
    if needed_count <= 0 or not candidate_stacks:
        return []

    ordered_ids = _ordered_candidate_ids(candidate_stacks, running_ids, active_owners)
    candidate_ids = {stack["id"] for stack in candidate_stacks}
    active_candidate_ids = [
        stack_id for stack_id in ordered_ids if stack_id in active_owners
    ]
    target_count = max(needed_count, len(active_candidate_ids))

    final_selected = {
        stack_id for stack_id in selected_ids if stack_id in candidate_ids
    }
    additions: list[str] = []

    for stack_id in active_candidate_ids:
        if stack_id in final_selected:
            continue
        additions.append(stack_id)
        final_selected.add(stack_id)

    for stack_id in ordered_ids:
        if len(final_selected) >= target_count:
            break
        if stack_id in final_selected:
            continue
        additions.append(stack_id)
        final_selected.add(stack_id)

    return additions


def _measure_process_rss_mb(pid: int) -> Optional[int]:
    """Return actual RSS of a process in MB, or None if unavailable."""
    try:
        proc = psutil.Process(pid)
        return int(proc.memory_info().rss / (1024 * 1024))
    except (psutil.NoSuchProcess, psutil.AccessDenied, Exception):
        return None


def _apply_memory_guard(
    enabled_stacks: list[dict],
    desired_ids: set[str],
    running: dict[str, int],
    active_owners: set[str],
) -> tuple[set[str], Optional[dict]]:
    """
    Pre-spawn gate: drop lowest-priority idle workers until the desired set
    fits in available memory.

    Uses **actual RSS** for running workers (measured via psutil) instead of
    declared budgets, so the guard accurately reflects real memory usage.
    Only cold (not-yet-spawned) workers are costed by their declared
    memoryPerWorkerMB — since they haven't consumed any RAM yet.

    The budget is the current free RAM minus OS reserve.  Running workers'
    memory is already consumed (not part of free RAM), so only new spawns
    are checked against the budget.

    Priority tiers (never violated):
      1. Active workers (currently leasing a job) — **never** evicted.
      2. Warm idle (process alive, no active job) — evicted second.
      3. Cold (not yet spawned) — evicted first, since no process to kill.

    Within each tier, the largest-cost worker is evicted first (greedy
    knapsack heuristic).

    Returns the (possibly reduced) set of desired IDs and the memory
    snapshot used, so callers can log it or attach it to workload metadata.
    """
    snapshot = _system_memory_snapshot()
    budget_mb = _available_memory_budget_mb(snapshot)
    if budget_mb is None:
        return desired_ids, snapshot

    stacks_by_id = {stack["id"]: stack for stack in enabled_stacks}

    def _declared_mem(stack_id: str) -> int:
        """Declared memory budget for a stack, defaulting to 3 GB."""
        stack = stacks_by_id.get(stack_id)
        return (stack.get("memoryPerWorkerMB") or 3000) if stack else 3000

    def _cost(stack_id: str) -> int:
        """Actual RSS for running workers, declared budget for cold ones."""
        pid = running.get(stack_id)
        if pid is not None:
            rss = _measure_process_rss_mb(pid)
            if rss is not None:
                return rss
        return _declared_mem(stack_id)

    # Only cold workers (not yet spawned) need free RAM.  Running workers
    # already consumed their memory — it's not part of the free budget.
    cold_ids = {sid for sid in desired_ids if sid not in running}
    new_spawn_cost_mb = sum(_declared_mem(sid) for sid in cold_ids)

    # Fast path: new spawns fit in available budget.
    if new_spawn_cost_mb <= budget_mb:
        return desired_ids, snapshot

    # --- Classify desired workers into priority tiers ---
    active_ids = {sid for sid in desired_ids if sid in active_owners}
    warm_ids = {sid for sid in desired_ids if sid not in active_owners and sid in running}

    # Build eviction order: cold first (prevent spawn), then warm idle
    # (kill to free RAM for higher-priority spawns).  Largest cost first.
    eviction_order = (
        sorted(cold_ids - active_ids, key=lambda sid: _cost(sid), reverse=True)
        + sorted(warm_ids, key=lambda sid: _cost(sid), reverse=True)
    )

    # --- Greedy eviction loop ---
    remaining = set(desired_ids)
    current_new_cost = new_spawn_cost_mb
    for sid in eviction_order:
        if current_new_cost <= budget_mb:
            break
        remaining.discard(sid)
        if sid in cold_ids:
            # Dropping a cold worker reduces the spawn cost directly.
            current_new_cost -= _declared_mem(sid)
        else:
            # Stopping a warm worker frees its actual RSS, adding to budget.
            budget_mb += _cost(sid)

    if remaining != desired_ids:
        logger.info(
            "Memory guard reduced worker pool to fit available budget",
            extra={
                "free_ratio": snapshot.get("freeRatio") if snapshot else None,
                "budget_mb": budget_mb,
                "new_spawn_cost_mb": new_spawn_cost_mb,
                "evicted": sorted(desired_ids - remaining),
                "kept": sorted(remaining),
            },
        )

    return remaining, snapshot


def _check_memory_pressure(
    enabled_stacks: list[dict],
    running: dict[str, int],
    active_owners: set[str],
) -> set[str]:
    """
    Emergency watchdog: if free memory is critically low, pick idle workers
    to stop.

    This is a **reactive** safety net that runs every control-loop iteration,
    independent of the normal scaling plan.  It catches cases where actual
    worker memory usage exceeds the declared memoryPerWorkerMB budgets (e.g.
    an image model loading an unexpectedly large checkpoint).

    Complementary to _apply_memory_guard (proactive / pre-spawn):
      • _apply_memory_guard — decides what *should* run based on declared budgets.
      • _check_memory_pressure — reacts to what *is* happening based on real
        free-memory readings from the OS.

    Returns the set of stack IDs that should be force-stopped.  The caller
    (run_control_loop) is responsible for actually killing the processes.
    """
    snapshot = _system_memory_snapshot()
    if not snapshot:
        return set()

    free_ratio = snapshot.get("freeRatio")
    if free_ratio is None or free_ratio > COMPANION_CRITICAL_FREE_RATIO:
        # Memory is fine — nothing to do.
        return set()

    stacks_by_id = {stack["id"]: stack for stack in enabled_stacks}

    # Only idle workers (running but not actively leasing a job) are eligible
    # for eviction.  Active workers are never killed — we'd rather OOM than
    # corrupt a half-finished job.
    idle_running = [
        sid for sid in running
        if sid not in active_owners and sid in stacks_by_id
    ]
    if not idle_running:
        logger.warning(
            "Memory pressure critical but all running workers are active — cannot evict",
            extra={
                "free_ratio": free_ratio,
                "free_bytes": snapshot.get("freeBytes"),
                "running": sorted(running.keys()),
                "active_owners": sorted(active_owners),
            },
        )
        return set()

    # Greedy eviction: largest actual-RSS idle workers first, so we reclaim
    # the most memory per kill.  Uses measured RSS via psutil rather than
    # declared budgets for accurate projection.
    def _rss_bytes(sid: str) -> int:
        pid = running.get(sid)
        if pid is not None:
            rss_mb = _measure_process_rss_mb(pid)
            if rss_mb is not None:
                return rss_mb * 1024 * 1024
        return stacks_by_id[sid].get("memoryPerWorkerMB", 3000) * 1024 * 1024

    idle_running.sort(key=lambda sid: _rss_bytes(sid), reverse=True)

    total_bytes = snapshot.get("totalBytes", 1)
    free_bytes = snapshot.get("freeBytes", 0)
    evict: set[str] = set()

    for sid in idle_running:
        evict.add(sid)
        freed = _rss_bytes(sid)
        projected_free = free_bytes + freed
        projected_ratio = projected_free / total_bytes
        if projected_ratio > COMPANION_CRITICAL_FREE_RATIO:
            break

    logger.warning(
        "Memory pressure watchdog evicting idle workers",
        extra={
            "free_ratio": free_ratio,
            "free_bytes": snapshot.get("freeBytes"),
            "evicting": sorted(evict),
        },
    )
    return evict


def _desired_auto_stack_ids(
    db,
    enabled_stacks: list[dict],
    running: dict[str, int],
) -> tuple[set[str], dict]:
    """
    Core auto-scaler: determine which stack IDs should be running right now.

    Walks each demand category (non-TTS, image, per-model TTS, wildcard TTS)
    and picks the minimum set of stacks that can serve the outstanding work.
    Then passes the desired set through _apply_memory_guard() to ensure the
    total memory footprint fits in available RAM.

    Returns:
        desired_ids: Stack IDs that should be alive after this iteration.
        workload: The full workload snapshot (for logging / admin UI).
    """
    workload = _collect_auto_workload(db)
    running_ids = set(running.keys())
    active_owners = workload["active_owners"]
    desired_ids: set[str] = set()

    if (
        workload["pending_jobs"]
        or workload["delete_jobs"]
        or workload["non_tts_outstanding"] > 0
    ):
        non_tts_candidates = [stack for stack in enabled_stacks if stack.get("acceptNonTtsSteps", True)]
        desired_ids.update(
            _pick_stack_ids(
                non_tts_candidates,
                needed_count=min(1, len(non_tts_candidates)),
                running_ids=running_ids,
                active_owners=active_owners,
                selected_ids=desired_ids,
            )
        )

    if workload["image_outstanding"] > 0:
        image_candidates = [
            stack for stack in enabled_stacks if "image" in stack_capability_keys(stack)
        ]
        desired_ids.update(
            _pick_stack_ids(
                image_candidates,
                needed_count=min(1, len(image_candidates)),
                running_ids=running_ids,
                active_owners=active_owners,
                selected_ids=desired_ids,
            )
        )

    for model_id, outstanding_count in sorted(workload["tts_outstanding"].items()):
        tts_candidates = [
            stack for stack in enabled_stacks if stack_supports_tts_model(stack, model_id)
        ]
        desired_ids.update(
            _pick_stack_ids(
                tts_candidates,
                needed_count=min(outstanding_count, len(tts_candidates)),
                running_ids=running_ids,
                active_owners=active_owners,
                selected_ids=desired_ids,
            )
        )

    wildcard_tts_outstanding = workload["wildcard_tts_outstanding"]
    if wildcard_tts_outstanding > 0:
        wildcard_candidates = [
            stack
            for stack in enabled_stacks
            if stack.get("ttsModels") or stack.get("acceptNonTtsSteps", True)
        ]
        desired_ids.update(
            _pick_stack_ids(
                wildcard_candidates,
                needed_count=min(wildcard_tts_outstanding, len(wildcard_candidates)),
                running_ids=running_ids,
                active_owners=active_owners,
                selected_ids=desired_ids,
            )
        )

    desired_ids, memory_snapshot = _apply_memory_guard(
        enabled_stacks,
        desired_ids,
        running,
        active_owners,
    )
    if memory_snapshot:
        workload["system_memory"] = memory_snapshot
        workload["memory_budget_mb"] = _available_memory_budget_mb(memory_snapshot)

    return desired_ids, workload


def _desired_running_stack_ids(
    db,
    enabled_stacks: list[dict],
    running: dict[str, int],
) -> tuple[set[str], dict]:
    """
    "Running" mode scaler: all enabled stacks should be up, subject to memory.

    Unlike auto mode, this doesn't look at queue demand — the admin has
    explicitly requested everything on.  The memory guard still applies
    though, so on a RAM-constrained machine some stacks may be dropped.
    """
    workload = _collect_auto_workload(db)
    desired_ids = {stack["id"] for stack in enabled_stacks}
    desired_ids, memory_snapshot = _apply_memory_guard(
        enabled_stacks,
        desired_ids,
        running,
        workload["active_owners"],
    )
    if memory_snapshot:
        workload["system_memory"] = memory_snapshot
        workload["memory_budget_mb"] = _available_memory_budget_mb(memory_snapshot)
    return desired_ids, workload


def _normalize_desired_state(db, control: dict) -> str:
    """
    Canonicalize the desiredState from the control doc.

    Special case: if the state is "running" but was set by the wake-dispatcher
    (i.e. a job arrived), auto-promote to "auto" mode.  This prevents the
    system from staying in forced-running mode indefinitely after a single wake.
    """
    desired_state = str(control.get("desiredState") or "stopped").strip().lower() or "stopped"
    requested_by = str(control.get("requestedBy") or "").strip().lower()

    if desired_state == "running" and requested_by == "wake-dispatcher":
        update_control(
            db,
            {
                "desiredState": "auto",
                "lastAction": "wake-dispatcher",
                "requestedBy": "wake-dispatcher",
            },
        )
        return "auto"

    return desired_state


def _recover_running_course_pipeline_gaps(db) -> dict[str, int]:
    """
    Periodically scan for stuck pipeline steps and recycle their workers.

    The recovery manager detects steps that have been "running" longer than
    the heartbeat timeout — which means the worker likely crashed or hung.
    For each stuck step, we stop and restart the owning worker (recycle)
    and re-queue the step so another worker can pick it up.

    This is the companion's self-healing mechanism — without it, a single
    worker crash could leave a job permanently stuck.
    """
    from factory_v2.application.orchestrator import Orchestrator
    from factory_v2.infrastructure.firestore_repos import (
        FirestoreEventRepo,
        FirestoreJobRepo,
        FirestoreRunRepo,
        FirestoreStepRunRepo,
    )
    from factory_v2.infrastructure.queue_repo import FirestoreQueueRepo
    from factory_v2.interfaces.recovery_manager import RecoveryManager

    stack_defs = stacks.load_worker_stacks()
    stack_by_id = {str(stack.get("id")): stack for stack in stack_defs}

    def _recycle_worker_stack(worker_id: str, payload: dict) -> dict[str, bool]:
        stack_id = str(worker_id or "").strip()
        stack_def = stack_by_id.get(stack_id)
        running = stacks.running_stack_pids(stack_defs)
        recycled = False
        terminated = stack_id not in running
        if stack_id in running:
            stacks.stop_worker(stack_id)
            terminated = not stacks.is_worker_running(stack_id)
            recycled = terminated
        if terminated and stack_def and bool(stack_def.get("enabled", True)):
            running_after = stacks.running_stack_pids(stack_defs)
            if stack_id not in running_after:
                stacks.start_worker(stack_def)
                recycled = True
        logger.warning(
            "Companion recycled worker for stuck step",
            extra={
                "worker_id": stack_id or None,
                "run_id": str(payload.get("run_id") or "") or None,
                "step_name": str(payload.get("step_name") or "") or None,
                "terminated": terminated,
                "recycled": recycled,
            },
        )
        return {"terminated": terminated, "recycled": recycled}

    job_repo = FirestoreJobRepo(db)
    run_repo = FirestoreRunRepo(db)
    step_run_repo = FirestoreStepRunRepo(db)
    queue_repo = FirestoreQueueRepo(db)
    recovery_manager = RecoveryManager(
        db=db,
        job_repo=job_repo,
        step_run_repo=step_run_repo,
        queue_repo=queue_repo,
        run_repo=run_repo,
        event_repo=FirestoreEventRepo(db),
        orchestrator=Orchestrator(
            job_repo,
            run_repo,
            step_run_repo,
            queue_repo,
        ),
        worker_recycler=_recycle_worker_stack,
    )
    return recovery_manager.recover_companion_tick()


def ensure_running_wrapper(db, force_immediate_start: bool):
    """
    Wake handler called by the Firestore job listener when new work arrives.

    Bridges the listener (listener.py) and the control loop: sets the
    desired state to "running" or "auto" in Firestore, and optionally
    starts workers immediately (force_immediate_start=True) so the first
    step doesn't wait for the next poll interval.
    """
    control = get_control(db)
    current_desired = _normalize_desired_state(db, control)
    next_desired = "running" if current_desired == "running" else "auto"

    update_control(
        db,
        {
            "desiredState": next_desired,
            "lastAction": "wake-dispatcher",
            "requestedBy": "wake-dispatcher",
        },
    )

    if not force_immediate_start:
        return

    stack_defs = stacks.load_worker_stacks()
    enabled_stacks = [stack for stack in stack_defs if stack.get("enabled", True)]
    running = stacks.running_stack_pids(stack_defs)

    if next_desired == "running":
        desired_ids, _ = _desired_running_stack_ids(db, enabled_stacks, running)
    else:
        desired_ids, _ = _desired_auto_stack_ids(db, enabled_stacks, running)

    for stack in enabled_stacks:
        stack_id = stack["id"]
        if stack_id in desired_ids and stack_id not in running:
            running[stack_id] = stacks.start_worker(stack)

    for stack_id in list(running.keys()):
        if stack_id in desired_ids:
            continue
        stacks.stop_worker(stack_id)
        running.pop(stack_id, None)

    running_after = {stack_id: pid for stack_id, pid in running.items() if stack_id in desired_ids}
    update_control(
        db,
        {
            "currentState": "running" if running_after else "stopped",
            "workerPid": stacks.primary_pid(enabled_stacks, running_after) if running_after else None,
            "lastAction": "wake-dispatcher",
            "lastError": None,
        },
    )
    logger.info(
        "Wake ensure_running applied",
        extra={
            "desired_state": next_desired,
            "desired_stacks": sorted(desired_ids),
            "running": sorted(running_after.keys()),
        },
    )


def run_control_loop(db, poll_seconds: float, force_immediate_start: bool):
    """
    Main reconciliation loop — runs forever until KeyboardInterrupt.

    Each iteration:
      1. Read desired state from Firestore control doc.
      2. Periodically run pipeline recovery (self-healing for stuck steps).
      3. Reload stack config and collect running PIDs.
      4. Publish queue metrics + log tails to Firestore (for admin UI).
      5. Stop any disabled stacks that are still running.
      6. Run the emergency memory watchdog (reactive eviction).
      7. Based on desired state, compute desired stack IDs:
         - "running" → all enabled stacks (capped by memory guard).
         - "auto"    → only stacks needed for current queue demand.
         - "stopped" → nothing.
      8. Start missing stacks, stop excess stacks, update control doc.
      9. Sleep with random jitter to prevent thundering herd on restarts.

    Args:
        db: Firestore client.
        poll_seconds: Base sleep between iterations.
        force_immediate_start: If True, start stacks on the very first
            iteration without waiting for a full poll cycle.
    """
    last_activity_ts = time.time()
    last_factory_recovery_ts = 0.0
    last_queue_metrics_ts = 0.0
    queue_metrics_snapshot: dict | None = None
    log_tail_enabled = os.getenv("ENABLE_ADMIN_LOG_TAIL", "true").lower() == "true"
    log_tailer = None
    if log_tail_enabled:
        log_tailer = LogTailPublisher(
            db,
            max_lines=int(os.getenv("ADMIN_LOG_TAIL_MAX_LINES", "120")),
            max_line_chars=int(os.getenv("ADMIN_LOG_TAIL_MAX_LINE_CHARS", "500")),
            min_level=os.getenv("ADMIN_LOG_MIN_LEVEL", "INFO"),
            interval_sec=float(os.getenv("ADMIN_LOG_TAIL_INTERVAL_SEC", "2")),
        )

    while True:
        try:
            control = get_control(db)
            desired_state = _normalize_desired_state(db, control)
            idle_timeout_min = int(control.get("idleTimeoutMin", 10))

            now_ts = time.time()
            if (
                desired_state != "stopped"
                and now_ts - last_factory_recovery_ts >= COMPANION_FACTORY_RECOVERY_INTERVAL_SEC
            ):
                last_factory_recovery_ts = now_ts
                recovered = _recover_running_course_pipeline_gaps(db)
                if any(recovered.values()):
                    logger.info(
                        "Companion recovered factory pipeline gaps",
                        extra=recovered,
                    )

            stack_defs = stacks.load_worker_stacks()
            enabled_stacks = [s for s in stack_defs if s.get("enabled", True)]
            running = stacks.running_stack_pids(stack_defs)
            try:
                if (
                    queue_metrics_snapshot is None
                    or now_ts - last_queue_metrics_ts >= COMPANION_QUEUE_METRICS_INTERVAL_SEC
                ):
                    queue_metrics_snapshot = _collect_queue_metrics_snapshot(db)
                    last_queue_metrics_ts = now_ts
                update_stacks_status(
                    db,
                    stack_defs,
                    running,
                    queue_metrics=queue_metrics_snapshot,
                )
            except Exception as e:
                logger.warning("Failed to update stacks status", extra={"error": str(e)})
            if log_tailer:
                try:
                    stack_logs = [
                        {**stack_def, "logPath": stacks.log_path(stack_def["id"])}
                        for stack_def in stack_defs
                    ]
                    log_tailer.publish(stack_logs, running)
                except Exception as e:
                    logger.warning("Failed to publish log tails", extra={"error": str(e)})

            # Stop any disabled stacks that are still running
            for stack_def in stack_defs:
                if not stack_def.get("enabled", True) and stack_def["id"] in running:
                    stacks.stop_worker(stack_def["id"])
                    running.pop(stack_def["id"], None)

            # ── Emergency memory pressure watchdog ──────────────────────────
            # Runs every loop iteration *before* the scaling decision.  We pass
            # an empty active_owners set because we haven't queried workload yet;
            # this is intentionally conservative — every running worker is treated
            # as idle and therefore eviction-eligible.  The normal spawn-gate
            # (_apply_memory_guard) runs later with real active_owners and will
            # protect workers that are actually processing jobs.
            pressure_evict = _check_memory_pressure(enabled_stacks, running, set())
            for sid in pressure_evict:
                if sid in running:
                    stacks.stop_worker(sid)
                    running.pop(sid, None)

            auto_desired_ids: set[str] = set()
            workload: dict | None = None
            if desired_state == "auto":
                auto_desired_ids, workload = _desired_auto_stack_ids(db, enabled_stacks, running)

            if workload and workload.get("has_any_work"):
                last_activity_ts = time.time()

            any_running = any(stack_def["id"] in running for stack_def in enabled_stacks)

            if desired_state == "running":
                running_desired_ids, _ = _desired_running_stack_ids(
                    db,
                    enabled_stacks,
                    running,
                )
                missing_running_stacks = [
                    stack_def
                    for stack_def in enabled_stacks
                    if stack_def["id"] in running_desired_ids and stack_def["id"] not in running
                ]
                stopped_running_stacks = False

                for stack_id in list(running.keys()):
                    if stack_id in running_desired_ids:
                        continue
                    stacks.stop_worker(stack_id)
                    running.pop(stack_id, None)
                    stopped_running_stacks = True

                if missing_running_stacks:
                    update_control(db, {"currentState": "starting", "lastAction": "start"})
                    for stack_def in missing_running_stacks:
                        running[stack_def["id"]] = stacks.start_worker(stack_def)

                if (
                    missing_running_stacks
                    or stopped_running_stacks
                    or not any_running
                ):
                    last_action = (
                        "memory-scale-down"
                        if stopped_running_stacks and not missing_running_stacks
                        else "start"
                    )
                    update_control(
                        db,
                        {
                            "currentState": "running" if running else "stopped",
                            "workerPid": (
                                stacks.primary_pid(enabled_stacks, running)
                                if running
                                else None
                            ),
                            "lastAction": last_action,
                            "lastError": None,
                        },
                    )
                else:
                    update_control(
                        db,
                        {
                            "currentState": "running",
                            "workerPid": stacks.primary_pid(enabled_stacks, running),
                        },
                    )

            elif desired_state == "stopped":
                if any_running:
                    update_control(db, {"currentState": "stopping", "lastAction": "stop"})
                    for stack_id in list(running.keys()):
                        stacks.stop_worker(stack_id)
                    running.clear()
                    update_control(
                        db,
                        {
                            "currentState": "stopped",
                            "workerPid": None,
                            "lastAction": "stop",
                            "lastError": None,
                        },
                    )
                else:
                    update_control(db, {"currentState": "stopped", "workerPid": None})

            else:
                # Auto mode
                if auto_desired_ids:
                    missing_auto_stacks = [
                        stack_def
                        for stack_def in enabled_stacks
                        if stack_def["id"] in auto_desired_ids and stack_def["id"] not in running
                    ]
                    if missing_auto_stacks:
                        update_control(
                            db,
                            {"currentState": "starting", "lastAction": "auto-start"},
                        )
                        for stack_def in missing_auto_stacks:
                            running[stack_def["id"]] = stacks.start_worker(stack_def)

                    stopped_auto_stacks = False
                    for stack_id in list(running.keys()):
                        if stack_id in auto_desired_ids:
                            continue
                        stacks.stop_worker(stack_id)
                        running.pop(stack_id, None)
                        stopped_auto_stacks = True

                    update_payload = {
                        "currentState": "running" if running else "stopped",
                        "workerPid": stacks.primary_pid(enabled_stacks, running) if running else None,
                        "lastError": None,
                    }
                    if missing_auto_stacks:
                        update_payload["lastAction"] = "auto-start"
                    elif stopped_auto_stacks:
                        update_payload["lastAction"] = "auto-scale-down"

                    update_control(db, update_payload)
                elif any_running:
                    idle_sec = time.time() - last_activity_ts
                    if idle_sec >= idle_timeout_min * 60:
                        update_control(
                            db,
                            {"currentState": "stopping", "lastAction": "auto-stop"},
                        )
                        for stack_id in list(running.keys()):
                            stacks.stop_worker(stack_id)
                        running.clear()
                        update_control(
                            db,
                            {
                                "currentState": "stopped",
                                "workerPid": None,
                                "lastAction": "auto-stop",
                                "lastError": None,
                            },
                        )
                elif any_running:
                    update_control(
                        db,
                        {
                            "currentState": "running",
                            "workerPid": stacks.primary_pid(enabled_stacks, running),
                        },
                    )
                else:
                    update_control(db, {"currentState": "stopped", "workerPid": None})

            # Random jitter ±0.3s prevents multiple companion restarts from
            # synchronizing their poll cycles and hammering Firestore in lockstep.
            jitter = random.uniform(-0.3, 0.3)
            time.sleep(max(0.5, poll_seconds + jitter))

        except KeyboardInterrupt:
            logger.info("Stopped by user")
            raise
        except Exception as e:
            update_control(db, {"lastError": f"{type(e).__name__}: {e}"})
            logger.exception("Companion error", extra={"error": str(e)})
            jitter = random.uniform(-0.3, 0.3)
            time.sleep(max(0.5, poll_seconds + jitter))
