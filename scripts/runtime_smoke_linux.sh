#!/usr/bin/env bash
set -euo pipefail

if [[ "${RUNNER_OS:-Linux}" != "Linux" ]]; then
  echo "Runtime smoke is Linux-only."
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$ROOT_DIR/src-tauri/target/debug/scout"
TEMP_ROOT="${RUNNER_TEMP:-/tmp}/scout-runtime-smoke"
FIXTURE_HOME="$TEMP_ROOT/home"
LOG_PATH="${RUNNER_TEMP:-/tmp}/scout-runtime.log"
SCREENSHOT_PATH="${RUNNER_TEMP:-/tmp}/scout-runtime-smoke.png"
DISPLAY_NUMBER="${SCOUT_SMOKE_DISPLAY:-:99}"

rm -rf "$TEMP_ROOT"
mkdir -p "$FIXTURE_HOME/A-Folder/B-Folder" "$FIXTURE_HOME/Downloads" "$FIXTURE_HOME/Desktop"
printf 'Scout Columns runtime smoke test\n' > "$FIXTURE_HOME/A-Folder/B-Folder/01-preview.txt"
printf 'Sibling file\n' > "$FIXTURE_HOME/A-Folder/02-sibling.txt"
printf 'Root file\n' > "$FIXTURE_HOME/03-root.txt"

if [[ ! -x "$BINARY" ]]; then
  echo "Scout binary is missing at $BINARY" >&2
  exit 1
fi

cleanup() {
  set +e
  if [[ -n "${SCOUT_PID:-}" ]]; then kill "$SCOUT_PID" 2>/dev/null || true; fi
  if [[ -n "${XVFB_PID:-}" ]]; then kill "$XVFB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

Xvfb "$DISPLAY_NUMBER" -screen 0 1400x900x24 -nolisten tcp >"$TEMP_ROOT/xvfb.log" 2>&1 &
XVFB_PID=$!
export DISPLAY="$DISPLAY_NUMBER"
export GDK_BACKEND=x11
export HOME="$FIXTURE_HOME"
export XDG_CONFIG_HOME="$FIXTURE_HOME/.config"
export XDG_DATA_HOME="$FIXTURE_HOME/.local/share"
export XDG_CACHE_HOME="$FIXTURE_HOME/.cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

"$BINARY" >"$LOG_PATH" 2>&1 &
SCOUT_PID=$!

WINDOW_ID=""
for _ in $(seq 1 60); do
  if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
    echo "Scout exited before creating a window." >&2
    cat "$LOG_PATH" >&2 || true
    exit 1
  fi
  WINDOW_ID="$(xdotool search --onlyvisible --pid "$SCOUT_PID" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$WINDOW_ID" ]]; then break; fi
  sleep 0.25
done

if [[ -z "$WINDOW_ID" ]]; then
  echo "Scout did not expose a visible window." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

xdotool windowsize "$WINDOW_ID" 1240 780 || true
xdotool windowmove "$WINDOW_ID" 20 20 || true
xdotool windowfocus "$WINDOW_ID" || true
sleep 1

# Finder-compatible view shortcuts: 1 Icons, 2 List, 3 Columns, 4 Gallery.
xdotool key --window "$WINDOW_ID" ctrl+3
sleep 1

# Real Miller-column keyboard flow:
# Down selects A-Folder and reveals its child column.
# Right focuses the child column; Down selects B-Folder and reveals its child.
# Right focuses that column; Down selects 01-preview.txt and opens the preview column.
xdotool key --window "$WINDOW_ID" Down
sleep 0.7
xdotool key --window "$WINDOW_ID" Right
sleep 0.5
xdotool key --window "$WINDOW_ID" Down
sleep 0.7
xdotool key --window "$WINDOW_ID" Right
sleep 0.5
xdotool key --window "$WINDOW_ID" Down
sleep 1.2

if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
  echo "Scout crashed during Columns interaction." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

import -display "$DISPLAY" -window "$WINDOW_ID" "$SCREENSHOT_PATH"
identify "$SCREENSHOT_PATH"

if [[ ! -s "$SCREENSHOT_PATH" ]]; then
  echo "Runtime screenshot was not produced." >&2
  exit 1
fi

# Walk out and back into the current column after preview creation.
xdotool key --window "$WINDOW_ID" Left
sleep 0.4
xdotool key --window "$WINDOW_ID" Right
sleep 0.6

if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
  echo "Scout crashed during horizontal Columns navigation." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

echo "Scout runtime smoke passed. Window=$WINDOW_ID PID=$SCOUT_PID"
echo "Screenshot: $SCREENSHOT_PATH"
