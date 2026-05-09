# launchd setup for the worker companion

This folder owns the launchd configuration that auto-starts the companion at
login on macOS.

## Files

| File | Purpose |
|---|---|
| `com.calmdemy.companion.plist.template` | The source-of-truth plist with placeholders. **Edit this**, never the runtime copy. |
| `install_launchd.sh` | Renders the template, writes it to `~/Library/LaunchAgents`, and reloads launchd. |

## When to run `install_launchd.sh`

- First setup on a new machine.
- After editing the template (e.g. changing `EnvironmentVariables`, paths, or
  `KeepAlive` policy).
- After moving the repo to a different path on disk.

The script is idempotent — re-running just re-renders and reloads.

## How it relates to `run_companion.sh`

- launchd → `run_companion.sh` → provisions every venv → execs into
  `local_companion.py`.
- The plist intentionally invokes the bash script (not python directly) so
  new venvs added to `worker_stacks.json` get auto-built before the
  companion boots. Skipping this caused the QC stack to crash-loop in an
  earlier iteration; see
  [`HOW_TO_ADD_A_STEP_TO_PIPELINE.md`](../HOW_TO_ADD_A_STEP_TO_PIPELINE.md)
  Common Mistakes #11 and #12.

## What's NOT in the plist

The plist's `EnvironmentVariables` block only sets `PATH`. Application-level
flags (`FACTORY_QC_ENABLED`, `FACTORY_QC_WHISPER_MODEL`, etc.) default to
sensible values in code; override in the plist only when you need to.
