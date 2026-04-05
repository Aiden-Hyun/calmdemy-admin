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
4. `synthesize_audio`
5. `post_process_audio`
6. `upload_audio`
7. `publish_content`

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

## Operational Notes

- Delete requests are handled directly by V2 worker.
- Queue stale lease recovery is handled in V2 worker loop.
- Retry/backoff is handled on step failures for retryable error codes.
- Admin timeline reads from `factory_step_runs` (V2 and legacy-shape compatibility docs).
- Queue entries can include `required_tts_model` for synth-step capability routing.
- Stack manifest entries may set `replicas` to expand into `id`, `id-2`, `id-3`, etc.
- Default stack profile is one dispatcher/non-TTS stack, three DMS TTS stacks for
  parallel course synth execution, and a seven-worker Qwen voice-clone TTS pool.

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
