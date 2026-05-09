# Calmdemy Content Factory (V2)

## Purpose

The content factory creates meditation content from admin jobs and publishes results to Firestore/Storage.

V1 runtime codepaths are removed. The worker runs V2 only.

## External Contract

`content_jobs` remains the external/admin contract.

- Admin creates a job in `content_jobs`.
- V2 dispatcher claims eligible jobs and starts V2 runs.
- V2 projects execution progress/status back to `content_jobs` for UI compatibility.

## Internal V2 Collections

- `factory_jobs`
- `factory_job_runs`
- `factory_step_runs`
- `factory_step_queue`
- `factory_events`

## Worker Runtime

- Entry point: `worker/local_worker.py`
- Companion process manager: `worker/local_companion.py`
- Stack runtime: `worker/companion/stacks.py` (V2 only, multi-stack capable)
- Stack manifest: `worker/worker_stacks.json`
- Multi-venv convention: `worker/VENV_STRATEGY.md`

### Key env vars

- `V2_ENABLE_DISPATCH` (default `true`)
- `V2_POLL_INTERVAL_SECONDS` (default `1.0`)
- `V2_MAX_STEP_RETRIES` (default `2`)
- `WORKER_STACKS_FILE` (optional override for stack manifest path)
- `WORKER_DISPATCH` (set by companion per stack)
- `WORKER_ACCEPT_NON_TTS` (set by companion per stack)
- `WORKER_TTS_MODELS` (set by companion per stack)
- `QWEN_TTS_DEVICE` (default `auto`, resolves `cuda`, then `mps`, then `cpu`)

## Step Workflows

### Single content

1. `generate_script`
2. `format_script`
3. `generate_image`
4. `synthesize_audio` (or `synthesize_audio_chunk` ×N → `assemble_audio` for chunked path)
5. `qc_audio_chunk` ×N — *opt-in via `FACTORY_QC_ENABLED=true`* (per-chunk Whisper QC, see [Audio QC](#audio-qc))
6. `post_process_audio`
7. `upload_audio`
8. `publish_content`

### Course

1. `generate_course_plan`
2. `generate_course_thumbnail`
3. `generate_course_scripts`
4. `format_course_scripts`
5. `synthesize_course_audio` (9 session shards: `INT`, `M1L`, `M1P`, `M2L`, `M2P`, `M3L`, `M3P`, `M4L`, `M4P`)
6. `upload_course_audio`
7. `publish_course`

Course audio is fan-out/fan-in:

- Fan-out: enqueue one synth shard per missing session.
- Fan-in: enqueue `upload_course_audio` only after all session shards are complete.
- Checkpointing: each successful shard immediately updates `runtime.course_audio_results` and
  `content_jobs.courseAudioResults` for resume-on-retry behavior.

## Audio QC

Per-chunk audio quality control using OpenAI Whisper. Catches dropped words, mispronunciations, language mismatches, and TTS loops *before* assembly so retries are scoped to the broken chunk only.

### Pipeline placement

```
synthesize_audio_chunk (×N) → qc_audio_chunk (×N) → assemble_audio
                                       │
                                       ├─ all PASS  → continue to assemble
                                       ├─ any REVIEW  → park run for human approval
                                       └─ any FAIL    → delete WAV, re-render synth
                                                        (max 3 attempts/chunk, then park)
```

Verdict thresholds (in [`shared/audio_qc.py`](factory_v2/shared/audio_qc.py)):
- **PASS**: 0 issues after regex normalization (digits→words, contractions, hyphens, hallucination tails, etc.)
- **REVIEW**: exactly 1 single-word issue (mispronunciation, drop, or insert)
- **FAIL**: 2+ issues, multi-word run, language mismatch, or duration <40% / >250% of expected

QC verdicts are written to `runtime.chunk_qc[i]` with full diff, transcript, and attempts count. The orchestrator hooks live in [`application/orchestrator.py`](factory_v2/application/orchestrator.py): `_maybe_fan_out_single_audio_qc`, `_evaluate_single_audio_qc`, `_retry_qc_failed_chunks`, `_park_run_for_qc_review`.

### Enabling QC

QC is **on by default**. The `local-qc` worker stack starts automatically alongside qwen/moss/image, `.venv-qc` is auto-provisioned by `./run_companion.sh`, and the orchestrator routes new jobs through `qc_audio_chunk` between synth and assembly. No env-var flipping or admin-UI toggle needed for normal use.

To bypass QC (legacy synth-straight-to-assemble flow), set:

```bash
export FACTORY_QC_ENABLED=false
./run_companion.sh
```

That keeps the worker process running but tells the orchestrator to skip the QC fan-in.

### Tunables

| env var | default | meaning |
|---|---|---|
| `FACTORY_QC_ENABLED` | `true` | set to `false` to bypass QC (synth → assemble directly) |
| `FACTORY_QC_WHISPER_MODEL` | `turbo` | Whisper model size (`tiny`/`base`/`small`/`medium`/`large`/`turbo`) |
| `FACTORY_QC_MAX_ATTEMPTS` | `3` | max auto-retries per chunk before parking |

### Parked runs

When a run parks (any REVIEW chunk, or any chunk past max attempts), `runtime.qc_park` is populated with the chunk indices and their verdicts, and `summary.qcParked = true`. The run stays in `running` state — admin must intervene (Phase 3 will add a UI; for now, manual unpark via `_ensure_step_enqueued("assemble_audio")` or re-running `_retry_qc_failed_chunks` after fixing the source script).

## Operational Notes

- Delete requests are handled directly by V2 worker.
- Queue stale lease recovery is handled in V2 worker loop.
- Retry/backoff is handled on step failures for retryable error codes.
- Admin timeline reads from `factory_step_runs` (V2 and legacy-shape compatibility docs).
- Queue entries can include `required_tts_model` for synth-step capability routing.
- Stack manifest entries may set `replicas` to expand into `id`, `id-2`, `id-3`, etc.
- Default stack profile is one dispatcher/non-TTS stack, one image stack, and a
  seven-worker Qwen TTS pool for parallel course synth execution.

## Cloud Backend

Cloud VM worker and cloud-trigger paths are removed.

Supported backends are local and API.

## Development Commands

```bash
# Worker type checks / compile checks
python3 -m compileall worker/factory_v2 worker

# App type check
npx tsc --noEmit --pretty false
```
