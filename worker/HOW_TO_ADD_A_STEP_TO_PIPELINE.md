# How to add a step to the pipeline

A practical reference for extending the Calmdemy content factory with a new pipeline step. Distilled from the audio-QC step implementation (which initially missed several touchpoints — those gotchas are now flagged here).

> **Use this as a checklist.** The pipeline is wired across ~10 files. Skipping any one of them produces a silently broken integration where queue items pile up, workers idle, or the orchestrator stalls.

---

## Mental model: what is a "step"?

A **step** is a single unit of work in a job's lifecycle. Each job is a small DAG of steps, executed by workers in separate processes (potentially in separate Python venvs).

Concrete example — a guided meditation flows through these steps:

```
generate_script → format_script → generate_image
  → synthesize_audio_chunk (×N, parallel)
  → qc_audio_chunk (×N, parallel)
  → assemble_audio
  → post_process_audio → upload_audio → publish_content
```

Three layers run a step end-to-end:

| Layer | Role | Lives in |
|---|---|---|
| **Step executor** | The actual work (LLM call, TTS, upload, …) | `worker/factory_v2/steps/<workflow>.py` |
| **Orchestrator** | Decides what to enqueue next, handles fan-out / retry / parking | `worker/factory_v2/application/orchestrator.py` |
| **Companion / autoscaler** | Decides which worker stacks to spawn based on queue demand | `worker/companion/control_loop.py` |

Plus three crosscutting concerns:
- **Step registry** maps step name → executor function.
- **Workflow spec** defines the static DAG of step names (display order + static edges).
- **Capability routing** describes what kind of worker can run the step.

---

## TL;DR — the 10 things you must touch

A new step is **not done** until every line below applies (or you have a deliberate reason to skip it):

| # | File | What changes | Skip if… |
|---|---|---|---|
| 1 | `worker/factory_v2/steps/<workflow>.py` | New `execute_<step>` function | never — you must define the work |
| 2 | `worker/factory_v2/steps/registry.py` | One line in `EXECUTOR_PATHS` | never |
| 3 | `worker/factory_v2/application/scheduler.py` | Add to `WorkflowSpec.steps` (and `edges` if static) | never |
| 4 | `worker/factory_v2/application/orchestrator.py` | Hook in `on_step_success()`; add fan-out / fan-in / retry helpers | step has only static edges and no custom logic |
| 5 | `worker/factory_v2/shared/queue_capabilities.py` | New step in a STEP_NAMES set; new branch in `capability_key_for_step()` if introducing a new capability | step uses `default` (CPU-only, runs anywhere) |
| 6 | `worker/factory_v2/shared/<helper>.py` | Shared library code your executor imports | step is self-contained |
| 7 | `worker/companion/control_loop.py` | New bucket in `_collect_auto_workload_from_payloads`, new rule in `_desired_auto_stack_ids`, new clause in `has_any_work` | **only** if step uses an existing capability bucket (`image`, `tts:*`, `default`) |
| 8 | `worker/worker_stacks.json` | New stack entry (or `extraCapabilityKeys` on existing stack) | step's capability is already served by an existing stack |
| 9 | `worker/requirements.<stack>.txt` + `worker/run_companion.sh` | New venv requirements; new `ensure_venv` call | step shares an existing venv |
| 10 | `worker/tests/test_<step>.py` + docs (`CONTENT_FACTORY.md`) | Executor unit tests; doc the step | never |

> ⚠️ **Most-missed item: #7 (autoscaler).** If you skip this, your queue items get enqueued correctly but no worker is ever spawned to claim them — they sit forever. Symptom: log shows `desired_stacks: [...]` without your stack, even when work is queued. See "Common mistakes" below.

---

## Step-by-step guide

### 1. Write the executor

`worker/factory_v2/steps/<workflow>.py` (or new file). Signature is fixed:

```python
def execute_my_new_step(ctx: StepContext) -> StepResult:
    """One sentence: what this step does in the lifecycle."""
    # 1. Lazy-import heavy deps so the registry can be loaded without them.
    from factory_v2.shared.my_helper import do_work

    # 2. Read inputs from the job snapshot or shard input.
    job_data = _content_job_data(ctx.job)
    runtime = _runtime(ctx.job)
    payload = runtime.get("some_artifact_from_prior_step")
    if not payload:
        raise ValueError("Missing runtime.some_artifact_from_prior_step")

    # 3. Idempotency guard — reuse output from a prior interrupted run.
    output_path = some_deterministic_path(ctx.run_id)
    if not output_path.exists():
        result = do_work(payload)
        write_output(output_path, result)

    # 4. Optional progress message (shown in admin UI).
    ctx.progress("My step finished phase 2/3")

    # 5. Return the canonical result.
    return StepResult(
        output={"summary_field": ...},
        runtime_patch={"my_step_artifact": str(output_path)},
        summary_patch={"currentStep": "my_new_step"},
        # compat_content_job_patch={...},  # only for legacy admin views
    )
```

