#!/usr/bin/env bash
set -euo pipefail

if [[ "${RUNNER_OS:-Linux}" != "Linux" ]]; then
  echo "Runtime smoke is Linux-only."
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="${SCOUT_BINARY:-$ROOT_DIR/src-tauri/target/debug/scout}"
TEMP_ROOT="${RUNNER_TEMP:-/tmp}/scout-runtime-smoke"
FIXTURE_HOME="$TEMP_ROOT/home"
LOG_PATH="${RUNNER_TEMP:-/tmp}/scout-runtime.log"
SCREENSHOT_PATH="${RUNNER_TEMP:-/tmp}/scout-runtime-smoke.png"
DISPLAY_NUMBER="${SCOUT_SMOKE_DISPLAY:-:98}"

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

unset XAUTHORITY WAYLAND_DISPLAY
export DISPLAY="$DISPLAY_NUMBER"
export GDK_BACKEND=x11
export HOME="$FIXTURE_HOME"
export XDG_CONFIG_HOME="$FIXTURE_HOME/.config"
export XDG_DATA_HOME="$FIXTURE_HOME/.local/share"
export XDG_CACHE_HOME="$FIXTURE_HOME/.cache"
export XDG_RUNTIME_DIR="$TEMP_ROOT/runtime"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

Xvfb "$DISPLAY_NUMBER" -screen 0 1400x900x24 -nolisten tcp -ac >"$TEMP_ROOT/xvfb.log" 2>&1 &
XVFB_PID=$!
DISPLAY_ID="${DISPLAY_NUMBER#:}"
for _ in $(seq 1 50); do
  if [[ -S "/tmp/.X11-unix/X${DISPLAY_ID}" ]]; then break; fi
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "Xvfb exited before the runtime smoke could start." >&2
    cat "$TEMP_ROOT/xvfb.log" >&2 || true
    exit 1
  fi
  sleep 0.2
done
if [[ ! -S "/tmp/.X11-unix/X${DISPLAY_ID}" ]]; then
  echo "Xvfb did not expose display $DISPLAY_NUMBER." >&2
  cat "$TEMP_ROOT/xvfb.log" >&2 || true
  exit 1
fi

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

focus_scout() {
  xdotool windowfocus --sync "$WINDOW_ID" >/dev/null 2>&1 || xdotool windowfocus "$WINDOW_ID" >/dev/null 2>&1 || true
  sleep 0.08
}

send_key() {
  local key="$1"
  for _ in 1 2 3; do
    focus_scout
    if xdotool key --clearmodifiers "$key" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.15
  done
  echo "Could not send runtime-smoke key: $key" >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
}

send_text() {
  local text="$1"
  for _ in 1 2 3; do
    focus_scout
    if xdotool type --clearmodifiers --delay 10 "$text" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.15
  done
  echo "Could not type runtime-smoke text" >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
}

focus_scout
sleep 1

send_key ctrl+l
sleep 0.3
send_text '~/A-Folder'
send_key Return
sleep 0.8
send_key ctrl+l
sleep 0.3
send_text '~'
send_key Return
sleep 0.8

send_key ctrl+t
sleep 0.4
send_key ctrl+w
sleep 0.5

if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
  echo "Scout crashed during location/tab navigation." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

send_key ctrl+3
sleep 1
send_key Down
sleep 0.7
send_key Right
sleep 0.5
send_key Down
sleep 0.7
send_key Right
sleep 0.5
send_key Down
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

send_key Left
sleep 0.4
send_key Right
sleep 0.6

if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
  echo "Scout crashed during horizontal Columns navigation." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

if grep -Eqi 'panicked at|thread .* panicked|fatal error|segmentation fault' "$LOG_PATH"; then
  echo "Scout runtime log contains a fatal error." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

