import { invoke } from "@tauri-apps/api/core";

interface HistoryEntry {
  id: number;
  kind: string;
  label: string;
  timestampMs: number;
  applied: boolean;
}

interface HistorySnapshot {
  entries: HistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
}

let observer: MutationObserver | null = null;
let panel: HTMLDivElement | null = null;
let sidebarButton: HTMLButtonElement | null = null;
let undoBar: HTMLDivElement | null = null;
let snapshot: HistorySnapshot = { entries: [], canUndo: false, canRedo: false };
let refreshToken = 0;
let refreshTimer: number | undefined;
let pollTimer: number | undefined;
let undoBarTimer: number | undefined;
let historySeeded = false;
let lastNotifiedHistoryId = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatTime(value: number) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function kindLabel(kind: string) {
  switch (kind) {
    case "rename": return "Rename";
    case "duplicate": return "Duplicate";
    case "copy": return "Copy";
    case "move": return "Move";
    case "create-folder": return "New folder";
    default: return kind;
  }
}

function latestApplied(source = snapshot) {
  return source.entries.find((entry) => entry.applied) ?? null;
}

function latestRedo(source = snapshot) {
  return source.entries.slice().reverse().find((entry) => !entry.applied) ?? null;
}

function dismissUndoBar() {
  if (undoBarTimer !== undefined) window.clearTimeout(undoBarTimer);
  undoBarTimer = undefined;
  undoBar?.remove();
  undoBar = null;
}

function showUndoBar(entry: HistoryEntry, mode: "undo" | "redo") {
  dismissUndoBar();
  undoBar = element("div", `footprints-undo-bar ${mode}`);
  undoBar.setAttribute("role", "status");
  undoBar.setAttribute("aria-live", "polite");

  const copy = element("div", "footprints-undo-copy");
  const title = element("strong", "footprints-undo-title");
  title.textContent = mode === "undo" ? entry.label : `Undid ${entry.label}`;
  const meta = element("span", "footprints-undo-meta");
  meta.textContent = mode === "undo" ? kindLabel(entry.kind) : "You can redo this action";
  copy.append(title, meta);

  const action = element("button", "footprints-undo-action");
  action.type = "button";
  action.textContent = mode === "undo" ? "Undo" : "Redo";
  action.addEventListener("click", () => {
    if (mode === "undo") void undo();
    else void redo();
  });

  const close = element("button", "footprints-undo-dismiss");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss");
  close.addEventListener("click", dismissUndoBar);

  undoBar.append(copy, action, close);
  document.body.append(undoBar);
  undoBarTimer = window.setTimeout(dismissUndoBar, mode === "undo" ? 5600 : 4200);
}

function noticeNewHistory(next: HistorySnapshot) {
  const maxId = next.entries.reduce((max, entry) => Math.max(max, entry.id), 0);
  if (!historySeeded) {
    historySeeded = true;
    lastNotifiedHistoryId = maxId;
    return;
  }

  const latest = latestApplied(next);
  if (latest && latest.id > lastNotifiedHistoryId) {
    lastNotifiedHistoryId = latest.id;
    showUndoBar(latest, "undo");
  } else {
    lastNotifiedHistoryId = Math.max(lastNotifiedHistoryId, maxId);
  }
}

async function refresh() {
  const token = ++refreshToken;
  try {
    const next = await invoke<HistorySnapshot>("operation_history");
    if (token !== refreshToken) return;
    noticeNewHistory(next);
    snapshot = next;
    updateBadge();
    if (panel) renderPanel();
  } catch {
    // History is supplemental; filesystem operations remain usable if this view cannot refresh.
  }
}

function scheduleRefresh() {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refresh();
  }, 120);
}

function updateBadge() {
  if (!sidebarButton) return;
  const badge = sidebarButton.querySelector<HTMLElement>(".footprints-sidebar-count");
  if (badge) badge.textContent = snapshot.entries.length ? String(snapshot.entries.length) : "";
  sidebarButton.classList.toggle("has-items", snapshot.entries.length > 0);
}

function closePanel() {
  panel?.remove();
  panel = null;
  sidebarButton?.classList.remove("active");
}

async function undo() {
  if (!snapshot.canUndo) return;
  const target = latestApplied();
  try {
    snapshot = await invoke<HistorySnapshot>("undo_last_operation");
    renderPanel();
    updateBadge();
    if (target) showUndoBar(target, "redo");
    window.dispatchEvent(new CustomEvent("scout:ux-files-mutated", { detail: { kind: "undo" } }));
  } catch (error) {
    showStatus(String(error));
    window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message: String(error), error: true } }));
  }
}