**Conventions** (see existing steps for examples):

- **Lazy imports.** Heavy ML / cloud deps (`torch`, `whisper`, `firebase_admin`) are imported *inside* the function body. The registry [`registry.py`](factory_v2/steps/registry.py) does `import_module` at claim time — top-level imports would crash worker stacks that don't have those deps.
- **Idempotency.** Steps must be safe to re-run. Use deterministic output paths and skip if the artifact already exists. The orchestrator may re-enqueue a step after a worker crash.
- **Fail loud.** Raise `ValueError` / `FileNotFoundError` for missing inputs. The claim loop handles retries and terminal failure.
- **`runtime_patch` writes are dot-notation merges.** `{"foo": {"bar": 1}}` overwrites the whole `foo` map. To update one nested key without clobbering siblings, use `{"foo.bar": 1}` (Firestore dot-notation). See [`firestore_repos.py:158`](factory_v2/infrastructure/firestore_repos.py).

### 2. Register the step

[`worker/factory_v2/steps/registry.py`](factory_v2/steps/registry.py) — add one line to `EXECUTOR_PATHS`:

```python
"my_new_step": ("<workflow_module>", "execute_my_new_step"),
```

The module name is relative to `factory_v2.steps`. Keys here are the **persisted step names** that appear in `factory_jobs.steps[].name` and the queue.

### 3. Add to the workflow spec

[`worker/factory_v2/application/scheduler.py`](factory_v2/application/scheduler.py) — add the step name to the relevant `WorkflowSpec.steps` list. Two flavors:

- **Static-edge step (linear flow).** Add to `steps` *and* `edges`:
  ```python
  steps=[..., "format_script", "my_new_step", ...],
  edges={..., "format_script": ["my_new_step"], "my_new_step": ["next_step"], ...},
  ```
  The orchestrator's generic DAG-following code at the bottom of `on_step_success` enqueues you automatically.

- **Dynamic / fan-out step.** Add to `steps` only (display order). Leave out of `edges` and add a hook in `on_step_success` (next step).

### 4. Wire the orchestrator (if dynamic)

[`worker/factory_v2/application/orchestrator.py`](factory_v2/application/orchestrator.py).

For most non-trivial steps you'll add three things:

**(a) A constant** for the step name at the top of the file:

```python
SINGLE_AUDIO_QC_STEP = "qc_audio_chunk"
```

**(b) A hook in `on_step_success`** that decides what to enqueue next:

```python
if job["job_type"] == "single_content":
    if step_name == SINGLE_AUDIO_QC_STEP:
        self._evaluate_my_step_results(job, job_id, run_id)
        return
```

**(c) Helper methods** for fan-out / fan-in / retry / park, modeled on existing ones:

| Pattern | Look at |
|---|---|
| Fan-out (one step → N parallel shards) | `_fan_out_single_audio` |
| Fan-in (wait for all shards before continuing) | `_maybe_enqueue_single_audio_assembly` |
| Custom retry (delete artifact + re-enqueue) | `_retry_qc_failed_chunks` |
| Park run for human review | `_park_run_for_qc_review` |
| Self-healing recovery sweep | `recover_*_if_ready` |

Use `_ensure_step_enqueued(...)` to push work — it creates the step-run document *and* the queue item atomically. Never call `queue_repo.enqueue` directly without going through it.

### 5. Capability routing

[`worker/factory_v2/shared/queue_capabilities.py`](factory_v2/shared/queue_capabilities.py).

This module decides what `capability_key` a queue item carries, which determines which workers can claim it. There are four built-in capability buckets:

| capability_key | Meaning | Workers |
|---|---|---|
| `default` | CPU-only (LLM, format, upload, publish) | any with `acceptNonTtsSteps: true` |
| `image` | Stable Diffusion / Flux image gen | stacks with `extraCapabilityKeys: ["image"]` |
| `qc` | Whisper transcription QC | stacks with `extraCapabilityKeys: ["qc"]` |
| `tts:<model>` / `tts:any` | Specific TTS model | stacks with that model in `ttsModels` |

