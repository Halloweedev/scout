import { registerActions } from "./actions";

const PREFS_KEY = "scout.folder-view-prefs.v1";
const ADAPTIVE_KEY = "scout.adaptive-view.v1";
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

type ViewMode = "icons" | "list" | "columns" | "gallery";
type SortColumn = "name" | "modified" | "size";
type SortDirection = "asc" | "desc";

interface FolderSortPreference {
  column: SortColumn;
  direction: SortDirection;
}

interface FolderViewPreference {
  view: ViewMode;
  sort?: FolderSortPreference;
  updatedAt: number;
}

type PreferenceMap = Record<string, FolderViewPreference>;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif", "svg", "ico"]);
let observer: MutationObserver | null = null;
let reconcileQueued = false;
let applying = false;
let applyingSort = false;
let lastPath: string | null = null;
let lastView: ViewMode | null = null;
let lastSort: string | null = null;
let sortRestorePendingPath: string | null = null;
let sortApplyTimer: number | null = null;
let adaptiveTimer: number | null = null;
let adaptiveAttemptedPath: string | null = null;

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function readPreferences(): PreferenceMap {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as PreferenceMap : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences: PreferenceMap) {
  const entries = Object.entries(preferences)
    .sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0))
    .slice(0, 500);
  localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function adaptiveEnabled() {
  return localStorage.getItem(ADAPTIVE_KEY) === "1";
}

function activePath() {
  const path = document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath;
  return path ? normalizePath(path) : null;
}

function currentView(): ViewMode | null {
  const grid = document.querySelector<HTMLElement>(".pane-grid");
  if (!grid) return null;
  if (grid.classList.contains("view-icons")) return "icons";
  if (grid.classList.contains("view-list")) return "list";
  if (grid.classList.contains("view-columns")) return "columns";
  if (grid.classList.contains("view-gallery")) return "gallery";
  return null;
}

function currentSort(): FolderSortPreference | null {
  const header = document.querySelector<HTMLElement>(".explorer-pane.active .file-header");
  if (!header) return null;
  for (const cell of header.querySelectorAll<HTMLElement>("[data-scout-sort-column]")) {
    const column = cell.dataset.scoutSortColumn as SortColumn | undefined;
    if (!column || !["name", "modified", "size"].includes(column)) continue;
    const text = cell.textContent ?? "";
    if (text.includes("∧")) return { column, direction: "asc" };
    if (text.includes("∨")) return { column, direction: "desc" };
  }
  return null;
}

function sortSignature(sort: FolderSortPreference | null) {
  return sort ? `${sort.column}:${sort.direction}` : null;
}

function emitView(view: ViewMode) {
  const keys: Record<ViewMode, string> = { icons: "1", list: "2", columns: "3", gallery: "4" };
  applying = true;
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: keys[view],
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    cancelable: true,
  }));
  queueMicrotask(() => {
    applying = false;
    lastView = currentView();
  });
}

function savePreference(path: string, view: ViewMode) {
  const preferences = readPreferences();
  preferences[path] = {
    view,
    sort: preferences[path]?.sort,
    updatedAt: Date.now(),
  };
  writePreferences(preferences);
}

function saveSortPreference(path: string, sort: FolderSortPreference) {
  const preferences = readPreferences();
  preferences[path] = {
    view: preferences[path]?.view ?? currentView() ?? "list",
    sort,
    updatedAt: Date.now(),
  };
  writePreferences(preferences);
}

function forgetPreference(path: string) {
  const preferences = readPreferences();
  if (!(path in preferences)) return false;
  delete preferences[path];
  writePreferences(preferences);
  return true;
}

function applySort(path: string, sort: FolderSortPreference) {
  if (sortApplyTimer !== null) window.clearTimeout(sortApplyTimer);
  applyingSort = true;
  sortApplyTimer = window.setTimeout(() => {
    sortApplyTimer = null;
    if (activePath() !== path || currentView() !== "list") {
      applyingSort = false;
      return;
    }
    const cell = document.querySelector<HTMLElement>(`.explorer-pane.active .file-header [data-scout-sort-column="${sort.column}"]`);
    if (!cell) {
      applyingSort = false;
      queueReconcile();
      return;
    }

    const before = currentSort();
    if (before?.column !== sort.column) cell.click();
    if (sort.direction === "desc") {
      window.setTimeout(() => {
        if (activePath() !== path) {
          applyingSort = false;
          return;
        }
        const afterColumn = currentSort();
        if (afterColumn?.column === sort.column && afterColumn.direction !== "desc") cell.click();
        window.setTimeout(() => {
          applyingSort = false;
          sortRestorePendingPath = null;
          lastSort = sortSignature(currentSort());
        }, 0);
      }, 0);
      return;
    }

    window.setTimeout(() => {
      applyingSort = false;
      sortRestorePendingPath = null;
      lastSort = sortSignature(currentSort());
    }, 0);
  }, 0);
}