# UX20 contract: native window geometry survives a real process relaunch.
TARGET_X=112
TARGET_Y=84
TARGET_WIDTH=1080
TARGET_HEIGHT=680
GEOMETRY_TOLERANCE=48
xdotool windowsize "$WINDOW_ID" "$TARGET_WIDTH" "$TARGET_HEIGHT"
xdotool windowmove "$WINDOW_ID" "$TARGET_X" "$TARGET_Y"
sleep 1

if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
  echo "Scout exited before window geometry could be persisted." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

kill "$SCOUT_PID"
wait "$SCOUT_PID" 2>/dev/null || true
SCOUT_PID=""

"$BINARY" >>"$LOG_PATH" 2>&1 &
SCOUT_PID=$!
RESTORED_WINDOW_ID=""
for _ in $(seq 1 60); do
  if ! kill -0 "$SCOUT_PID" 2>/dev/null; then
    echo "Scout exited during UX20 relaunch." >&2
    cat "$LOG_PATH" >&2 || true
    exit 1
  fi
  RESTORED_WINDOW_ID="$(xdotool search --onlyvisible --pid "$SCOUT_PID" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$RESTORED_WINDOW_ID" ]]; then break; fi
  sleep 0.25
done

if [[ -z "$RESTORED_WINDOW_ID" ]]; then
  echo "Scout did not expose a visible window after UX20 relaunch." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

WINDOW_ID="$RESTORED_WINDOW_ID"
sleep 1
GEOMETRY="$(xdotool getwindowgeometry --shell "$WINDOW_ID")"
RESTORED_X="$(printf '%s\n' "$GEOMETRY" | awk -F= '$1 == "X" { print $2 }')"
RESTORED_Y="$(printf '%s\n' "$GEOMETRY" | awk -F= '$1 == "Y" { print $2 }')"
RESTORED_WIDTH="$(printf '%s\n' "$GEOMETRY" | awk -F= '$1 == "WIDTH" { print $2 }')"
RESTORED_HEIGHT="$(printf '%s\n' "$GEOMETRY" | awk -F= '$1 == "HEIGHT" { print $2 }')"

abs_diff() {
  local left="$1"
  local right="$2"
  local diff=$((left - right))
  if (( diff < 0 )); then diff=$((-diff)); fi
  printf '%s' "$diff"
}

if (
  (($(abs_diff "$RESTORED_X" "$TARGET_X") > GEOMETRY_TOLERANCE)) ||
  (($(abs_diff "$RESTORED_Y" "$TARGET_Y") > GEOMETRY_TOLERANCE)) ||
  (($(abs_diff "$RESTORED_WIDTH" "$TARGET_WIDTH") > GEOMETRY_TOLERANCE)) ||
  (($(abs_diff "$RESTORED_HEIGHT" "$TARGET_HEIGHT") > GEOMETRY_TOLERANCE))
); then
  echo "Scout did not restore UX20 window geometry within tolerance." >&2
  echo "Expected: x=$TARGET_X y=$TARGET_Y width=$TARGET_WIDTH height=$TARGET_HEIGHT" >&2
  echo "Actual:   x=$RESTORED_X y=$RESTORED_Y width=$RESTORED_WIDTH height=$RESTORED_HEIGHT" >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

import -display "$DISPLAY" -window "$WINDOW_ID" "$SCREENSHOT_PATH"
identify "$SCREENSHOT_PATH"

if [[ ! -s "$SCREENSHOT_PATH" ]]; then
  echo "Runtime screenshot was not produced after UX20 relaunch." >&2
  exit 1
fi

if grep -Eqi 'panicked at|thread .* panicked|fatal error|segmentation fault' "$LOG_PATH"; then
  echo "Scout runtime log contains a fatal error after UX20 relaunch." >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

echo "Scout runtime smoke passed. Window=$WINDOW_ID PID=$SCOUT_PID"
echo "UX20 restored geometry: x=$RESTORED_X y=$RESTORED_Y width=$RESTORED_WIDTH height=$RESTORED_HEIGHT"
echo "Screenshot: $SCREENSHOT_PATH"