To add a new capability bucket, do three things in order:

1. **Add a STEP_NAMES set** to enumerate which steps belong to your capability:
   ```python
   MY_CAPABILITY_STEP_NAMES = {"my_new_step", "my_other_step"}
   ```
2. **Add an `is_<cap>_step()`** helper for clarity.
3. **Add a branch in `capability_key_for_step()`** *before* the TTS / fallback branches:
   ```python
   if is_my_cap_step(step_name):
       return "my_cap"
   ```

If your step uses an existing bucket (most CPU-only steps use `default`), just leave it alone — the fallback handles it.

### 6. Add a shared library if needed

`worker/factory_v2/shared/<helper>.py` for code multiple executors share (algorithms, utilities, gateway wrappers). Same lazy-import discipline applies — if your library pulls heavy deps, do imports inside functions.

### 7. ⚠️ Update the companion autoscaler

[`worker/companion/control_loop.py`](companion/control_loop.py).

This is **the most-missed step** when adding a new capability bucket. Without it:

- Orchestrator enqueues your step's queue items correctly.
- The new worker stack is configured.
- But the autoscaler never spawns the stack, because it doesn't recognize the new capability — your work piles up forever.

Three places to update (mirroring how `image` is handled):

**(a) `_collect_auto_workload_from_payloads`** — add a new outstanding-count bucket:

```python
my_cap_outstanding = 0
# ...
for payload in queue_payloads:
    capability_key = capability_key_for_payload(payload)
    if capability_key == "my_cap":
        my_cap_outstanding += 1
        continue
    # ... other buckets ...

return {
    "my_cap_outstanding": my_cap_outstanding,
    # ...
    "has_any_work": (
        # ...
        or my_cap_outstanding > 0
    ),
}
```

**(b) `_desired_auto_stack_ids`** — add a rule that spawns the right stack:

```python
if workload.get("my_cap_outstanding", 0) > 0:
    candidates = [
        stack for stack in enabled_stacks
        if "my_cap" in stack_capability_keys(stack)
    ]
    desired_ids.update(_pick_stack_ids(
        candidates,
        needed_count=min(1, len(candidates)),
        running_ids=running_ids,
        active_owners=active_owners,
        selected_ids=desired_ids,
    ))
```

**(c) `_collect_auto_workload`** — include your bucket in the top-level `has_any_work`:

```python
workload["has_any_work"] = (
    pending_jobs
    or delete_jobs
    # ...
    or workload.get("my_cap_outstanding", 0) > 0
    # ...
)
```

If you skip step 7, jobs that reach your step will hang silently. Symptom: `desired_stacks` in the companion log never includes your stack, even though the queue has pending items for it.

### 8. Configure a worker stack

[`worker/worker_stacks.json`](worker_stacks.json) — add an entry, or attach `extraCapabilityKeys` to an existing stack.

```json
{
  "id": "local-my-cap",
  "role": "my-cap",
  "venv": ".venv-my-cap",
  "replicas": 1,
  "enabled": true,
  "dispatch": false,
  "acceptNonTtsSteps": false,
  "ttsModels": [],
  "extraCapabilityKeys": ["my_cap"],
  "memoryPerWorkerMB": 4000
}
```

Keys explained:

| Field | Meaning |
|---|---|
| `id` | Unique stack identifier (used in logs and worker_status) |
| `venv` | Path to the venv (relative to `worker/`). Must match what `run_companion.sh` provisions. |
| `replicas` | How many worker processes to spawn from this stack (default 1). Suffixed `-2`, `-3`, … |
| `enabled` | Stack participates in runtime. Set `true` for your step to actually run. |
| `dispatch` | `true` → this stack creates new factory runs from `content_jobs`. Only one stack should have this. |
| `acceptNonTtsSteps` | `true` → claims `default` capability items. |
| `ttsModels` | TTS model IDs this stack supports. Empty if not a TTS stack. |
| `extraCapabilityKeys` | Custom capabilities (e.g. `["image"]`, `["qc"]`). Match step's `capability_key`. |
| `memoryPerWorkerMB` | Budget hint for the memory guard. Set conservatively from observed RSS. |

**Memory-guard tip.** `memoryPerWorkerMB` is consulted by the pre-spawn memory gate at [`control_loop.py:_apply_memory_guard`](companion/control_loop.py). If you set this higher than free RAM, your stack will be evicted from the desired set. Calibrate against actual RSS once you have a working stack.

### 9. Provision the venv

If your step needs deps that conflict with existing stacks (or you just want isolation), use a separate venv. Two files:

