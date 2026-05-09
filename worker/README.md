# `worker/` — the Calmdemy Content Factory

This folder is the **audio-content production engine** behind the Calmdemy app. It takes a content brief from the admin UI (e.g. "10-minute guided meditation about morning anxiety, calm female voice") and produces the finished MP3 + thumbnail + metadata that the mobile app streams to users.

Everything here runs locally on a workstation and pushes results to Firestore + Cloud Storage. The mobile app and admin UI never talk to this code directly — they only see the *outputs* in Firestore.

> **First time here?** Skim sections 1–4. Editing existing code? Section 5 (folder map). Adding a new step? Read [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](HOW_TO_ADD_A_STEP_TO_PIPELINE.md) instead — this doc covers what's already there; that one covers how to extend it.

---

## 1. What this folder does

```
admin UI → Firestore (content_jobs)
              ↓
          [companion]  ← long-lived supervisor; spawns workers
              ↓
       [worker stack 1] ── claims & runs steps
       [worker stack 2] ── claims & runs steps
       [worker stack N] ── claims & runs steps
              ↓
      Firestore + Cloud Storage  ← finished audio + metadata
              ↓
          mobile app
```

Each **content job** flows through a DAG of **steps** (script generation → image → TTS → assembly → upload → publish). Steps run as queue items in Firestore; **worker processes** claim them, execute, and report back. A separate **companion process** decides how many workers to keep alive based on demand.

Three persistent Firestore collections are the source of truth:

| Collection | Owns | Read by |
|---|---|---|
| `content_jobs` | the admin's request (legacy/external contract) | admin UI, dispatcher |
| `factory_jobs` / `factory_job_runs` / `factory_step_runs` / `factory_step_queue` / `factory_events` | V2 internal state | this worker |
| `users`, `subjects`, `courses`, `sessions`, `guided_meditations`, etc. | the published mobile-app data | mobile app, admin UI |

---

## 2. The 30-second tour

```
worker/
├── local_companion.py    ← entrypoint: companion supervisor
├── local_worker.py       ← entrypoint: worker subprocess
├── run_companion.sh      ← bootstrap script (provisions venvs, runs companion)
├── worker_stacks.json    ← which worker stacks exist and their config
├── requirements.*.txt    ← per-venv pip dependencies
│
├── companion/            ← supervisor logic (autoscaler, listeners, subprocess mgmt)
├── factory_v2/           ← the actual job-processing engine (5 layers)
│   ├── domain/             — entities + state machine (no I/O)
│   ├── application/        — orchestrator + commands (workflow logic)
│   ├── interfaces/         — driving adapters (claim loop, dispatcher, recovery)
│   ├── infrastructure/     — driven adapters (Firestore, Storage, leases)
│   └── shared/             — utilities used across layers (TTS, audio, QC, etc.)
│   └── steps/              — the actual step executors
│
├── prompts/              ← LLM prompt templates for content generation
├── system_prompts/       ← LLM system prompts (one per content type)
├── scripts/              ← one-off operational scripts (migrations, voice setup)
├── tests/                ← unittest suite
├── logs/                 ← per-process log files (generated at runtime)
│
├── CONTENT_FACTORY.md    ← high-level workflow docs (single, course, subject)
├── HOW_TO_ADD_A_STEP_TO_PIPELINE.md  ← adding a new pipeline step
├── VENV_STRATEGY.md      ← why we have multiple venvs
└── DEPLOY.md             ← deployment notes
```

---

## 3. Two processes you need to know about

**The companion** ([`local_companion.py`](local_companion.py)) is a long-lived supervisor. It does **not** process jobs itself. It:

- Watches Firestore for new `content_jobs` and worker-control changes.
- Spawns and stops `local_worker.py` subprocesses based on demand and memory.
- Tails worker logs and aggregates them.
- Runs an HTTP wake-server so cloud functions can poke it on new jobs.

On macOS the companion is launched by a launchd plist (`~/Library/LaunchAgents/com.calmdemy.companion.plist`) that runs `run_companion.sh`. It auto-restarts on crash and starts at login.

