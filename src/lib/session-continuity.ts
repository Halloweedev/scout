import { actionContext, runAction } from "./actions";
import { listDirectory } from "./fs";

const LAST_LOCATION_KEY = "scout.session.last-location.v1";
const SESSION_LAYOUT_KEY = "scout.session.layout.v1";
const LINKED_PANES_KEY = "scout.linked-panes.v1";
const STEP_TIMEOUT_MS = 2200;

type RestoreState = "pending" | "restoring" | "settled";

interface SessionLayout {
  panePaths: string[];
  activePaneIndex: number;
  updatedAt: number;
}

interface ValidatedPane {
  path: string;
  sourceIndex: number;
}

let observer: MutationObserver | null = null;
let reconcileQueued = false;
let restoreState: RestoreState = "pending";
let restoreGeneration = 0;
let applyingRestore = false;
let userInterrupted = false;
let lastWrittenSignature = "";

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized || "/";
}

function layoutSignature(layout: SessionLayout) {
  return `${layout.activePaneIndex}::${layout.panePaths.map(comparablePath).join("\u0000")}`;
}

function sameLayout(left: SessionLayout, right: SessionLayout) {
  return layoutSignature(left) === layoutSignature(right);
}

function readLastLocation() {
  try {
    const value = localStorage.getItem(LAST_LOCATION_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function readSessionLayout(): SessionLayout | null {
  try {
    const raw = localStorage.getItem(SESSION_LAYOUT_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<SessionLayout>;
      const paths = Array.isArray(value.panePaths)
        ? value.panePaths.filter((path): path is string => typeof path === "string" && !!path.trim()).slice(0, 4)
        : [];
      if (paths.length) {
        return {
          panePaths: paths,
          activePaneIndex: Math.min(Math.max(Number(value.activePaneIndex) || 0, 0), paths.length - 1),
          updatedAt: Number(value.updatedAt) || 0,
        };
      }
    }
  } catch {
    // Fall through to the v1 single-location migration below.
  }

  const legacy = readLastLocation();
  return legacy ? { panePaths: [legacy], activePaneIndex: 0, updatedAt: 0 } : null;
}

function writeSessionLayout(layout: SessionLayout) {
  const normalized: SessionLayout = {
    panePaths: layout.panePaths.slice(0, 4),
    activePaneIndex: Math.min(Math.max(layout.activePaneIndex, 0), Math.max(0, layout.panePaths.length - 1)),
    updatedAt: Date.now(),
  };
  const signature = layoutSignature(normalized);
  if (signature === lastWrittenSignature) return;

  try {
    localStorage.setItem(SESSION_LAYOUT_KEY, JSON.stringify(normalized));
    const activePath = normalized.panePaths[normalized.activePaneIndex] ?? normalized.panePaths[0];
    if (activePath) localStorage.setItem(LAST_LOCATION_KEY, activePath);
    lastWrittenSignature = signature;
  } catch {
    // Session continuity is best-effort and must never block normal browsing.
  }
}

function clearSavedLayout() {
  try {
    localStorage.removeItem(SESSION_LAYOUT_KEY);
    localStorage.removeItem(LAST_LOCATION_KEY);
  } catch {
    // Ignore unavailable storage and keep Scout usable.
  }
  lastWrittenSignature = "";
}

function paneElements() {
  return [...document.querySelectorAll<HTMLElement>(".explorer-pane[data-pane-path]")];
}

function captureLayout(): SessionLayout | null {
  const panes = paneElements();
  if (!panes.length) return null;
  const panePaths = panes.map((pane) => pane.dataset.panePath?.trim() ?? "");
  if (panePaths.some((path) => !path)) return null;
  const active = panes.findIndex((pane) => pane.classList.contains("active"));
  return {
    panePaths,
    activePaneIndex: active >= 0 ? active : 0,
    updatedAt: Date.now(),
  };
}

function activePath() {
  return document.querySelector<HTMLElement>(".explorer-pane.active[data-pane-path]")?.dataset.panePath?.trim() || null;
}

function linkedPanesEnabled() {
  try {
    return localStorage.getItem(LINKED_PANES_KEY) === "1";
  } catch {
    return false;
  }
}

function shouldContinue(token: number) {
  return restoreState === "restoring" && restoreGeneration === token && !userInterrupted;
}

async function waitFor(predicate: () => boolean, token: number, timeout = STEP_TIMEOUT_MS) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    if (!shouldContinue(token)) return false;
    if (predicate()) return true;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 18));
  }
  return shouldContinue(token) && predicate();
}

async function focusPane(index: number, token: number) {
  const pane = paneElements()[index];
  if (!pane) return false;
  if (pane.classList.contains("active")) return true;
  pane.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "mouse",
  }));
  return waitFor(() => pane.classList.contains("active"), token, 700);
}

async function navigateActive(path: string, token: number) {
  if (!shouldContinue(token)) return false;
  const current = activePath();
  if (current && comparablePath(current) === comparablePath(path)) return true;
  window.dispatchEvent(new CustomEvent("scout:navigate", { detail: { path } }));
  return waitFor(() => {
    const next = activePath();
    return !!next && comparablePath(next) === comparablePath(path);
  }, token);
}