**(a) `worker/requirements.<stack>.txt`** — pin your deps. **Always start with `-r requirements.base.txt`** so the venv inherits firebase_admin, google-cloud, and the other deps `local_worker.py` needs to boot:

```
-r requirements.base.txt
my-heavy-lib==1.2.3
```

Without the inherit line, the stack worker will crash-loop with `ModuleNotFoundError: No module named 'firebase_admin'`. See [`requirements.qwen.txt`](requirements.qwen.txt) for the reference pattern.

**(b) `worker/run_companion.sh`** — add the venv path constants and an `ensure_venv` call:

```bash
MYCAP_VENV="$WORKER_DIR/.venv-my-cap"
MYCAP_PY="$MYCAP_VENV/bin/python"
MYCAP_REQ="$WORKER_DIR/requirements.my-cap.txt"
MYCAP_MARKER="$MYCAP_VENV/.deps_installed"

# …after existing ensure_venv calls…
ensure_venv "$MYCAP_VENV" "$MYCAP_PY" "$MYCAP_REQ" "$MYCAP_MARKER"
```

**Tradeoffs (per [`VENV_STRATEGY.md`](VENV_STRATEGY.md)):**

- Use a separate venv only when there's a real conflict (`pip` resolver fails, or model needs different `torch` / `transformers` / native deps).
- Otherwise add deps to `requirements.base.txt` and reuse `.venv` — keeps boot-up time and disk usage down.
- A small library that's used by multiple stacks (e.g. `num2words` in audio_qc) belongs in `requirements.base.txt` so it's importable from anywhere.

### 10. Tests + docs

**Tests.** `worker/tests/test_<step>.py`. Mock heavy I/O (Whisper, LLM clients, Firestore) and assert on `StepResult.output`, `runtime_patch`, and `summary_patch`. See [`test_qc_chunk_step.py`](tests/test_qc_chunk_step.py) for a clean executor test pattern.

If your orchestrator hook is non-trivial, also add a test using the in-memory repo fakes (see existing course tests).

**Docs.** Add a section to [`CONTENT_FACTORY.md`](CONTENT_FACTORY.md) under "Step Workflows": where the step sits, what it produces, what env vars tune it, what verdicts / states it can return.

If you added a new venv, document it in [`VENV_STRATEGY.md`](VENV_STRATEGY.md).

---

## Reference

### `StepContext` (input to executor)

Defined in [`factory_v2/steps/base.py`](factory_v2/steps/base.py).

| Field | Meaning |
|---|---|
| `ctx.job` | The full `factory_jobs` document snapshot at claim time |
| `ctx.run_id` | Current run's ID — use for deterministic output paths |
| `ctx.shard_key` | `"root"` for non-fan-out steps, e.g. `"chunk:3"` or `"M2P"` for shards |
| `ctx.step_input` | Dict of extra params passed by the orchestrator (e.g. `{"chunk_index": 3}`) |
| `ctx.progress(detail)` | Report a progress string back to the watchdog/admin UI |

### `StepResult` (return value)

| Field | Meaning |
|---|---|
| `output` | Dict written to the step-run record. Use for human-readable summaries. |
| `runtime_patch` | Top-level keys merged into `factory_jobs.<id>.runtime`. **Use dot-notation (`{"chunk_qc.0": ...}`) to update nested fields without clobbering siblings.** |
| `summary_patch` | Lightweight progress data for `factory_jobs.<id>.summary`. Always include `currentStep`. |
| `compat_content_job_patch` | Optional dict written to the legacy `content_jobs` collection for the old admin UI. |
| `requeue_after_seconds` | Optional. Use for long-poll patterns (e.g. `watch_subject_children`). |

---

## Patterns

### Simple linear step (LLM call, upload, etc.)

