# Multi-Venv Worker Convention (Normative)

This document is a required architecture convention for the content factory runtime.

## Why This Convention Exists

Some model families require incompatible Python dependency trees. A known example:

- `diffusers`/Flux stack prefers newer `huggingface_hub`.
- Qwen3 TTS requires a different range.

Because of this, a single venv runtime is not a safe default.

## Hard Rules (Must Follow)

1. Do not collapse worker runtime to a single venv if incompatible model sets exist.
2. Keep stack definitions in `worker_stacks.json` as the source of truth.
3. Preserve capability-based routing:
   - only compatible stacks claim synth steps for their `ttsModels`.
   - exactly one enabled stack acts as dispatcher.
4. Keep per-stack venv isolation (`venv` path per stack).
5. During refactors, retain backward-compatible normalization for legacy stack manifests.

## Stack Manifest Contract

`worker_stacks.json` entries use:

- `id`: worker/stack identifier (used in status + logs)
- `role`: operator label (`v2`, `tts`, etc.)
- `venv`: venv path (relative to `worker/` or absolute)
- `replicas`: optional number of concrete worker processes to expand from one manifest entry (default `1`); replicas keep the base id for the first stack and suffix later ones as `-2`, `-3`, etc.
- `enabled`: stack participates in runtime
- `dispatch`: this stack may dispatch `content_jobs` into V2 runs
- `acceptNonTtsSteps`: stack can claim non-synth queue steps
- `ttsModels`: allowed TTS model IDs for synth steps (supports `"*"`)

## Default Production Shape

Three-entry manifest / nine-stack runtime default:

1. `local-primary`
   - `venv: .venv`
   - `dispatch: true`
   - `acceptNonTtsSteps: true`
   - `ttsModels: [gemini-tts-flash, gemini-tts-pro]`
2. `local-image`
   - `venv: .venv`
   - `dispatch: false`
   - `acceptNonTtsSteps: false`
   - `ttsModels: []`
   - `extraCapabilityKeys: [image]`
3. `local-tts-qwen`
   - `venv: .venv-qwen`
   - `replicas: 7`
   - `dispatch: false`
   - `acceptNonTtsSteps: false`
   - `ttsModels: [qwen3-base]`

This profile expands to `local-primary`, `local-image`, `local-tts-qwen`, `local-tts-qwen-2`, `local-tts-qwen-3`, `local-tts-qwen-4`,
`local-tts-qwen-5`, `local-tts-qwen-6`, and `local-tts-qwen-7`, supporting up to 7 concurrent Qwen synth queue items,
while preserving one dispatcher/non-TTS executor and one dedicated image executor.

## When to Add a New Venv

Create a new venv + stack if:

- pip resolver conflicts (`ResolutionImpossible`)
- model requires conflicting core libs (`torch`, `transformers`, `huggingface_hub`)
- model requires a distinct native/system dependency surface

## Refactor Checklist (Required)

Any content-factory runtime refactor must include:

1. Dependency conflict review across all registered models.
2. Confirmation that `worker_stacks.json` + capability routing still function.
3. Validation that synth steps route to compatible stack/venv.
4. Smoke run for at least one model from each isolated venv.

## Operations

- Restart companion after stack config changes.
- Use `./run_companion.sh` to provision `.venv` and `.venv-qwen` together before starting the companion.
- Validate stack health in admin (`worker_stacks_status` + per-stack logs).
- If a model has no capable enabled stack, runtime should fail fast with clear error.
- Increase Qwen stack count only when host CPU/RAM and model memory footprint can sustain parallel inference.
- Qwen defaults `QWEN_TTS_DEVICE=auto`, which resolves `cuda`, then `mps`, then `cpu` unless explicitly overridden.
