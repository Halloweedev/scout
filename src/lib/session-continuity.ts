import { listDirectory } from "./fs";

const LAST_LOCATION_KEY = "scout.session.last-location.v1";
const RESTORE_TIMEOUT_MS = 2500;

type RestoreState = "pending" | "restoring" | "settled";

let observer: MutationObserver | null = null;
let reconcileQueued = false;
let restoreTimer: number | undefined;
let restoreState: RestoreState = "pending";
let restorePath: string | null = null;
let restoreOriginPath: string | null = null;

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function readLastLocation() {
  try {
    const value = localStorage.getItem(LAST_LOCATION_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeLastLocation(path: string) {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, path);
  } catch {
    // Session continuity is best-effort and must never block normal browsing.
  }
}

function clearLastLocation() {
  try {
    localStorage.removeItem(LAST_LOCATION_KEY);
  } catch {
    // Ignore unavailable storage and keep Scout usable.
  }
}

function activePath() {
  return document.querySelector<HTMLElement>(".explorer-pane.active[data-pane-path]")?.dataset.panePath?.trim() || null;
}

function settle(path: string | null) {
  restoreState = "settled";
  restorePath = null;
  restoreOriginPath = null;
  if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
  restoreTimer = undefined;
  if (path) writeLastLocation(path);
}

async function beginRestore(currentPath: string, savedPath: string) {
  restoreState = "restoring";
  restorePath = savedPath;
  restoreOriginPath = currentPath;

  try {
    // Validate through Scout's existing filesystem layer before asking App to
    // navigate. This keeps stale/deleted previous locations from poisoning
    // startup and avoids creating a separate navigation implementation here.
    await listDirectory(savedPath, false);
  } catch {
    clearLastLocation();
    settle(activePath() ?? currentPath);
    return;
  }

  if (restoreState !== "restoring" || restorePath !== savedPath) return;
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path: savedPath } }));

  restoreTimer = window.setTimeout(() => {
    if (restoreState !== "restoring") return;
    const path = activePath();
    if (path && comparablePath(path) === comparablePath(savedPath)) settle(path);
    else {
      clearLastLocation();
      settle(path ?? currentPath);
    }
  }, RESTORE_TIMEOUT_MS);
}

function reconcile() {
  reconcileQueued = false;
  const path = activePath();
  if (!path) return;

  if (restoreState === "pending") {
    const savedPath = readLastLocation();
    if (savedPath && comparablePath(savedPath) !== comparablePath(path)) {
      void beginRestore(path, savedPath);
      return;
    }
    settle(path);
    return;
  }

  if (restoreState === "restoring") {
    if (restorePath && comparablePath(path) === comparablePath(restorePath)) {
      settle(path);
      return;
    }

    // The user navigated away from Scout's temporary startup location while
    // validation/restore was still in flight. User intent wins immediately.
    if (restoreOriginPath && comparablePath(path) !== comparablePath(restoreOriginPath)) {
      settle(path);
    }
    return;
  }

  writeLastLocation(path);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function handlePageHide() {
  if (restoreState !== "settled") return;
  const path = activePath();
  if (path) writeLastLocation(path);
}

export function installSessionContinuity() {
  restoreState = "pending";
  restorePath = null;
  restoreOriginPath = null;
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path"],
  });
  window.addEventListener("pagehide", handlePageHide);
  queueReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    restoreTimer = undefined;
    restoreState = "pending";
    restorePath = null;
    restoreOriginPath = null;
    window.removeEventListener("pagehide", handlePageHide);
  };
}
