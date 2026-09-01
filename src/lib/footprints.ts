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
let snapshot: HistorySnapshot = { entries: [], canUndo: false, canRedo: false };
let refreshToken = 0;
let refreshTimer: number | undefined;

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

async function refresh() {
  const token = ++refreshToken;
  try {
    const next = await invoke<HistorySnapshot>("operation_history");
    if (token !== refreshToken) return;
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
  }, 140);
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
  try {
    snapshot = await invoke<HistorySnapshot>("undo_last_operation");
    renderPanel();
    updateBadge();
  } catch (error) {
    showStatus(String(error));
  }
}

async function redo() {
  if (!snapshot.canRedo) return;
  try {
    snapshot = await invoke<HistorySnapshot>("redo_last_operation");
    renderPanel();
    updateBadge();
  } catch (error) {
    showStatus(String(error));
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
  subtitle.textContent = "Reversible operations in this session";
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
  undoButton.addEventListener("click", () => void undo());
  const redoButton = element("button", "footprints-secondary footprints-redo");
  redoButton.type = "button";
  redoButton.textContent = "Redo";
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
    return !!target?.closest(".workspace, .explorer-pane, .file-list");
  })) scheduleRefresh();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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

export function installFootprints() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", handleKeyDown, true);
  queueMicrotask(() => reconcile());
  void refresh();
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("keydown", handleKeyDown, true);
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    closePanel();
    sidebarButton?.remove();
    sidebarButton = null;
  };
}
