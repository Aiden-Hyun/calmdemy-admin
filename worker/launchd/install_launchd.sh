#!/usr/bin/env bash
#
# Render the companion launchd plist template into ~/Library/LaunchAgents
# and (un)load it so the change takes effect.
#
# Why this exists:
#   The runtime plist at ~/Library/LaunchAgents/com.calmdemy.companion.plist
#   is not version-controlled. Hand-edits drift over time (we shipped one
#   pointing at a path that no longer existed; we missed /opt/homebrew/bin
#   from PATH and ffmpeg lookups failed under Whisper). This script makes
#   the plist a derivative of the in-repo template + machine-detected paths.
#
# Usage:
#   ./worker/launchd/install_launchd.sh
#
# Rerun whenever you update worker/launchd/com.calmdemy.companion.plist.template.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/com.calmdemy.companion.plist.template"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/com.calmdemy.companion.plist"
LABEL="com.calmdemy.companion"

# Detect the right Homebrew prefix. Apple Silicon uses /opt/homebrew, Intel
# uses /usr/local. The fallback path is harmless if neither exists; PATH
# entries that don't resolve are silently ignored at lookup time.
if [ -d "/opt/homebrew/bin" ]; then
  HOMEBREW_BIN="/opt/homebrew/bin"
elif [ -d "/usr/local/bin" ]; then
  HOMEBREW_BIN="/usr/local/bin"
else
  echo "[install_launchd] Warning: no Homebrew prefix detected; defaulting to /opt/homebrew/bin"
  HOMEBREW_BIN="/opt/homebrew/bin"
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "[install_launchd] Template missing at $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST_DEST")"

# Render the template. We use bash substitution rather than sed to avoid
# pitfalls with slashes in paths.
content="$(cat "$TEMPLATE")"
content="${content//\{\{WORKER_DIR\}\}/$WORKER_DIR}"
content="${content//\{\{HOMEBREW_BIN\}\}/$HOMEBREW_BIN}"
printf "%s\n" "$content" > "$PLIST_DEST"

echo "[install_launchd] Wrote $PLIST_DEST"
echo "[install_launchd]   WORKER_DIR=$WORKER_DIR"
echo "[install_launchd]   HOMEBREW_BIN=$HOMEBREW_BIN"

# Reload so the new plist takes effect immediately. unload is best-effort:
# ok if the agent isn't currently loaded.
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

# Sanity check: confirm launchd accepted the plist.
if launchctl list | grep -q "$LABEL"; then
  echo "[install_launchd] Loaded $LABEL"
else
  echo "[install_launchd] ERROR: $LABEL not in launchctl list after load" >&2
  exit 1
fi

echo "[install_launchd] Tail companion log to confirm boot:"
echo "    tail -f $WORKER_DIR/logs/companion-launchd.log"