**Workers** ([`local_worker.py`](local_worker.py)) do the actual work. Each worker is a separate OS process, isolated in its own Python virtualenv (so e.g. the Whisper venv can't break the diffusers venv). A worker:

1. Polls Firestore for queue items it can claim (based on its capability set).
2. Leases the item, runs the step, marks it succeeded or failed.
3. Reports verdicts/output back to Firestore.
4. Repeats forever.

Workers are stateless: kill any one, the recovery manager re-leases the work to another. The companion respawns crashed workers automatically.

---

## 4. Worker stacks (multi-venv runtime)

A single host runs **multiple worker stacks** in parallel, each in its own venv. This is the most important architectural decision in the folder — see [`VENV_STRATEGY.md`](VENV_STRATEGY.md) for the full rationale, but the short version is: ML libraries have incompatible dep trees (`diffusers` wants newer `huggingface_hub`, `qwen-tts` wants an older one), so we can't fit everything in one Python environment.

[`worker_stacks.json`](worker_stacks.json) is the manifest:

| Stack ID | venv | What it claims | Why isolated |
|---|---|---|---|
| `local-primary` | `.venv` | dispatcher + non-TTS steps + Gemini cloud TTS | base runtime |
| `local-image` | `.venv` (shared) | image-generation steps | uses `extraCapabilityKeys: ["image"]` |
| `local-tts-qwen` | `.venv-qwen` | Qwen3 TTS steps (×N replicas) | needs older `huggingface_hub` |
| `local-tts-moss` | `.venv-moss` | MOSS-TTS steps | needs `bfloat16` torch path |
| `local-qc` | `.venv-qc` | audio QC (Whisper transcription) | needs `openai-whisper` + ffmpeg |

**Capability routing** ([`shared/queue_capabilities.py`](factory_v2/shared/queue_capabilities.py)) decides which stack can claim which queue item. Each item carries a `capability_key` (`default`, `image`, `qc`, `tts:<model>`, `tts:any`); each stack advertises which keys it serves. Workers only poll for items whose key they can handle, so the wrong stack never picks up the wrong work.

---

## 5. Folder map (every file, what it does)

### Top-level entrypoints + config

| File | What it is |
|---|---|
| [`local_companion.py`](local_companion.py) | Companion supervisor entrypoint (the long-lived process). |
| [`local_worker.py`](local_worker.py) | Worker subprocess entrypoint (one per stack replica). |
| [`run_companion.sh`](run_companion.sh) | Bootstrap script: provisions all venvs, then `exec`s the companion. Used by launchd. |
| [`worker_stacks.json`](worker_stacks.json) | Stack manifest — which stacks exist, their venv path, capability set, memory budget, replicas. |
| [`requirements.base.txt`](requirements.base.txt) | Shared deps (firebase-admin, google-cloud, torch, diffusers, etc.). Every venv `-r`s this. |
| [`requirements.qwen.txt`](requirements.qwen.txt) | Adds `qwen-tts` to base for the Qwen stack. |
| [`requirements.qc.txt`](requirements.qc.txt) | Adds `openai-whisper` + `num2words` to base for the QC stack. |
| [`config.py`](config.py) | Centralized env-var reader. |
| [`observability.py`](observability.py) | Structured-logging setup; injected into every process. |
| [`predownload_flux.py`](predownload_flux.py) | One-shot script to pre-warm the Flux image model into the local cache. |
| [`service-account-key.json`](service-account-key.json) | Firebase Admin SDK credentials (gitignored locally). |

### `companion/` — supervisor logic

| File | What it is |
|---|---|
| [`stacks.py`](companion/stacks.py) | Spawns and stops worker subprocesses; tracks PID liveness. |
| [`stack_config.py`](companion/stack_config.py) | Loads & validates `worker_stacks.json`; expands `replicas` into per-replica stack IDs. |
| [`control_loop.py`](companion/control_loop.py) | The autoscaler. Polls Firestore queue, classifies pending work into capability buckets, decides which stacks to spawn. Memory guard lives here. |
| [`listener.py`](companion/listener.py) | Firestore real-time listener — replaces polling for new-job detection (push instead of pull). |
| [`wake_server.py`](companion/wake_server.py) | HTTP server on `/wake` that cloud functions hit when new jobs arrive. HMAC-authenticated. |
| [`log_tailer.py`](companion/log_tailer.py) | Tails per-stack log files and forwards them to the companion's stdout for unified logging. |
| [`dedupe.py`](companion/dedupe.py) | Job-ID dedup for the wake server (prevents duplicate spawns on retry). |

### `factory_v2/` — the job-processing engine

Hexagonal architecture: **domain** (pure logic) → **application** (workflow) → **interfaces** (driving adapters) → **infrastructure** (driven adapters). `shared/` holds reusable utilities; `steps/` holds executors.

#### `factory_v2/domain/` — entities and rules, no I/O

| File | What it is |
|---|---|
| [`entities.py`](factory_v2/domain/entities.py) | `FactoryJob`, `JobRun`, `StepRun`, `Artifact` dataclasses. |
| [`state_machine.py`](factory_v2/domain/state_machine.py) | The single source of truth for legal state transitions on job/run/step. Every state change goes through here. |
| [`events.py`](factory_v2/domain/events.py) | Domain events emitted on state transitions. |
| [`errors.py`](factory_v2/domain/errors.py) | Typed domain errors. |

#### `factory_v2/application/` — workflow logic

| File | What it is |
|---|---|
| [`scheduler.py`](factory_v2/application/scheduler.py) | `WorkflowSpec` definitions. Static DAG of step names + edges, one per job type (single_content, course, subject). |
| [`orchestrator.py`](factory_v2/application/orchestrator.py) | The brain. Decides what to enqueue next on every step success/failure. Owns fan-out / fan-in / retry / parking logic. ~1500 lines. |
| [`commands.py`](factory_v2/application/commands.py) | Application-level command service for admin actions (retry, cancel, approve-publish). |

#### `factory_v2/interfaces/` — driving adapters (things that drive the system)

| File | What it is |
|---|---|
| [`worker_main.py`](factory_v2/interfaces/worker_main.py) | The worker's main poll loop. Composition root: wires all repos, orchestrator, claim loop, recovery manager. |
| [`claim_loop.py`](factory_v2/interfaces/claim_loop.py) | Per-tick: claim a queue item, execute the step, mark success/failure, hand off to orchestrator. |
| [`queue_policy.py`](factory_v2/interfaces/queue_policy.py) | Picks *which* queue item to claim next — capability filter + fairness ranking on top of FIFO. |
| [`dispatcher.py`](factory_v2/interfaces/dispatcher.py) | Bridges the legacy `content_jobs` collection into V2: scans for new admin jobs and bootstraps a `factory_jobs` row + first queue item. |
| [`bootstrap.py`](factory_v2/interfaces/bootstrap.py) | The actual `bootstrap_from_content_job` function — translates a `content_jobs` doc into a `factory_jobs` aggregate. |
| [`recovery_manager.py`](factory_v2/interfaces/recovery_manager.py) | Self-healing sweep — finds stuck/orphaned work (dead leases, missed fan-outs, stranded shards) and re-enqueues it. |
| [`step_watchdog.py`](factory_v2/interfaces/step_watchdog.py) | Heartbeat/lease-extension thread that runs while a step executes; prevents the recovery manager from stealing work from a healthy but slow step. |
| [`status_projection.py`](factory_v2/interfaces/status_projection.py) | Projects V2 events back to legacy `content_jobs` fields so old admin screens keep working. |
| [`admin_handlers.py`](factory_v2/interfaces/admin_handlers.py) | HTTP-style entry points that admin UI can call to retry/cancel/approve. |

#### `factory_v2/infrastructure/` — driven adapters (the system drives these)

| File | What it is |
|---|---|
| [`firestore_repos.py`](factory_v2/infrastructure/firestore_repos.py) | Repository pattern for `factory_jobs`, `factory_job_runs`, `factory_step_runs`. The only place that writes those collections. |
| [`queue_repo.py`](factory_v2/infrastructure/queue_repo.py) | Owns the `factory_step_queue` collection. Atomic claim via Firestore transactions. |
| [`lease_manager.py`](factory_v2/infrastructure/lease_manager.py) | Time-bound leases on queue items so a dead worker doesn't permanently lock work. |
| [`model_gateways.py`](factory_v2/infrastructure/model_gateways.py) | Thin wrappers over external model APIs (Gemini, OpenAI). |
| [`storage_gateway.py`](factory_v2/infrastructure/storage_gateway.py) | Cloud Storage upload/download adapter. |

#### `factory_v2/shared/` — reusable utilities

| File | What it is |
|---|---|
| [`tts_converter.py`](factory_v2/shared/tts_converter.py) | The TTS dispatcher — picks the right model gateway based on `ttsModel` and returns a WAV path. |
| [`course_tts_chunks.py`](factory_v2/shared/course_tts_chunks.py) | Splits scripts into TTS-sized chunks; deterministic shard-key + WAV-path helpers. |
| [`course_tts_progress.py`](factory_v2/shared/course_tts_progress.py) | Progress aggregation across course session shards. |
| [`course_tts_segment_cache.py`](factory_v2/shared/course_tts_segment_cache.py) | Reuse-checkpointed audio segments across retries. |
| [`audio_processor.py`](factory_v2/shared/audio_processor.py) | WAV concatenation, MP3 encoding, normalization, fades. |
| [`audio_qc.py`](factory_v2/shared/audio_qc.py) | Pure-Python QC algorithm: regex-normalize transcript vs source, classify diff, render verdict. Importable from anywhere. |
| [`image_generator.py`](factory_v2/shared/image_generator.py) | Wraps Flux/SDXL pipelines for thumbnail generation. |
| [`llm_generator.py`](factory_v2/shared/llm_generator.py) | LLM script-generation calls (Gemini). |
| [`qa_formatter.py`](factory_v2/shared/qa_formatter.py) | Cleans LLM output for TTS (strips markdown, normalizes punctuation, etc.). |
| [`storage_uploader.py`](factory_v2/shared/storage_uploader.py) | High-level Cloud Storage upload helpers (audio, image). |
| [`content_publisher.py`](factory_v2/shared/content_publisher.py) | Writes the final published content document(s) — the rows the mobile app reads. |
| [`storage_cleanup.py`](factory_v2/shared/storage_cleanup.py) | Removes orphaned objects when a job is deleted. |
| [`delete_job.py`](factory_v2/shared/delete_job.py) | The end-to-end delete-a-job operation. |
| [`queue_capabilities.py`](factory_v2/shared/queue_capabilities.py) | Maps step name → capability key; decides which workers can claim which items. |
| [`voice_utils.py`](factory_v2/shared/voice_utils.py) | Voice catalog helpers (matching `narratorId` to TTS model + voice file). |
| [`worker_status.py`](factory_v2/shared/worker_status.py) | Writes the `worker_status/<id>` doc that admin UI reads to render worker cards. |
| [`job_cache.py`](factory_v2/shared/job_cache.py) | In-memory job snapshot cache to reduce Firestore reads inside one tick. |
| [`lineage_timing.py`](factory_v2/shared/lineage_timing.py) | Aggregates per-step durations into a job timing summary. |
| [`metrics.py`](factory_v2/shared/metrics.py) | Outcome metric writes (success/failure counts for analytics). |
| [`error_codes.py`](factory_v2/shared/error_codes.py) | Constants for retryable vs terminal errors. |

#### `factory_v2/steps/` — step executors

| File | What it is |
|---|---|
| [`base.py`](factory_v2/steps/base.py) | `StepContext` (input) + `StepResult` (output) dataclasses. The contract every executor implements. |
| [`registry.py`](factory_v2/steps/registry.py) | The lookup table: persisted step name → `(module, function)` tuple. Lazy-imported. |
| [`single_content.py`](factory_v2/steps/single_content.py) | Executors for the single-content pipeline (meditation, sleep story, soundscape). |
| [`course.py`](factory_v2/steps/course.py) | Top-level executors for the course pipeline (re-exports from sub-modules below). |
| [`course_planning.py`](factory_v2/steps/course_planning.py) | `generate_course_plan`. |
| [`course_scripts.py`](factory_v2/steps/course_scripts.py) | `generate_course_scripts`, `format_course_scripts`. |
| [`course_chunking.py`](factory_v2/steps/course_chunking.py) | Chunking utilities used by course synthesis. |
| [`course_common.py`](factory_v2/steps/course_common.py) | Shared helpers used by multiple course steps. |
| [`course_synthesis.py`](factory_v2/steps/course_synthesis.py) | `synthesize_course_audio_chunk`, `synthesize_course_audio` (fan-in). |
| [`course_publish.py`](factory_v2/steps/course_publish.py) | `upload_course_audio`, `publish_course`. |
| [`subject.py`](factory_v2/steps/subject.py) | Meta-job that orchestrates multiple child courses (subject = curriculum). |

### `prompts/` and `system_prompts/`

LLM templates split by content type. `system_prompts/` are the system-role messages that shape the LLM's behavior; `prompts/` are the user-role templates filled with job parameters.

| Type | system prompt | user prompt |
|---|---|---|
| Guided meditation | [`guided_meditation_system_prompt.txt`](system_prompts/guided_meditation_system_prompt.txt) | [`guided_meditation.txt`](prompts/guided_meditation.txt) |
| Sleep meditation | [`sleep_meditation_system_prompt.txt`](system_prompts/sleep_meditation_system_prompt.txt) | [`sleep_meditation.txt`](prompts/sleep_meditation.txt) |
| Bedtime story | [`bedtime_story_system_prompt.txt`](system_prompts/bedtime_story_system_prompt.txt) | [`bedtime_story.txt`](prompts/bedtime_story.txt) |
| Emergency | [`emergency_meditation_system_prompt.txt`](system_prompts/emergency_meditation_system_prompt.txt) | [`emergency_meditation.txt`](prompts/emergency_meditation.txt) |
| Course session | [`course_session_system_prompt.txt`](system_prompts/course_session_system_prompt.txt) | [`course_session.txt`](prompts/course_session.txt) |
| Course (whole) | [`course_system_prompt.txt`](system_prompts/course_system_prompt.txt) | (built dynamically) |
| Subject | [`full_subject_system_prompt.txt`](system_prompts/full_subject_system_prompt.txt) | (built dynamically) |

### `scripts/` — one-off ops

| File | When you use it |
|---|---|
| [`bootstrap_v2_job.py`](scripts/bootstrap_v2_job.py) | Force-create a `factory_jobs` row from an existing `content_jobs` doc. |
| [`add_voice.py`](scripts/add_voice.py) | Register a new TTS voice in the voice catalog. |
| [`migrate_thumbnails.py`](scripts/migrate_thumbnails.py) | Backfill thumbnails for old content. |
| [`sync_narrators.py`](scripts/sync_narrators.py) | Reconcile the narrator list with the published voice catalog. |

### `tests/`

Standard Python `unittest`. Run with `worker/.venv/bin/python -m unittest discover -s tests`. See individual files for what's covered — most match the file under test by name (`test_recovery_manager.py` → `recovery_manager.py`, etc.).

---

## 6. Job lifecycle: what happens when admin clicks "Generate"

Concrete trace of a single-content guided-meditation job, from button click to MP3 in storage:

1. **Admin UI** writes a new `content_jobs/<id>` document with `status: "queued"`, `mediaType: "guided_meditation"`, narrator, length, etc.

2. **Companion** receives the wake (either from cloud function HTTP `/wake` or from its Firestore listener).

3. **Dispatcher** ([`dispatcher.py`](factory_v2/interfaces/dispatcher.py)) — runs in the `local-primary` worker. It:
   - Scans `content_jobs` for `status: "queued"` documents.
   - Locks one transactionally.
   - Calls `bootstrap_from_content_job` which creates `factory_jobs/<id>`, `factory_job_runs/<id>-r1`, and the first `factory_step_queue` item for `generate_script`.

4. **Worker poll loop** ([`claim_loop.py`](factory_v2/interfaces/claim_loop.py)) — `local-primary` polls `factory_step_queue` for items it can claim (`capability_key == "default"`).
   - Claims `generate_script` (atomic Firestore transaction, sets lease).
   - Step watchdog spawns a thread that heartbeats until the step finishes.
   - Looks up the executor in [`registry.py`](factory_v2/steps/registry.py) → `single_content.execute_generate_script`.
   - Runs it. Result patches `runtime.generated_script` + `runtime.generated_title`.
   - Marks the step succeeded.

5. **Orchestrator** ([`orchestrator.py`](factory_v2/application/orchestrator.py)) gets the success callback.
   - Looks at `WorkflowSpec.next_steps("generate_script")` → `["format_script"]`.
   - Enqueues `format_script` queue item.

6. Steps 4–5 repeat for `format_script` → `generate_image` (claimed by `local-image`) → ...

7. **Audio fan-out**. After `generate_image` succeeds, orchestrator picks the chunked path (`_fan_out_single_audio`):
   - Splits `runtime.formatted_script` into N chunks (~5–10 typically).
   - Enqueues N `synthesize_audio_chunk` items in parallel, one per chunk, with `step_input={"chunk_index": i}` and `capability_key="tts:<model>"`.
   - The TTS stacks (`local-tts-qwen-*`) claim them in parallel.

8. **Audio QC fan-in → fan-out** (when `FACTORY_QC_ENABLED=true`):
   - Each synth-chunk success calls back to `_maybe_fan_out_single_audio_qc`, which waits until all synth chunks are done, then enqueues N `qc_audio_chunk` items (one per chunk, `capability_key="qc"`).
   - `local-qc` claims them, runs Whisper transcription, computes verdict, writes to `runtime.chunk_qc.<i>`.
   - When all QC verdicts arrive, `_evaluate_single_audio_qc` decides: PASS → assemble; REVIEW → park run for human; FAIL with attempts < 3 → delete WAV + re-enqueue synth (the chunk loops back through 7 → 8); FAIL with attempts ≥ 3 → park.

9. **Assembly + post-processing + upload** — `assemble_audio` concatenates chunk WAVs → `post_process_audio` normalizes and encodes MP3 → `upload_audio` pushes to Cloud Storage.

10. **Publish** — `publish_content` writes the final mobile-app-readable document (e.g. into `guided_meditations/<id>`) and marks the job complete.

11. **Status projection** — at every transition, [`status_projection.py`](factory_v2/interfaces/status_projection.py) updates `content_jobs/<id>` so the admin UI sees progress in real time.

12. **Recovery manager** runs in the background of every worker. If a step lease expires (worker died mid-step), it re-enqueues. If a fan-out got partially created and then crashed, it heals.

Total time for a 10-minute meditation: typically 3–8 minutes depending on TTS model and how many chunks parallelize.

---

## 7. State machines

Three state machines run in parallel, all gated by [`domain/state_machine.py`](factory_v2/domain/state_machine.py).

**Job state** (top level): `queued → running → completed` (or `failed`, `cancelled`).

**Run state** (one job can have multiple runs from retries): `pending → running → completed`/`failed`/`cancelled`.

**Step run state** (one per step per shard): `ready → running → succeeded`/`failed`.

The state machine module is the *only* place these transitions are validated. Every layer that wants to change a state goes through it.

---

## 8. Storage — where data lives

**Firestore** is the system of record. Two namespaces:

- **External / legacy** (admin UI + mobile app see these):
  - `content_jobs` — the request + status mirror
  - `users`, `subjects`, `courses`, `sessions`, `guided_meditations`, `bedtime_stories`, `emergency_meditations`, `sleep_meditations`, `narrators`, `voices`
- **V2 internal** (only the worker reads/writes):
  - `factory_jobs` — aggregate root per job
  - `factory_job_runs` — one document per execution attempt
  - `factory_step_runs` — one per step per shard, holds state + output + attempt count
  - `factory_step_queue` — pending work items with capability_key + lease
  - `factory_events` — append-only audit log of state transitions
  - `worker_status/<id>` — per-stack heartbeat doc that admin UI renders
  - `worker_control` — admin command channel (desired state, etc.)

**Cloud Storage** (`calmnest-e910e.firebasestorage.app`):
- `audio/meditation/`, `audio/sleep/`, `audio/breathing/`, `audio/courses/<id>/`
- `images/thumbnails/`

**Local** (`/tmp/calmdemy_*`):
- Chunk WAVs during a run (deleted after `assemble_audio` succeeds).
- Whisper model weights cached in `~/.cache/whisper/`.

**Schemas** are documented in [`FIRESTORE_SCHEMA.md`](../FIRESTORE_SCHEMA.md) and [`STORAGE_LAYOUT.md`](../STORAGE_LAYOUT.md) at the repo root.

---

## 9. Configuration

### `worker_stacks.json`

Stack manifest. Editing this is how you add/remove/scale a stack. Restart companion to pick up changes.

| Field | Meaning |
|---|---|
| `id` | Unique identifier (used in logs, worker_status). |
| `venv` | Path to the Python venv (relative to `worker/`). |
| `replicas` | Number of subprocess clones (default 1). Suffixed `-2`, `-3`, … |
| `enabled` | Whether the companion will start this stack. |
| `dispatch` | Whether this stack runs the dispatcher (only one should). |
| `acceptNonTtsSteps` | Whether this stack claims `default` capability items. |
| `ttsModels` | TTS model IDs this stack supports. |
| `extraCapabilityKeys` | Custom capabilities (e.g. `["image"]`, `["qc"]`). |
| `memoryPerWorkerMB` | Budget hint for the autoscaler's memory guard. |

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `V2_ENABLE_DISPATCH` | `true` | Enable legacy `content_jobs` dispatcher. |
| `V2_POLL_INTERVAL_SECONDS` | `1.0` | Worker poll cadence. |
| `V2_MAX_STEP_RETRIES` | `2` | Max retries per step before terminal failure. |
| `WORKER_STACKS_FILE` | `worker_stacks.json` | Override path to manifest. |
| `FACTORY_QC_ENABLED` | `true` | Route synth fan-in through QC. Set `false` to bypass. |
| `FACTORY_QC_WHISPER_MODEL` | `turbo` | Which Whisper size to load (`tiny`/`base`/`small`/`medium`/`large`/`turbo`). |
| `FACTORY_QC_MAX_ATTEMPTS` | `3` | Auto-retries per chunk before parking. |
| `SINGLE_CONTENT_CHUNK_MIN_WORDS` | `200` | Below this, single-content uses the linear (non-chunked) TTS path. |
| `QWEN_TTS_DEVICE` | `auto` | Resolves to cuda → mps → cpu. |
| `WORKER_DISPATCH`, `WORKER_ACCEPT_NON_TTS`, `WORKER_TTS_MODELS` | per-stack | Injected by the companion when spawning a worker. Don't set manually. |

Env vars are loaded by [`config.py`](config.py); when running under launchd, set them in the plist's `EnvironmentVariables` block (your shell's vars don't propagate to launchd).

---

## 10. Logs & debugging

All logs live under `worker/logs/`:

| File | Source |
|---|---|
| `companion-launchd.log` | Companion stdout (autoscaler decisions, listener events). |
| `companion.log` / `local_companion.log` | Older companion log paths kept for backward compat. |
| `local_worker_<stack-id>.log` | Per-stack worker stdout. **The truth about whether a worker is healthy.** |
| `companion_bootstrap.out` | One-time bootstrap output. |

### Where to look for what

| Symptom | First place to check |
|---|---|
| Job not picked up after admin click | `companion-launchd.log` — listener / wake server activity |
| Stack listed as "running" but nothing happens | `local_worker_<stack>.log` — usually `ModuleNotFoundError` or `FileNotFoundError` (see [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](HOW_TO_ADD_A_STEP_TO_PIPELINE.md) Common Mistakes) |
| Step kept retrying then failed | `local_worker_<stack>.log` — full traceback at the failure point |
| Memory guard evicting stacks | `companion-launchd.log` — search for "Memory guard reduced worker pool" |
| Job stuck mid-pipeline | `factory_step_runs` in Firestore — find the latest `running` step, check its `last_heartbeat_at` |

### Useful one-liners

```bash
# All job-claim activity in last 100 lines
grep "V2 queue item claimed" worker/logs/companion-launchd.log | tail -100

# QC verdicts produced today
grep "qc_audio_chunk" worker/logs/local_worker_local-qc.log | grep -oE 'verdict=\w+' | sort | uniq -c

# Which stacks are alive right now
ps -axo pid,etime,command | grep local_worker | grep -v grep

# How long has companion been up
launchctl list | grep com.calmdemy.companion
```

---

## 11. Common operations

### Restart everything

```bash
launchctl kickstart -k gui/$(id -u)/com.calmdemy.companion
```

`-k` kills the running companion first; launchd respawns it via `run_companion.sh` which re-provisions any out-of-date venvs (~10 s normally, ~2 min if requirements files changed).

### Restart one stack

The companion spawns workers as subprocesses. Killing one triggers the autoscaler to respawn it on the next tick (~1–6 s).

```bash
ps -axo pid,command | grep local_worker | grep <stack-id>
kill <pid>
```

### Disable a stack temporarily

Edit [`worker_stacks.json`](worker_stacks.json), flip `"enabled": false` for the stack. Restart companion.

### Force a stuck job through

Look up the latest step run in `factory_step_runs`. If it's stuck in `running` past its lease, it'll auto-recover after `recovery_manager` sweeps. To force it now, manually update the step run state to `failed` and the orchestrator will create a retry on the next event.

### Reset a venv

```bash
rm -rf worker/.venv-<name>
launchctl kickstart -k gui/$(id -u)/com.calmdemy.companion
```

Companion re-provisions on next boot.

### Run tests

```bash
cd worker
.venv/bin/python -m unittest discover -s tests
```

---

## 12. Related reading

- [`CONTENT_FACTORY.md`](CONTENT_FACTORY.md) — workflow definitions per job type, audio QC details, operational notes.
- [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](HOW_TO_ADD_A_STEP_TO_PIPELINE.md) — step-by-step checklist for extending the pipeline. **Read this before adding any new step.**
- [`VENV_STRATEGY.md`](VENV_STRATEGY.md) — why we have multiple venvs and how to add a new one.
- [`DEPLOY.md`](DEPLOY.md) — deployment notes.
- [`factory_v2/README.md`](factory_v2/README.md) — V2-specific quick reference (overlapping with this doc; this file supersedes it).
- Repo-root [`FIRESTORE_SCHEMA.md`](../FIRESTORE_SCHEMA.md) — collection inventory and field contracts.
- Repo-root [`STORAGE_LAYOUT.md`](../STORAGE_LAYOUT.md) — Cloud Storage paths.
- Repo-root [`docs/ARCHITECTURE_MIGRATION.md`](../docs/ARCHITECTURE_MIGRATION.md) — broader migration context.

---

## TL;DR for "I just need to do X"

| I want to… | Go here |
|---|---|
| add a new pipeline step | [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](HOW_TO_ADD_A_STEP_TO_PIPELINE.md) |
| understand a single job's lifecycle | section 6 above |
| find where ${file} lives | section 5 (folder map) |
| change which stacks run | edit [`worker_stacks.json`](worker_stacks.json) |
| add a new venv | [`VENV_STRATEGY.md`](VENV_STRATEGY.md) |
| debug a stuck job | section 10 (logs) |
| restart everything | section 11 |
| read schemas | repo-root `FIRESTORE_SCHEMA.md` / `STORAGE_LAYOUT.md` |
