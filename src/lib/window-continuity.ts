import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow, type Monitor } from "@tauri-apps/api/window";

const WINDOW_STATE_KEY = "scout.session.window.v1";
const MIN_WIDTH = 900;
const MIN_HEIGHT = 580;
const SAVE_DELAY_MS = 180;

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PersistedWindowState extends WindowBounds {
  maximized: boolean;
  updatedAt: number;
}

let disposed = false;
let restoring = false;
let saveTimer: number | null = null;
let captureGeneration = 0;
let lastNormalBounds: WindowBounds | null = null;
let unlisteners: Array<() => void> = [];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readState(): PersistedWindowState | null {
  try {
    const raw = localStorage.getItem(WINDOW_STATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedWindowState>;
    if (
      !finite(value.x) ||
      !finite(value.y) ||
      !finite(value.width) ||
      !finite(value.height) ||
      typeof value.maximized !== "boolean"
    ) {
      return null;
    }

    return {
      x: value.x,
      y: value.y,
      width: Math.max(MIN_WIDTH, value.width),
      height: Math.max(MIN_HEIGHT, value.height),
      maximized: value.maximized,
      updatedAt: finite(value.updatedAt) ? value.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeState(state: PersistedWindowState) {
  try {
    localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Window continuity is best-effort and must never block Scout startup.
  }
}

function monitorBounds(monitor: Monitor): WindowBounds {
  const area = monitor.workArea;
  return {
    x: area.position.x,
    y: area.position.y,
    width: area.size.width,
    height: area.size.height,
  };
}

function intersectionArea(left: WindowBounds, right: WindowBounds) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function centerDistanceSquared(left: WindowBounds, right: WindowBounds) {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return (leftX - rightX) ** 2 + (leftY - rightY) ** 2;
}

function bestMonitor(bounds: WindowBounds, monitors: Monitor[]) {
  if (!monitors.length) return null;

  let best = monitors[0];
  let bestBounds = monitorBounds(best);
  let bestIntersection = intersectionArea(bounds, bestBounds);
  let bestDistance = centerDistanceSquared(bounds, bestBounds);

  for (const monitor of monitors.slice(1)) {
    const candidateBounds = monitorBounds(monitor);
    const candidateIntersection = intersectionArea(bounds, candidateBounds);
    const candidateDistance = centerDistanceSquared(bounds, candidateBounds);
    if (
      candidateIntersection > bestIntersection ||
      (candidateIntersection === bestIntersection && candidateDistance < bestDistance)
    ) {
      best = monitor;
      bestBounds = candidateBounds;
      bestIntersection = candidateIntersection;
      bestDistance = candidateDistance;
    }
  }

  return best;
}

function clampToMonitor(bounds: WindowBounds, monitor: Monitor): WindowBounds {
  const area = monitorBounds(monitor);
  const width = Math.min(Math.max(MIN_WIDTH, bounds.width), Math.max(MIN_WIDTH, area.width));
  const height = Math.min(Math.max(MIN_HEIGHT, bounds.height), Math.max(MIN_HEIGHT, area.height));
  const maxX = Math.max(area.x, area.x + area.width - width);
  const maxY = Math.max(area.y, area.y + area.height - height);

  return {
    x: Math.min(Math.max(bounds.x, area.x), maxX),
    y: Math.min(Math.max(bounds.y, area.y), maxY),
    width,
    height,
  };
}

async function captureAndPersist() {
  if (disposed || restoring) return;
  const generation = ++captureGeneration;
  const appWindow = getCurrentWindow();

  try {
    const maximized = await appWindow.isMaximized();
    if (!maximized) {
      const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize()]);
      if (generation !== captureGeneration || disposed || restoring) return;
      lastNormalBounds = {
        x: position.x,
        y: position.y,
        width: Math.max(MIN_WIDTH, size.width),
        height: Math.max(MIN_HEIGHT, size.height),
      };
    }

    if (generation !== captureGeneration || disposed || restoring || !lastNormalBounds) return;
    writeState({ ...lastNormalBounds, maximized, updatedAt: Date.now() });
  } catch {
    // Native window state can be temporarily unavailable during shutdown.
  }
}

function schedulePersist() {
  if (disposed || restoring) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void captureAndPersist();
  }, SAVE_DELAY_MS);
}

async function restoreSavedState() {
  const saved = readState();
  const appWindow = getCurrentWindow();
  restoring = true;

  try {
    if (saved) {
      const monitors = await availableMonitors();
      const monitor = bestMonitor(saved, monitors);
      if (monitor) {
        lastNormalBounds = clampToMonitor(saved, monitor);
        await appWindow.setSize(new PhysicalSize(lastNormalBounds.width, lastNormalBounds.height));
        await appWindow.setPosition(new PhysicalPosition(lastNormalBounds.x, lastNormalBounds.y));
      }
      if (saved.maximized) await appWindow.maximize();
    }
  } catch {
    // Invalid monitor/window state falls back to Tauri's configured defaults.
  } finally {
    restoring = false;
    if (!disposed) void captureAndPersist();
  }
}

function handlePageHide() {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  void captureAndPersist();
}

export function installWindowContinuity() {
  disposed = false;
  restoring = false;
  captureGeneration += 1;
  lastNormalBounds = null;
  unlisteners = [];

  const appWindow = getCurrentWindow();
  void Promise.all([
    appWindow.onMoved(schedulePersist),
    appWindow.onResized(schedulePersist),
  ]).then((listeners) => {
    if (disposed) {
      listeners.forEach((unlisten) => unlisten());
      return;
    }
    unlisteners.push(...listeners);
  }).catch(() => {
    // Keep Scout usable even if a platform cannot publish native window events.
  });

  window.addEventListener("pagehide", handlePageHide);
  void restoreSavedState();

  return () => {
    disposed = true;
    restoring = false;
    captureGeneration += 1;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    window.removeEventListener("pagehide", handlePageHide);
    unlisteners.forEach((unlisten) => unlisten());
    unlisteners = [];
  };
}
