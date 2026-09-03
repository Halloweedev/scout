const MEMORY_LIMIT = 180;
const RESTORE_DELAY_MS = 56;

type ViewMode = "icons" | "list" | "columns" | "gallery";

interface FolderViewMemory {
  selectedPaths: string[];
  scrollTop: number;
  scrollLeft: number;
  updatedAt: number;
}

const memory = new Map<string, FolderViewMemory>();
let activeKey: string | null = null;
let restorePending = false;
let restoreTimer: number | undefined;
let captureTimer: number | undefined;
let syncFrame: number | undefined;

function activePane() {
  return document.querySelector<HTMLElement>(".explorer-pane.active[data-pane-path]");
}

function viewMode(pane = activePane()): ViewMode {
  const grid = pane?.closest<HTMLElement>(".pane-grid");
  if (grid?.classList.contains("view-icons")) return "icons";
  if (grid?.classList.contains("view-columns")) return "columns";
  if (grid?.classList.contains("view-gallery")) return "gallery";
  return "list";
}

function comparablePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function stateKey(pane = activePane()) {
  const path = pane?.dataset.panePath;
  if (!pane || !path) return null;
  return `${viewMode(pane)}:${comparablePath(path)}`;
}

function scrollTarget(pane: HTMLElement, mode = viewMode(pane)) {
  if (mode === "columns") return pane.querySelector<HTMLElement>(".column-browser");
  return pane.querySelector<HTMLElement>(".file-area");
}

function visibleSelectedPaths(pane: HTMLElement, mode = viewMode(pane)) {
  const selector = mode === "columns"
    ? ".column-browser-row.selected[data-entry-path]"
    : ".file-area .pane-file-row.selected[data-entry-path]:not(.column-browser-row)";
  return [...pane.querySelectorAll<HTMLElement>(selector)]
    .filter((row) => row.offsetParent !== null)
    .map((row) => row.dataset.entryPath)
    .filter((path): path is string => !!path);
}

function pruneMemory() {
  if (memory.size <= MEMORY_LIMIT) return;
  const stale = [...memory.entries()]
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    .slice(0, memory.size - MEMORY_LIMIT);
  for (const [key] of stale) memory.delete(key);
}

function captureCurrentState() {
  if (restorePending) return;
  const pane = activePane();
  const key = stateKey(pane);
  if (!pane || !key) return;
  const target = scrollTarget(pane);
  memory.set(key, {
    selectedPaths: visibleSelectedPaths(pane),
    scrollTop: target?.scrollTop ?? 0,
    scrollLeft: target?.scrollLeft ?? 0,
    updatedAt: Date.now(),
  });
  pruneMemory();
}

function scheduleCapture(delay = 0) {
  if (captureTimer !== undefined) window.clearTimeout(captureTimer);
  captureTimer = window.setTimeout(() => {
    captureTimer = undefined;
    captureCurrentState();
  }, delay);
}

function syntheticSelect(row: HTMLElement, additive: boolean) {
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  row.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
    metaKey: additive && mac,
    ctrlKey: additive && !mac,
  }));
}

function restoreSelection(pane: HTMLElement, state: FolderViewMemory, mode: ViewMode) {
  // Miller Columns navigate on a single row click. The path chain itself already
  // preserves directory context, so never synthesize selection clicks there.
  if (mode === "columns" || !state.selectedPaths.length) return;
  if (pane.querySelector(".file-area .pane-file-row.selected:not(.column-browser-row)")) return;

  const rows = [...pane.querySelectorAll<HTMLElement>(".file-area .pane-file-row[data-entry-path]:not(.column-browser-row)")]
    .filter((row) => row.offsetParent !== null);
  if (!rows.length) return;

  const remembered = state.selectedPaths
    .map((path) => rows.find((row) => row.dataset.entryPath === path))
    .filter((row): row is HTMLElement => !!row);
  if (!remembered.length) return;

  remembered.forEach((row, index) => syntheticSelect(row, index > 0));
}

function finishRestore(pane: HTMLElement, state: FolderViewMemory, mode: ViewMode) {
  restoreSelection(pane, state, mode);
  const target = scrollTarget(pane, mode);
  if (target) {
    target.scrollTop = state.scrollTop;
    target.scrollLeft = state.scrollLeft;
  }
  restorePending = false;
  scheduleCapture(0);
}

function restoreKey(expectedKey: string) {
  if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => {
    restoreTimer = undefined;
    const pane = activePane();
    if (!pane || stateKey(pane) !== expectedKey) return;
    const state = memory.get(expectedKey);
    if (!state) {
      restorePending = false;
      scheduleCapture(0);
      return;
    }

    const mode = viewMode(pane);
    const area = pane.querySelector<HTMLElement>(".file-area");
    const target = scrollTarget(pane, mode);

    // Do not use a short polling deadline here. Cloud/network folders can stay in
    // the loading state for much longer than a local folder. Keeping the restore
    // pending lets the DOM observer retry when loading/render state actually changes.
    if (area?.classList.contains("loading") || !target) return;
    finishRestore(pane, state, mode);
  }, RESTORE_DELAY_MS);
}

function syncActiveLocation() {
  syncFrame = undefined;
  const nextKey = stateKey();
  if (!nextKey) return;
  if (nextKey !== activeKey) {
    activeKey = nextKey;
    restorePending = true;
    restoreKey(nextKey);
    return;
  }
  if (restorePending) {
    if (restoreTimer === undefined) restoreKey(nextKey);
    return;
  }
  scheduleCapture(0);
}

function scheduleSync() {
  if (syncFrame !== undefined) return;
  syncFrame = window.requestAnimationFrame(syncActiveLocation);
}

function rememberBeforeInteraction() {
  captureCurrentState();
}

function handlePostInteraction() {
  scheduleCapture(0);
}

function handleScroll(event: Event) {
  const pane = activePane();
  if (!pane || !(event.target instanceof Element) || !pane.contains(event.target)) return;
  const target = scrollTarget(pane);
  if (event.target === target) scheduleCapture(24);
}

export function installNavigationMemory() {
  activeKey = stateKey();
  captureCurrentState();

  document.addEventListener("pointerdown", rememberBeforeInteraction, true);
  window.addEventListener("keydown", rememberBeforeInteraction, true);
  document.addEventListener("click", handlePostInteraction);
  document.addEventListener("contextmenu", handlePostInteraction);
  window.addEventListener("keyup", handlePostInteraction);
  document.addEventListener("scroll", handleScroll, true);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path"],
  });

  return () => {
    captureCurrentState();
    observer.disconnect();
    document.removeEventListener("pointerdown", rememberBeforeInteraction, true);
    window.removeEventListener("keydown", rememberBeforeInteraction, true);
    document.removeEventListener("click", handlePostInteraction);
    document.removeEventListener("contextmenu", handlePostInteraction);
    window.removeEventListener("keyup", handlePostInteraction);
    document.removeEventListener("scroll", handleScroll, true);
    if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    if (captureTimer !== undefined) window.clearTimeout(captureTimer);
    if (syncFrame !== undefined) window.cancelAnimationFrame(syncFrame);
    memory.clear();
  };
}
