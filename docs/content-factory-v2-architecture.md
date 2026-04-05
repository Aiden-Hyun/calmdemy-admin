# Content Factory V2 Architecture (Post-Cutover)

## Status

- V1 runtime/orchestration paths are removed.
- Companion starts V2 worker only.
- `content_jobs` remains the external contract for admin and triggers.
- V2 execution state is persisted in `factory_*` collections.

## Runtime Topology

- Worker entrypoint: `worker/local_worker.py` (V2)
- Companion lifecycle manager: `worker/local_companion.py`
- Stack management: `worker/companion/stacks.py` (single V2 stack)
- Trigger wake function: `functions/index.js` for `pending`/`publishing`

## Data Model

### External contract

`content_jobs`

- Source of job creation and admin controls.
- Compatibility projection target for status and output fields.
- Not the canonical execution record for V2 runtime state.

### Internal engine tables

- `factory_jobs`: durable job snapshot + runtime/summary projection
- `factory_job_runs`: per-run metadata
- `factory_step_runs`: per-step execution audit
- `factory_step_queue`: leased queue with retry scheduling
- `factory_events`: event stream for debugging/observability

## Workflow Graphs

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
5. `synthesize_course_audio`
6. `upload_course_audio`
7. `publish_course`

## Recovery and Reliability

- Step retries with bounded exponential backoff.
- Stale lease recovery resets expired `leased`/`running` queue docs.
- Delete requests are handled in V2 worker loop.
- Errors are normalized to stable error codes and projected to `content_jobs`.

## Shared Module Boundary

Reusable generation/upload/publish helpers are in `worker/factory_v2/shared/`.

This replaces previous runtime coupling to `worker/pipeline/*`.

## Compatibility Decisions

- `content_jobs.status` labels remain unchanged for UI compatibility.
- Canonical V2 execution state lives in `factory_jobs.current_state` and `factory_job_runs.state`.
- Admin detail views should prefer `factory_jobs` / `factory_job_runs` for live runtime truth and use `content_jobs` as the compatibility projection plus control surface.
- Deprecated V1-era fields remain for one release and can be removed in a follow-up migration.
- Cloud backend support is removed.