Touch points: 1, 2, 3 (with edges), 10. Skip 4, 7, 8, 9 (uses `local-primary`'s `default` bucket).

Example: `format_script`. Lives in `single_content.py`. Registered in `registry.py`. Has static edge `generate_script → format_script` in `scheduler.py`. The orchestrator's generic DAG-follow code handles enqueueing.

### Fan-out / fan-in step

Touch points: 1, 2, 3 (no edges; orchestrator-managed), 4 (custom hooks), 10.

Example: `synthesize_audio_chunk`. Orchestrator's `_fan_out_single_audio` enqueues N shards on `generate_image` success. Orchestrator's `_maybe_enqueue_single_audio_assembly` waits for all shards then enqueues `assemble_audio`.

Use deterministic shard keys (`make_single_chunk_shard_key(i)`) and pass `chunk_index` via `step_input` so the executor can re-derive its work.

### Step with isolated venv (Whisper, GPU model, …)

Add 5 (new capability key), 7 (autoscaler bucket), 8 (new stack), 9 (new venv).

Example: `qc_audio_chunk`. Capability `qc`. Stack `local-qc` with `.venv-qc`. Autoscaler bucket `qc_outstanding`.

### Step with verdict / parking semantics

The step always succeeds (writes a verdict to `runtime`); the *orchestrator* inspects the verdict on success and decides next. See `_evaluate_single_audio_qc` for a pattern: PASS → continue, REVIEW → park (no auto-retry), FAIL → custom retry with deletion + re-enqueue.

To "park" a run: write a flag to `runtime` and `summary`, and don't enqueue anything else. The run stays in `running` state. An admin command (Phase 3) un-parks it.

### Step with approval checkpoint

Return early with `awaiting_<thing>` flag in `output`/`summary_patch` and don't progress the workflow. The claim loop will treat it as `completed` for compat purposes. An admin action sets a runtime flag that the same step re-runs and now passes through. See `execute_generate_script`'s script-approval flow.

---

## Worked example: the QC step

For a fully-implemented reference, here are the files touched when adding `qc_audio_chunk`:

| Touchpoint | File | What |
|---|---|---|
| 1. Executor | `factory_v2/steps/single_content.py` | `execute_qc_audio_chunk` + module-level Whisper model cache |
| 2. Registry | `factory_v2/steps/registry.py` | `"qc_audio_chunk": ("single_content", "execute_qc_audio_chunk")` |
| 3. Workflow | `factory_v2/application/scheduler.py` | Added to `SINGLE_CONTENT_WORKFLOW.steps` (no static edge — orchestrator-managed) |
| 4. Orchestrator | `factory_v2/application/orchestrator.py` | `SINGLE_AUDIO_QC_STEP` constant; `_maybe_fan_out_single_audio_qc`; `_evaluate_single_audio_qc`; `_retry_qc_failed_chunks`; `_park_run_for_qc_review` |
| 5. Capabilities | `factory_v2/shared/queue_capabilities.py` | `QC_STEP_NAMES`; `is_qc_step()`; `qc` branch in `capability_key_for_step` |
| 6. Shared lib | `factory_v2/shared/audio_qc.py` | Pure-Python QC algorithm (regex normalize + diff + verdict) |
| 7. Autoscaler | `companion/control_loop.py` | `qc_outstanding` bucket; spawn rule for `qc` capability stacks; `has_any_work` clause |
| 8. Stack | `worker_stacks.json` | `local-qc` entry with `extraCapabilityKeys: ["qc"]` |
| 9. Venv | `requirements.qc.txt`; `run_companion.sh` | New `.venv-qc` provisioning |
| Repos | `factory_v2/infrastructure/firestore_repos.py` | `step_run_repo.delete()` for clean retry path |
| Tests | `tests/test_qc_chunk_step.py` | 6 executor unit tests with Whisper mocked |
| Docs | `CONTENT_FACTORY.md`; `VENV_STRATEGY.md` | New "Audio QC" section; QC stack note |

---

## Common mistakes (learned the hard way)

1. **Forgetting the autoscaler.** Touchpoint 7. Symptom: queue items pile up but `desired_stacks` never includes your new stack. The orchestrator enqueues, the stack is configured, but no worker is ever spawned. **Always check the log for `desired_stacks` containing your stack ID after kicking off a job.**

2. **Top-level imports of heavy deps.** Importing `whisper` or `torch` at the module level of a step file breaks every other stack that doesn't have those deps installed (registry imports the module). Always import inside the function.

3. **Clobbering nested runtime fields.** `runtime_patch={"chunk_qc": {0: ...}}` will replace the entire `chunk_qc` map, losing siblings. Use dot-notation: `{"chunk_qc.0": ...}`.

4. **Forgetting `num2words` / shared deps in base.** If a shared library imports something, every venv that loads the library needs it. Either lazy-import the heavy bit (preferred for ML deps) or add the small bit to `requirements.base.txt` (preferred for utilities like `num2words`).

5. **Memory budget set too high.** `memoryPerWorkerMB: 9000` was set when local-primary did image gen too. Now it just dispatches and the budget is too generous, causing the memory guard to evict it on systems with <10 GB free. Calibrate against observed RSS.

6. **Plist bypassing `run_companion.sh`.** If a launchd plist runs `python local_companion.py` directly, the `ensure_venv` provisioning logic never fires and new venvs are missing on boot. Always have launchd execute `run_companion.sh`, which `exec`s into the companion at the end.

7. **Step run state ≠ verdict.** A QC step can succeed (state="succeeded") while producing a FAIL verdict. The orchestrator must inspect `runtime` to decide next, not the step-run state. For retries, you need to *delete* the prior step-run docs (`step_run_repo.delete()`) to avoid the fan-out helper skipping the chunk on its next pass.

8. **Idempotency check skipping a re-render.** Synth steps skip work if the output WAV already exists. To force a re-render (e.g. on QC FAIL), the retry path must delete the WAV file *and* the step-run doc before re-enqueueing.

9. **`FACTORY_*` env vars not set under launchd.** launchd uses its own environment — env vars from your shell won't propagate. Either default the env var ON in code, or add it explicitly to the plist's `EnvironmentVariables` block.

10. **Modifying `requirements.base.txt` without restarting.** The `ensure_venv` marker file is timestamp-based: changing `requirements.base.txt` triggers a full re-install of the base venv on the next companion boot (~2 min). Plan for this when shipping changes.

11. **Custom `requirements.<stack>.txt` must inherit from base.** Every worker subprocess starts with `import firebase_admin` at [`local_worker.py:31`](local_worker.py:31), plus `google-cloud-*`, `firestore`, etc. If your custom requirements file only lists *new* deps (e.g. just `openai-whisper`), the venv will be missing the base deps and the worker will crash-loop with `ModuleNotFoundError: No module named 'firebase_admin'`. Always start the file with:
    ```
    -r requirements.base.txt
    ```
    Symptom: `local_worker_<stack>.log` shows a tight loop of `ModuleNotFoundError` tracebacks, the stack appears in `desired_stacks`/`running` in the companion log but no work ever gets claimed. See [`requirements.qwen.txt`](requirements.qwen.txt) and [`requirements.qc.txt`](requirements.qc.txt) for the canonical pattern.

12. **launchd plist `PATH` must include `/opt/homebrew/bin` on Apple Silicon.** Tools your step shells out to (ffmpeg for Whisper, ffprobe for audio metadata, etc.) live in `/opt/homebrew/bin` on M-series Macs but `/usr/local/bin` on Intel. The default launchd `PATH` includes neither, and a launchd-spawned process won't inherit your shell's PATH. Add both to `EnvironmentVariables.PATH` in the plist:
    ```xml
    <key>PATH</key>
    <string>/Users/aidenhyun/calmdemy-admin-repo/worker/.venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    ```
    Symptom: `local_worker_<stack>.log` has `FileNotFoundError: [Errno 2] No such file or directory: 'ffmpeg'` (or whatever tool). Works fine when you launch the companion from your terminal, breaks under launchd.

---

## Quick verification after adding a step

After implementing, kick off a job and verify all layers:

```bash
# 1. The orchestrator is enqueueing your step
launchctl kickstart -k gui/$(id -u)/com.calmdemy.companion
# Watch the log for your step name appearing in queue_payloads.

# 2. The autoscaler is spawning your stack
tail -f worker/logs/companion-launchd.log | grep -E "desired_stacks|running"
# Look for your stack ID in both lists when work is queued.

# 3. The worker process actually started (not just "running" in companion log)
ps -axo pid,etime,command | grep local_worker | grep -v grep
# Confirm the elapsed time is recent. If the companion claims a stack is
# "running" but no process appears here, the worker is crash-looping —
# look at logs/local_worker_<stack>.log for the import / boot error.

# 4. Per-stack worker log is clean
tail -50 worker/logs/local_worker_<your_stack>.log
# Look for repeated tracebacks — most commonly:
#   - ModuleNotFoundError: missing dep in requirements.<stack>.txt
#   - FileNotFoundError: shell tool missing from launchd PATH

# 5. The step is actually running and producing verdicts
grep "<your_step_name>" worker/logs/local_worker_<your_stack>.log

# 6. Runtime is being patched correctly
# Check Firestore: factory_jobs/<id>/runtime — your output is there.

# 7. The next step is being enqueued
# Check Firestore: factory_step_queue — successor step is queued.
```

If any of those fail, walk back through the corresponding touchpoint in this guide. **Pay special attention to step 4** — the companion-launchd log will happily report a stack as "running" even when its worker process is in a tight crash loop. The per-stack `local_worker_<id>.log` is the truth.
