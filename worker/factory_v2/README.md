# Content Factory V2

Content Factory now runs on a V2-only workflow engine.

## Overview

- `content_jobs` remains the external/admin contract.
- Execution state is tracked in `factory_jobs`, `factory_job_runs`, `factory_step_runs`, `factory_step_queue`, and `factory_events`.
- The worker projects compatibility fields back to `content_jobs` so existing admin screens keep working.

## Workflows

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
5. `synthesize_course_audio` (sharded fan-out: `INT`, `M1L`, `M1P`, `M2L`, `M2P`, `M3L`, `M3P`, `M4L`, `M4P`)
6. `upload_course_audio`
7. `publish_course`

`synthesize_course_audio` runs as one queue item per session shard.
`upload_course_audio` is fan-in gated and is queued only after all expected shards are complete.
Completed shard outputs are checkpointed immediately to `runtime.course_audio_results` and projected to
`content_jobs.courseAudioResults`, so retries only enqueue missing shards.

## Running locally

1. Start companion with bootstrap: `./run_companion.sh`
2. Ensure worker control desired state is `running` or `auto`.
3. Create jobs from Admin UI.

Companion starts one or more `local_worker.py` processes based on `worker/worker_stacks.json`.
Manifest entries may set `replicas` to expand into multiple concrete worker processes.
Capability routing ensures synth steps are claimed only by stacks whose `ttsModels` allowlist matches.
The default local profile expands to 11 stacks: 1 primary dispatcher/non-TTS stack, 3 DMS TTS stacks,
and a 7-worker Qwen TTS pool.

## Runtime flags

- `V2_ENABLE_DISPATCH` (default: `true`)
- `V2_POLL_INTERVAL_SECONDS` (default: `1.0`)
- `V2_MAX_STEP_RETRIES` (default: `2`)
- `WORKER_STACKS_FILE` (optional path override)
- `WORKER_DISPATCH` (per-stack, injected by companion)
- `WORKER_ACCEPT_NON_TTS` (per-stack, injected by companion)
- `WORKER_TTS_MODELS` (per-stack, injected by companion)
- `QWEN_TTS_DEVICE` (default: `auto`, resolves `cuda`, then `mps`, then `cpu`)

See `worker/VENV_STRATEGY.md` for the normative multi-venv convention.