function inferAdaptiveView(): ViewMode | null {
  const rows = [...document.querySelectorAll<HTMLElement>(".explorer-pane.active [data-entry-path]")]
    .filter((row) => row.offsetParent !== null);
  if (!rows.length) return null;

  let files = 0;
  let images = 0;
  let directories = 0;
  for (const row of rows) {
    const kind = row.dataset.entryKind ?? "other";
    if (kind === "directory") {
      directories += 1;
      continue;
    }
    if (kind !== "file") continue;
    files += 1;
    const extension = (row.dataset.entryExtension ?? "").toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) images += 1;
  }

  if (files >= 4 && images / files >= 0.65) return "gallery";
  if (rows.length <= 12 && directories > files) return "icons";
  return "list";
}

function scheduleAdaptive(path: string) {
  if (adaptiveTimer !== null) window.clearTimeout(adaptiveTimer);
  adaptiveTimer = window.setTimeout(() => {
    adaptiveTimer = null;
    if (activePath() !== path || !adaptiveEnabled()) return;
    const preferences = readPreferences();
    if (preferences[path]) return;
    const inferred = inferAdaptiveView();
    if (!inferred || inferred === currentView()) return;
    adaptiveAttemptedPath = path;
    emitView(inferred);
  }, 80);
}

function reconcile() {
  reconcileQueued = false;
  const path = activePath();
  const view = currentView();
  if (!path || !view) return;

  const preferences = readPreferences();
  const preference = preferences[path];

  if (path !== lastPath) {
    lastPath = path;
    lastView = view;
    lastSort = null;
    sortRestorePendingPath = path;
    adaptiveAttemptedPath = null;
    if (preference?.view && preference.view !== view) {
      emitView(preference.view);
      return;
    }
    if (!preference && adaptiveEnabled()) scheduleAdaptive(path);
  }

  if (view !== lastView) {
    const previous = lastView;
    lastView = view;
    if (!applying && previous !== null) savePreference(path, view);
  }

  if (view === "list") {
    const sort = currentSort();
    if (sortRestorePendingPath === path && sort) {
      if (preference?.sort && sortSignature(sort) !== sortSignature(preference.sort)) {
        if (!applyingSort) applySort(path, preference.sort);
        return;
      }
      sortRestorePendingPath = null;
      lastSort = sortSignature(sort);
    } else if (!applyingSort && sort) {
      const signature = sortSignature(sort);
      if (lastSort === null) {
        lastSort = signature;
      } else if (signature !== lastSort) {
        lastSort = signature;
        saveSortPreference(path, sort);
      }
    }
  }

  if (adaptiveEnabled() && adaptiveAttemptedPath !== path && !readPreferences()[path]) scheduleAdaptive(path);
}

function queueReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message } }));
}

export function installViewPreferences() {
  const unregister = registerActions([
    {
      id: "view.remember-folder",
      title: "Remember View for This Folder",
      category: "View",
      keywords: ["folder", "view", "remember", "preference", "per folder", "sort"],
      available: () => !!activePath() && !!currentView(),
      run: () => {
        const path = activePath();
        const view = currentView();
        if (!path || !view) throw new Error("No active folder view");
        savePreference(path, view);
        const sort = currentSort();
        if (sort) saveSortPreference(path, sort);
        toast(`Remembered ${view} view${sort ? " and sorting" : ""} for this folder`);
      },
    },
    {
      id: "view.forget-folder",
      title: "Forget View for This Folder",
      category: "View",
      keywords: ["folder", "view", "reset", "forget", "preference", "sort"],
      available: () => {
        const path = activePath();
        return !!path && !!readPreferences()[path];
      },
      run: () => {
        const path = activePath();
        if (!path || !forgetPreference(path)) throw new Error("This folder has no saved view");
        adaptiveAttemptedPath = null;
        sortRestorePendingPath = path;
        if (adaptiveEnabled()) scheduleAdaptive(path);
        toast("Forgot this folder view and sorting");
      },
    },
    {
      id: "view.toggle-adaptive",
      title: "Toggle Adaptive View",
      category: "View",
      keywords: ["automatic", "adaptive", "gallery", "folder type", "smart view"],
      run: () => {
        const next = !adaptiveEnabled();
        localStorage.setItem(ADAPTIVE_KEY, next ? "1" : "0");
        adaptiveAttemptedPath = null;
        const path = activePath();
        if (next && path && !readPreferences()[path]) scheduleAdaptive(path);
        toast(`Adaptive View ${next ? "enabled" : "disabled"}`);
      },
    },
  ]);

  observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "data-pane-path", "data-entry-path", "data-entry-kind", "data-entry-extension", "data-scout-sort-column"],
  });
  queueReconcile();

  return () => {
    unregister();
    observer?.disconnect();
    observer = null;
    if (adaptiveTimer !== null) window.clearTimeout(adaptiveTimer);
    if (sortApplyTimer !== null) window.clearTimeout(sortApplyTimer);
    adaptiveTimer = null;
    sortApplyTimer = null;
  };
}
