# Content Factory Deployment (V2, Local Companion)

## Scope

This deployment guide covers the V2-only content factory runtime.

- Worker runtime: local companion + local V2 worker
- External contract: `content_jobs`
- Cloud VM/cloud-function paths: removed

## Prerequisites

- Python 3 with `venv` support
- `./run_companion.sh` provisions `worker/.venv`, `worker/.venv-dms`, and `worker/.venv-qwen`
- Firebase Admin credentials available (`GOOGLE_APPLICATION_CREDENTIALS` or `worker/service-account-key.json`)
- App dependencies installed (`npm install` in app root)
- Stack manifest configured in `worker/worker_stacks.json`

## 1) Deploy Firestore Rules/Indexes

From `apps/calmdemy`:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

## 2) Start Companion

From `apps/calmdemy/worker`:

```bash
./run_companion.sh
```

Companion starts/stops `local_worker.py` automatically based on `worker_control/local` and queue state.
In multi-stack mode, it starts one process per expanded stack definition.
The bootstrap script provisions `.venv`, `.venv-dms`, and `.venv-qwen` before launch.
`desiredState=auto` is the demand-based mode: it starts only the stacks needed for current queue work and scales unused stacks back down.
`desiredState=running` remains the manual override that keeps all enabled stacks up.

## 3) Optional Runtime Tuning

Set env vars in `worker/.env` as needed:

- `V2_ENABLE_DISPATCH=true`
- `V2_POLL_INTERVAL_SECONDS=1.0`
- `V2_MAX_STEP_RETRIES=2`
- `WORKER_STACKS_FILE=/absolute/path/to/worker_stacks.json` (optional)
- `QWEN_TTS_DEVICE=auto` (default; resolves `cuda`, then `mps`, then `cpu`)

## 4) Verify Worker Health

- `worker_stacks_status/local` shows expected enabled stacks + capabilities
- each enabled stack has running PID in `worker_stacks_status/local.stacks[*].pid`
- `worker_log_tails/<stackId>` streams logs per stack
- Qwen replicas appear as distinct stack ids such as `local-tts-qwen-2`

## 5) Validate End-to-End

1. Start app: `npx expo start`.
2. Create job from Admin Content Factory.
3. Confirm timeline entries in Job Detail from `factory_step_runs`.
4. Validate content appears in target collection after completion.

## Troubleshooting

### No jobs being picked up

- Check `worker_control/local.desiredState` is `running` or `auto`.
- Check `content_jobs` doc has `status` in `pending`/`publishing`.
- Check `v2DispatchError` field on job.

### Queue appears stuck

- Inspect `factory_step_queue` for expired leases.
- V2 worker runs stale-lease recovery periodically; restart companion if needed.
- For synth steps, verify `required_tts_model` has a matching enabled stack in `worker_stacks.json`.
- If no capable stack exists, dispatch fails fast with `errorCode=no_capable_stack`.

### Permission errors in admin timeline

- Ensure Firestore rules include admin read on:
  - `factory_step_runs`
  - `factory_job_runs`
  - `factory_jobs`
  - `factory_step_queue`
  - `factory_events`

## Multi-Venv Convention

Follow `worker/VENV_STRATEGY.md` when adding/refactoring model runtimes.
Do not collapse to a single venv while incompatible model dependencies exist.