async function redo() {
  if (!snapshot.canRedo) return;
  const target = latestRedo();
  try {
    snapshot = await invoke<HistorySnapshot>("redo_last_operation");
    renderPanel();
    updateBadge();
    if (target) {
      lastNotifiedHistoryId = Math.max(lastNotifiedHistoryId, target.id);
      showUndoBar(target, "undo");
    }
    window.dispatchEvent(new CustomEvent("scout:ux-files-mutated", { detail: { kind: "redo" } }));
  } catch (error) {
    showStatus(String(error));
    window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message: String(error), error: true } }));
  }
}

function showStatus(message: string) {
  const status = panel?.querySelector<HTMLElement>(".footprints-status");
  if (status) status.textContent = message;
}

function renderPanel() {
  if (!panel) return;
  const body = panel.querySelector<HTMLElement>(".footprints-body");
  const undoButton = panel.querySelector<HTMLButtonElement>(".footprints-undo");
  const redoButton = panel.querySelector<HTMLButtonElement>(".footprints-redo");
  if (!body || !undoButton || !redoButton) return;
  undoButton.disabled = !snapshot.canUndo;
  redoButton.disabled = !snapshot.canRedo;
  body.replaceChildren();

  if (!snapshot.entries.length) {
    const empty = element("div", "footprints-empty");
    empty.textContent = "Reversible file operations will appear here.";
    body.append(empty);
    return;
  }

  for (const entry of snapshot.entries) {
    const row = element("div", `footprints-row${entry.applied ? "" : " undone"}`);
    const marker = element("span", "footprints-marker");
    const info = element("span", "footprints-info");
    const label = element("span", "footprints-label");
    label.textContent = entry.label;
    const meta = element("span", "footprints-meta");
    meta.textContent = `${kindLabel(entry.kind)} · ${formatTime(entry.timestampMs)}${entry.applied ? "" : " · Undone"}`;
    info.append(label, meta);
    row.append(marker, info);
    body.append(row);
  }
}

function openPanel() {
  if (panel) {
    closePanel();
    return;
  }
  panel = element("div", "footprints-panel");
  const header = element("header", "footprints-header");
  const heading = element("div", "footprints-heading");
  const title = element("div", "footprints-title");
  title.textContent = "Footprints";
  const subtitle = element("div", "footprints-subtitle");
  subtitle.textContent = "Recent reversible file operations";
  heading.append(title, subtitle);
  const close = element("button", "footprints-close");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", closePanel);
  header.append(heading, close);
  const body = element("div", "footprints-body");
  const footer = element("footer", "footprints-footer");
  const status = element("span", "footprints-status");
  const actions = element("span", "footprints-actions");
  const undoButton = element("button", "footprints-secondary footprints-undo");
  undoButton.type = "button";
  undoButton.textContent = "Undo";
  undoButton.title = "Cmd/Ctrl+Z";
  undoButton.addEventListener("click", () => void undo());
  const redoButton = element("button", "footprints-secondary footprints-redo");
  redoButton.type = "button";
  redoButton.textContent = "Redo";
  redoButton.title = "Cmd/Ctrl+Shift+Z";
  redoButton.addEventListener("click", () => void redo());
  actions.append(undoButton, redoButton);
  footer.append(status, actions);
  panel.append(header, body, footer);
  document.body.append(panel);
  sidebarButton?.classList.add("active");
  renderPanel();
  void refresh();
}

function installSidebarButton() {
  if (sidebarButton?.isConnected) return;
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const spacer = sidebar?.querySelector<HTMLElement>(".sidebar-spacer");
  if (!sidebar || !spacer) return;
  sidebarButton = element("button", "sidebar-item footprints-sidebar-button");
  sidebarButton.type = "button";
  const glyph = element("span", "footprints-sidebar-glyph");
  const label = element("span");
  label.textContent = "Footprints";
  const count = element("span", "footprints-sidebar-count");
  sidebarButton.append(glyph, label, count);
  sidebarButton.addEventListener("click", openPanel);
  sidebar.insertBefore(sidebarButton, spacer);
  updateBadge();
}

function reconcile(records?: MutationRecord[]) {
  installSidebarButton();
  if (records?.some((record) => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    return !!target?.closest(".workspace, .explorer-pane, .file-list, .file-grid, .file-gallery");
  })) scheduleRefresh();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier) return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void undo();
  } else if ((key === "z" && event.shiftKey) || (event.ctrlKey && key === "y")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void redo();
  } else if (event.shiftKey && key === "f") {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPanel();
  }
}

function handleMutationSignal() {
  scheduleRefresh();
}

export function installFootprints() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scout:ux-files-mutated", handleMutationSignal);
  queueMicrotask(() => reconcile());
  void refresh();
  pollTimer = window.setInterval(() => void refresh(), 900);
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scout:ux-files-mutated", handleMutationSignal);
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    pollTimer = undefined;
    dismissUndoBar();
    closePanel();
    sidebarButton?.remove();
    sidebarButton = null;
    historySeeded = false;
    lastNotifiedHistoryId = 0;
  };
}
