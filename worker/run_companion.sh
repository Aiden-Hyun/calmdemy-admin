#!/usr/bin/env bash
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BASE_VENV="$WORKER_DIR/.venv"
BASE_PY="$BASE_VENV/bin/python"
BASE_REQ="$WORKER_DIR/requirements.base.txt"
BASE_MARKER="$BASE_VENV/.deps_installed"

QWEN_VENV="$WORKER_DIR/.venv-qwen"
QWEN_PY="$QWEN_VENV/bin/python"
QWEN_REQ="$WORKER_DIR/requirements.qwen.txt"
QWEN_MARKER="$QWEN_VENV/.deps_installed"

ensure_venv() {
  local venv_dir="$1"
  local python_bin="$2"
  local req_file="$3"
  local marker_file="$4"

  if [ ! -x "$python_bin" ]; then
    echo "[companion] Creating virtual environment at $venv_dir"
    python3 -m venv "$venv_dir"
  fi

  "$python_bin" -m pip install --upgrade pip >/dev/null

  if [ -f "$req_file" ] && { [ ! -f "$marker_file" ] || [ "$req_file" -nt "$marker_file" ]; }; then
    echo "[companion] Installing dependencies from $req_file..."
    "$python_bin" -m pip install -r "$req_file"
    touch "$marker_file"
  fi
}

ensure_venv "$BASE_VENV" "$BASE_PY" "$BASE_REQ" "$BASE_MARKER"
ensure_venv "$QWEN_VENV" "$QWEN_PY" "$QWEN_REQ" "$QWEN_MARKER"

echo "[companion] Starting local companion..."
exec "$BASE_PY" "$WORKER_DIR/local_companion.py"