async function validateLayout(layout: SessionLayout) {
  const results = await Promise.all(layout.panePaths.slice(0, 4).map(async (path, sourceIndex) => {
    try {
      await listDirectory(path, false);
      return { path, sourceIndex } satisfies ValidatedPane;
    } catch {
      return null;
    }
  }));
  return results.filter((entry): entry is ValidatedPane => !!entry);
}

function restoredActiveIndex(valid: ValidatedPane[], requested: number) {
  const exact = valid.findIndex((entry) => entry.sourceIndex === requested);
  if (exact >= 0) return exact;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  valid.forEach((entry, index) => {
    const distance = Math.abs(entry.sourceIndex - requested);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function settle(layout = captureLayout()) {
  restoreState = "settled";
  applyingRestore = false;
  userInterrupted = false;
  if (layout) writeSessionLayout(layout);
}

async function restorePaneLayout(origin: SessionLayout, saved: SessionLayout) {
  restoreState = "restoring";
  applyingRestore = false;
  userInterrupted = false;
  const token = ++restoreGeneration;
  const originSignature = layoutSignature(origin);

  const valid = await validateLayout(saved);
  if (!shouldContinue(token)) {
    settle();
    return;
  }
  if (!valid.length) {
    clearSavedLayout();
    settle(origin);
    return;
  }

  const current = captureLayout();
  if (!current || layoutSignature(current) !== originSignature) {
    // Something changed while filesystem validation was in flight. Treat the
    // live UI as user intent instead of snapping it back to the stored layout.
    settle(current);
    return;
  }

  const targetPaths = valid.map((entry) => entry.path);
  const targetActiveIndex = restoredActiveIndex(valid, saved.activePaneIndex);
  const restoreLinked = linkedPanesEnabled();
  let linkedTemporarilyDisabled = false;
  applyingRestore = true;

  try {
    if (!await focusPane(0, token) || !await navigateActive(targetPaths[0], token)) return;

    if (targetPaths.length > 1) {
      await runAction("workspace.add-pane", actionContext());
      if (!shouldContinue(token)) return;

      if (restoreLinked) {
        await runAction("workspace.toggle-linked-panes", actionContext());
        linkedTemporarilyDisabled = true;
        if (!shouldContinue(token)) return;
      }

      if (!await navigateActive(targetPaths[1], token)) return;

      for (let index = 2; index < targetPaths.length; index += 1) {
        await runAction("workspace.add-pane", actionContext());
        if (!shouldContinue(token)) return;
        if (!await navigateActive(targetPaths[index], token)) return;
      }
    }

    if (shouldContinue(token)) await focusPane(targetActiveIndex, token);
  } catch {
    // Owner actions or navigation can become unavailable during startup. Keep
    // whatever live layout Scout successfully reached instead of forcing state.
  } finally {
    if (linkedTemporarilyDisabled && linkedPanesEnabled() === false && paneElements().length > 1) {
      try {
        await runAction("workspace.toggle-linked-panes", actionContext());
      } catch {
        // Preserve the live layout even if linked-mode restoration fails.
      }
    }
    settle();
  }
}

function reconcile() {
  reconcileQueued = false;
  if (applyingRestore) return;
  const current = captureLayout();
  if (!current) return;

  if (restoreState === "pending") {
    // A cold launch begins with one App-owned pane. If multiple panes already
    // exist when this installer starts (for example after HMR), the live UI is
    // authoritative and must not be destructively reconstructed.
    if (current.panePaths.length !== 1) {
      settle(current);
      return;
    }

    const saved = readSessionLayout();
    if (!saved || sameLayout(saved, current)) {
      settle(current);
      return;
    }
    void restorePaneLayout(current, saved);
    return;
  }

  if (restoreState === "restoring") {
    if (userInterrupted) settle(current);
    return;
  }

  writeSessionLayout(current);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function handleUserIntent(event: Event) {
  if (restoreState !== "restoring" || !(event as Event & { isTrusted?: boolean }).isTrusted) return;
  userInterrupted = true;
  restoreGeneration += 1;
}

function handlePageHide() {
  const layout = captureLayout();
  if (layout) writeSessionLayout(layout);
}

export function installSessionContinuity() {
  restoreState = "pending";
  restoreGeneration += 1;
  applyingRestore = false;
  userInterrupted = false;
  lastWrittenSignature = "";
  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path"],
  });
  window.addEventListener("pointerdown", handleUserIntent, true);
  window.addEventListener("keydown", handleUserIntent, true);
  window.addEventListener("pagehide", handlePageHide);
  queueReconcile();

  return () => {
    observer?.disconnect();
    observer = null;
    reconcileQueued = false;
    restoreGeneration += 1;
    restoreState = "pending";
    applyingRestore = false;
    userInterrupted = false;
    window.removeEventListener("pointerdown", handleUserIntent, true);
    window.removeEventListener("keydown", handleUserIntent, true);
    window.removeEventListener("pagehide", handlePageHide);
  };
}
